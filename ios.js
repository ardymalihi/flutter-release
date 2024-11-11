const inquirer = require('inquirer').default;
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const sharp = require('sharp');

// Define the output directory for shippable builds
const outputDir = path.join(__dirname, 'shippable_ios');

// Define the parent directory for sibling folders
const parentDir = path.resolve(__dirname, '..');

// Prompt user for iOS-specific settings
async function promptUser() {
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'buildMode',
            message: 'Select the build mode:',
            choices: ['Debug', 'Release'],
            default: 'Debug'
        },
        {
            name: 'flutterAppFolderName',
            message: 'Enter the name or path of your Flutter app folder:',
            default: 'prep'
        },
        {
            name: 'bundleName',
            message: 'Enter the new bundle identifier (e.g., com.example.app):',
            default: 'com.prepto.ccp',
            validate: function (input) {
                const bundleIdPattern = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)+$/;
                return bundleIdPattern.test(input) || 'Invalid Bundle ID.';
            }
        },
        {
            name: 'appName',
            message: 'Enter the new app name:',
            default: 'Canadian Citizenship Prep'
        },
        {
            name: 'offlineCategoryId',
            message: 'Enter the OFFLINE_CATEGORY_ID:',
            default: '2'
        },
        {
            name: 'apiUrl',
            message: 'Enter the API_URL:',
            default: 'https://www.prepto.pro'
        },
        {
            name: 'deploymentTarget',
            message: 'Enter the iOS deployment target (e.g., 12.0):',
            default: '12.0'
        },
        {
            name: 'versionName',
            message: 'Enter the app version (e.g., 1.0.0):',
            default: '1.0.0',
            when: (answers) => answers.buildMode === 'Release'  // Only ask in Release mode
        }
    ]);
    return answers;
}

// Determine if the flutterAppFolderName is a path or a folder name
function resolveFlutterAppPath(flutterAppFolderName) {
    if (path.isAbsolute(flutterAppFolderName) || flutterAppFolderName.includes('/')) {
        return path.resolve(flutterAppFolderName); // Treat as a full path
    } else {
        return path.join(parentDir, flutterAppFolderName); // Treat as a sibling folder
    }
}

// Convert the bundle name to a folder name
function convertBundleNameToFolderName(bundleName) {
    return bundleName.replace(/\./g, '_');
}

// Create a copy of the project based on the bundle name
async function copyProject(flutterAppFolderPath, bundleName) {
    const folderName = convertBundleNameToFolderName(bundleName);
    const appDir = path.join(outputDir, folderName);

    await prepareDirectory(appDir); // Check and prepare the directory before copying

    console.log(`Creating a copy of the project in folder "${folderName}"...`);
    await fs.copy(flutterAppFolderPath, appDir);
    console.log('Project copy created.');
    return appDir;
}

// Check and prepare the directory for copying the project
async function prepareDirectory(folderPath) {
    if (await fs.pathExists(folderPath)) {
        const { confirmDelete } = await inquirer.prompt({
            type: 'confirm',
            name: 'confirmDelete',
            message: `The directory ${folderPath} already exists. Do you want to delete it and continue?`,
            default: true
        });

        if (confirmDelete) {
            await fs.remove(folderPath);
            console.log(`Deleted existing directory: ${folderPath}`);
        } else {
            throw new Error('Operation cancelled by user.');
        }
    }
}

// Function to update iOS files and setup xcconfig for automated signing
function updateIOSFilesAndSetupSigning(bundleName, appName, projectDir, deploymentTarget) {
    const infoPlistPath = path.join(projectDir, 'ios', 'Runner', 'Info.plist');
    const xcconfigPath = path.join(projectDir, 'ios', 'config', 'build.xcconfig');
    const podfilePath = path.join(projectDir, 'ios', 'Podfile');
    const xcodeprojPath = path.join(projectDir, 'ios', 'Runner.xcodeproj', 'project.pbxproj');

    let infoPlistContent = fs.readFileSync(infoPlistPath, 'utf8');
    infoPlistContent = infoPlistContent.replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]+<\/string>/, `<key>CFBundleIdentifier</key><string>${bundleName}</string>`);
    infoPlistContent = infoPlistContent.replace(/<key>CFBundleName<\/key>\s*<string>[^<]+<\/string>/, `<key>CFBundleName</key><string>${appName}</string>`);
    fs.writeFileSync(infoPlistPath, infoPlistContent, 'utf8');

    const xcconfigContent = `
CODE_SIGN_STYLE = Automatic
DEVELOPMENT_TEAM = ZBWAG62J88
CODE_SIGN_IDENTITY = iPhone Developer
    `;
    fs.ensureDirSync(path.dirname(xcconfigPath));
    fs.writeFileSync(xcconfigPath, xcconfigContent.trim(), 'utf8');

    if (fs.existsSync(podfilePath)) {
        let podfileContent = fs.readFileSync(podfilePath, 'utf8');
        podfileContent = podfileContent.replace(/platform :ios, '[^']*'/, `platform :ios, '${deploymentTarget}'`);
        fs.writeFileSync(podfilePath, podfileContent, 'utf8');
        console.log(`Updated Podfile with iOS deployment target: ${deploymentTarget}`);
    }

    if (fs.existsSync(xcodeprojPath)) {
        let xcodeprojContent = fs.readFileSync(xcodeprojPath, 'utf8');
        xcodeprojContent = xcodeprojContent.replace(/DEVELOPMENT_TEAM = [A-Z0-9]+;/g, `DEVELOPMENT_TEAM = ZBWAG62J88;`);
        xcodeprojContent = xcodeprojContent.replace(/CODE_SIGN_STYLE = [a-zA-Z]+;/g, `CODE_SIGN_STYLE = Automatic;`);
        xcodeprojContent = xcodeprojContent.replace(/"CODE_SIGN_IDENTITY" = "[^"]*";/g, `"CODE_SIGN_IDENTITY" = "Apple Development";`);
        xcodeprojContent = xcodeprojContent.replace(/\s*\*\/\*\sPrivacyInfo\.xcprivacy\s\*\/;/g, ''); // Remove PrivacyInfo.xcprivacy references
        xcodeprojContent = xcodeprojContent.replace(/\s*\/\*\sPrivacyInfo\.xcprivacy\s\*\/;\s*\/\*\sPBXBuildFile\s\*\/;/g, ''); // Remove PrivacyInfo.xcprivacy PBXBuildFile references
        fs.writeFileSync(xcodeprojPath, xcodeprojContent, 'utf8');
        console.log('Updated Xcode project file with development team ID, code signing settings, and removed PrivacyInfo.xcprivacy references.');
    }

    console.log('iOS Info.plist, signing configuration, Podfile, and Xcode project file updated.');
}

// Function to update iOS app icons
async function updateIOSAppIcons(flutterAppFolderPath, projectDir) {
    const iconPath = path.join(flutterAppFolderPath, 'icon.png');
    const appIconSetPath = path.join(projectDir, 'ios', 'Runner', 'Assets.xcassets', 'AppIcon.appiconset');
    const iosIconSizes = [
        { size: 20, scales: [2, 3] }, // Notification
        { size: 29, scales: [1, 2, 3] }, // Settings and Spotlight
        { size: 40, scales: [2, 3] }, // Spotlight
        { size: 60, scales: [2, 3] }  // App
    ];

    if (await fs.pathExists(iconPath)) {
        console.log('Custom iOS icon found. Updating iOS app icons...');
        await Promise.all(
            iosIconSizes.flatMap(({ size, scales }) =>
                scales.map(scale => {
                    const dimension = size * scale;
                    const iconName = `Icon-${dimension}.png`;
                    return sharp(iconPath)
                        .resize(dimension, dimension)
                        .toFile(path.join(appIconSetPath, iconName));
                })
            )
        );
        console.log('iOS app icons updated.');
    } else {
        console.log('No custom iOS icon found. Using default Flutter app icon.');
    }
}

// Update environment variables or configuration files
function updateConfigFiles(offlineCategoryId, apiUrl, projectDir) {
    const configFilePath = path.join(projectDir, 'lib', 'config.dart');
    let configContent = fs.readFileSync(configFilePath, 'utf8');
    configContent = configContent.replace(/const int OFFLINE_CATEGORY_ID = [^;]*;/, `const int OFFLINE_CATEGORY_ID = ${offlineCategoryId};`);
    configContent = configContent.replace(/const String API_URL = '[^']*';/, `const String API_URL = '${apiUrl}';`);
    fs.writeFileSync(configFilePath, configContent, 'utf8');
}

// Build the iOS app with xcodebuild
function buildIOSApp(projectDir, buildMode) {
    console.log(`Building iOS app in ${buildMode} mode...`);
    return new Promise((resolve, reject) => {
        let buildCommand = '';
        if (buildMode === 'Release') {
            buildCommand = 'xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -sdk iphoneos -configuration Release archive -archivePath ios/Runner.xcarchive -allowProvisioningUpdates';
        } else {
            buildCommand = 'xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -sdk iphonesimulator -configuration Debug';
        }

        exec('rm -rf ~/Library/Developer/Xcode/DerivedData', (error, stdout, stderr) => {
            if (error) {
                console.error(`Error removing DerivedData: ${stderr}`);
            } else {
                console.log('Successfully removed DerivedData');
            }

            const xcodeBuildProcess = exec(buildCommand, { cwd: projectDir });

            xcodeBuildProcess.stdout.on('data', (data) => console.log(data.toString()));
            xcodeBuildProcess.stderr.on('data', (data) => console.error(data.toString()));
            xcodeBuildProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('iOS build completed successfully.');
                    resolve();
                } else {
                    console.error('iOS build process failed.');
                    reject(new Error('iOS build process exited with errors.'));
                }
            });
        });
    });
}

// Install CocoaPods dependencies
function installCocoaPods(projectDir) {
    console.log('Installing CocoaPods dependencies...');
    return new Promise((resolve, reject) => {
        const installProcess = exec('pod install', { cwd: path.join(projectDir, 'ios') });

        installProcess.stdout.on('data', (data) => console.log(data.toString()));
        installProcess.stderr.on('data', (data) => console.error(data.toString()));
        installProcess.on('close', (code) => {
            if (code === 0) {
                console.log('CocoaPods dependencies installed successfully.');
                resolve();
            } else {
                console.error('CocoaPods installation failed.');
                reject(new Error('CocoaPods installation process exited with errors.'));
            }
        });
    });
}

// Copy build outputs to a separate "shippable" folder
function copyToShippableFolder(projectDir, buildMode) {
    console.log(`Preparing to copy build outputs to the shippable folder...`);
    const shippableAppDir = path.join(outputDir);

    // Ensure the shippable folder exists
    fs.ensureDirSync(shippableAppDir);

    const buildOutputPath = buildMode === 'Release'
        ? path.join(projectDir, 'ios', 'Runner.xcarchive')
        : path.join(projectDir, 'build', 'ios', 'iphonesimulator', 'Runner.app');

    if (fs.existsSync(buildOutputPath)) {
        fs.copySync(buildOutputPath, path.join(shippableAppDir, buildMode === 'Release' ? 'Runner.xcarchive' : 'Runner.app'));
        console.log('Build output copied to the shippable folder.');
    } else {
        console.error('Build output not found!');
    }
}

// Main function to control the process
async function main() {
    const { buildMode, flutterAppFolderName, bundleName, appName, offlineCategoryId, apiUrl, deploymentTarget, versionName } = await promptUser();
    const flutterAppFolderPath = resolveFlutterAppPath(flutterAppFolderName);
    
    try {
        const projectDir = await copyProject(flutterAppFolderPath, bundleName);
        await updateIOSAppIcons(flutterAppFolderPath, projectDir);
        updateIOSFilesAndSetupSigning(bundleName, appName, projectDir, deploymentTarget);
        updateConfigFiles(offlineCategoryId, apiUrl, projectDir);

        // Install CocoaPods dependencies
        await installCocoaPods(projectDir);

        // Conditionally update the version in pubspec.yaml if in Release mode
        if (buildMode === 'Release') {
            console.log('Release mode selected. Setting version...');
            const pubspecPath = path.join(projectDir, 'pubspec.yaml');
            let pubspecContent = fs.readFileSync(pubspecPath, 'utf8');
            pubspecContent = pubspecContent.replace(/version:\s*([0-9.]+)\+([0-9]+)/, `version: ${versionName}`);
            fs.writeFileSync(pubspecPath, pubspecContent, 'utf8');
            console.log(`Updated pubspec.yaml with version: ${versionName}`);
        }

        await buildIOSApp(projectDir, buildMode);
        copyToShippableFolder(projectDir, buildMode);
        console.log('iOS app is ready for deployment!');
    } catch (error) {
        console.error('An error occurred:', error.message);
    }
}

main();
