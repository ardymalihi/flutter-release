const inquirer = require('inquirer').default;
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

// Define the parent directory for sibling folders
const parentDir = path.resolve(__dirname, '..');
const outputDir = path.join(__dirname, 'shippable');

// Prompt user for app settings and the Flutter app folder name
async function promptUser() {
    const answers = await inquirer.prompt([
        {
            name: 'flutterAppFolderName',
            message: 'Enter the name or path of your Flutter app folder:',
            default: 'prep'
        },
        {
            name: 'bundleName',
            message: 'Enter the new bundle name (e.g., com.example.app):',
            default: 'com.prepto.ccp',
            validate: function (input) {
                const bundleIdPattern = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)+$/;
                if (!bundleIdPattern.test(input)) {
                    return 'Invalid Bundle ID. A valid Bundle ID must consist of alphanumeric characters and dots, and should not start or end with a dot.';
                }
                return true;
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
            default: 'https://prep-admin.vercel.app'
        },
        {
            name: 'teamId',
            message: 'Enter your Apple Development Team ID:',
            default: 'ZBWAG62J88'
        },
        {
            type: 'confirm',
            name: 'buildAndroid',
            message: 'Do you want to build for Android?',
            default: true
        },
        {
            type: 'confirm',
            name: 'buildIOS',
            message: 'Do you want to build for iOS?',
            default: true
        }
    ]);
    return answers;
}

// Function to pause and ask the user to manually apply Xcode changes
async function confirmXcodeChanges() {
    const confirmation = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'xcodeChangesApplied',
            message: 'Did you manually apply the required changes in Xcode (e.g., set the Development Team, Bundle ID)?',
            default: false
        }
    ]);

    if (!confirmation.xcodeChangesApplied) {
        console.log("Please apply the required changes in Xcode and then return to confirm.");
        await confirmXcodeChanges(); // Recursive call until user confirms
    }
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
function copyProject(flutterAppFolderPath, bundleName) {
    const folderName = convertBundleNameToFolderName(bundleName);
    const appDir = path.join(outputDir, folderName);

    // Resolve absolute paths for comparison
    const resolvedSrc = path.resolve(flutterAppFolderPath);
    const resolvedDest = path.resolve(appDir);

    // Check if the destination is a subdirectory of the source
    if (resolvedDest.startsWith(resolvedSrc)) {
        throw new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`);
    }

    console.log(`Creating a copy of the project in folder "${folderName}"...`);
    fs.copySync(resolvedSrc, resolvedDest);
    console.log('Project copy created.');
    return appDir;
}

// Update Android files and package structure
function updateAndroidFiles(bundleName, appName, projectDir) {
    const androidManifestPath = path.join(projectDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    const buildGradlePath = path.join(projectDir, 'android', 'app', 'build.gradle');
    const kotlinPath = path.join(projectDir, 'android', 'app', 'src', 'main', 'kotlin');

    // Update AndroidManifest.xml
    let androidManifest = fs.readFileSync(androidManifestPath, 'utf8');
    const oldPackageNameMatch = androidManifest.match(/package="([^"]+)"/);
    if (!oldPackageNameMatch) {
        throw new Error('Could not find the package name in AndroidManifest.xml');
    }
    const oldPackageName = oldPackageNameMatch[1];
    const oldPackagePath = path.join(kotlinPath, ...oldPackageName.split('.'));

    androidManifest = androidManifest.replace(/package="[^"]+"/, `package="${bundleName}"`);
    fs.writeFileSync(androidManifestPath, androidManifest, 'utf8');

    // Update build.gradle
    let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
    buildGradle = buildGradle.replace(/applicationId "[^"]+"/, `applicationId "${bundleName}"`);
    fs.writeFileSync(buildGradlePath, buildGradle, 'utf8');

    // Update package structure
    const packageParts = bundleName.split('.');
    const newPackagePath = path.join(kotlinPath, ...packageParts);

    // Ensure the new package path exists
    fs.ensureDirSync(newPackagePath);

    // Move MainActivity.kt or MainActivity.java to the new package path
    const mainActivityFile = fs.existsSync(path.join(oldPackagePath, 'MainActivity.kt'))
        ? 'MainActivity.kt'
        : 'MainActivity.java';

    fs.moveSync(path.join(oldPackagePath, mainActivityFile), path.join(newPackagePath, mainActivityFile));

    // Update package name in MainActivity file
    const mainActivityPath = path.join(newPackagePath, mainActivityFile);
    let mainActivityContent = fs.readFileSync(mainActivityPath, 'utf8');
    mainActivityContent = mainActivityContent.replace(/package .+;/, `package ${bundleName};`);
    fs.writeFileSync(mainActivityPath, mainActivityContent, 'utf8');
}

// Update iOS files and setup xcconfig for automated signing
function updateIOSFilesAndSetupSigning(appName, projectDir, teamId) {
    const infoPlistPath = path.join(projectDir, 'ios', 'Runner', 'Info.plist');
    const xcconfigPath = path.join(projectDir, 'ios', 'config', 'build.xcconfig');

    // Update Info.plist
    let infoPlist = fs.readFileSync(infoPlistPath, 'utf8');
    infoPlist = infoPlist.replace(/<key>CFBundleName<\/key>\s*<string>[^<]+<\/string>/, `<key>CFBundleName</key>\n\t<string>${appName}</string>`);
    fs.writeFileSync(infoPlistPath, infoPlist, 'utf8');

    // Create or update the xcconfig file for signing
    const xcconfigContent = `
CODE_SIGN_STYLE = Automatic
DEVELOPMENT_TEAM = ${teamId}
CODE_SIGN_IDENTITY = iPhone Developer
    `;
    fs.ensureDirSync(path.dirname(xcconfigPath));
    fs.writeFileSync(xcconfigPath, xcconfigContent.trim(), 'utf8');

    console.log('xcconfig file for automated signing created/updated.');

    // Modify the Xcode project to use the xcconfig file
    const projectPbxprojPath = path.join(projectDir, 'ios', 'Runner.xcodeproj', 'project.pbxproj');
    let projectPbxproj = fs.readFileSync(projectPbxprojPath, 'utf8');

    // Set the baseConfigurationReference to point to the xcconfig file
    projectPbxproj = projectPbxproj.replace(/(buildSettings = \{[^}]*)(\};)/g, (match, p1, p2) => {
        if (!p1.includes('baseConfigurationReference')) {
            return `${p1}\n\t\t\t\tbaseConfigurationReference = "${xcconfigPath}";${p2}`;
        }
        return match;
    });

    fs.writeFileSync(projectPbxprojPath, projectPbxproj, 'utf8');
    console.log('Xcode project updated to use xcconfig for signing.');
}

// Update environment variables or configuration files
function updateConfigFiles(offlineCategoryId, apiUrl, projectDir) {
    const configFilePath = path.join(projectDir, 'lib', 'config.dart'); // Assuming a config.dart file exists
    let configContent = fs.readFileSync(configFilePath, 'utf8');
    configContent = configContent.replace(/const String OFFLINE_CATEGORY_ID = '[^']*';/, `const String OFFLINE_CATEGORY_ID = '${offlineCategoryId}';`);
    configContent = configContent.replace(/const String API_URL = '[^']*';/, `const String API_URL = '${apiUrl}';`);
    fs.writeFileSync(configFilePath, configContent, 'utf8');

}

// Build the Flutter app for Android and/or iOS
function buildApp(projectDir, buildAndroid, buildIOS) {
    return new Promise((resolve, reject) => {
        console.log('Building Flutter app...');

        const buildCommands = [];

        if (buildAndroid) {
            buildCommands.push('flutter build apk');
        }

        if (buildIOS) {
            buildCommands.push('flutter build ios --no-codesign');
        }

        // If there are no build commands, resolve without doing anything
        if (buildCommands.length === 0) {
            console.log('No build process was selected.');
            return resolve();
        }

        const buildCommand = buildCommands.join(' && ');
        const flutterBuildProcess = exec(buildCommand, { cwd: projectDir });

        flutterBuildProcess.stdout.on('data', (data) => {
            console.log(data.toString());
        });

        flutterBuildProcess.stderr.on('data', (data) => {
            console.error(data.toString());
        });

        flutterBuildProcess.on('close', (code) => {
            if (code === 0) {
                console.log('Flutter build completed successfully.');

                if (buildIOS) {
                    const xcodeBuildProcess = exec(
                        'xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -sdk iphoneos -configuration Release archive -archivePath ios/Runner.xcarchive -allowProvisioningUpdates',
                        { cwd: projectDir }
                    );

                    xcodeBuildProcess.stdout.on('data', (data) => {
                        console.log(data.toString());
                    });

                    xcodeBuildProcess.stderr.on('data', (data) => {
                        console.error(data.toString());
                    });

                    xcodeBuildProcess.on('close', (xcodeCode) => {
                        if (xcodeCode === 0) {
                            console.log('Xcode build and signing completed successfully.');
                            resolve();
                        } else {
                            console.error('Xcode build process failed.');
                            reject(new Error('Xcode build process exited with errors.'));
                        }
                    });
                } else {
                    resolve();
                }
            } else {
                console.error('Flutter build process failed.');
                reject(new Error('Flutter build process exited with errors.'));
            }
        });
    });
}

// Copy build outputs to a separate "shippable" folder
function copyToShippableFolder(projectDir, folderName) {
    console.log(`Preparing to copy build outputs to the shippable folder for "${folderName}"...`);

    const shippableAppDir = path.join(outputDir, folderName);

    // Clean up the existing shippable folder if it exists
    if (fs.existsSync(shippableAppDir)) {
        console.log(`Cleaning up existing folder: ${shippableAppDir}`);
        fs.removeSync(shippableAppDir);
        console.log('Existing folder cleaned up.');
    }

    // Create shippable folder if it doesn't exist
    fs.ensureDirSync(shippableAppDir);

    const androidApkPath = path.join(projectDir, 'build', 'app', 'outputs', 'apk', 'release', 'app-release.apk');
    const iosAppPath = path.join(projectDir, 'build', 'ios', 'iphoneos');

    // Copy Android APK
    if (fs.existsSync(androidApkPath)) {
        fs.copyFileSync(androidApkPath, path.join(shippableAppDir, 'app-release.apk'));
        console.log('Android APK copied to the shippable folder.');
    }

    // Copy iOS build folder
    if (fs.existsSync(iosAppPath)) {
        fs.copySync(iosAppPath, path.join(shippableAppDir, 'ios'));
        console.log('iOS build copied to the shippable folder.');
    }

    console.log('Build outputs copied to the shippable folder.');
}

// Main function to control the process
async function main() {
    const { flutterAppFolderName, bundleName, appName, offlineCategoryId, apiUrl, teamId, buildAndroid, buildIOS } = await promptUser();
    const flutterAppFolderPath = resolveFlutterAppPath(flutterAppFolderName);
    const projectDir = copyProject(flutterAppFolderPath, bundleName);

    // Pause the script and ask the user to apply Xcode changes manually if iOS build is selected
    if (buildIOS) {
        console.log('Please open your Xcode project and apply the necessary changes.');
        console.log('For example: Set the Development Team, ensure a valid Bundle ID, etc.');
        await confirmXcodeChanges();
    }

    // Step 2: Update Android and iOS files
    if (buildAndroid) {
        updateAndroidFiles(bundleName, appName, projectDir);
    }
    if (buildIOS) {
        updateIOSFilesAndSetupSigning(appName, projectDir, teamId);
    }
    updateConfigFiles(offlineCategoryId, apiUrl, projectDir);

    // Step 3: Build the app for selected platforms
    try {
        if (buildAndroid || buildIOS) {
            await buildApp(projectDir, buildAndroid, buildIOS);
            const folderName = convertBundleNameToFolderName(bundleName);
            copyToShippableFolder(projectDir, folderName);
            console.log('App is ready for deployment!');
        } else {
            console.log('No build process was selected.');
        }
    } catch (error) {
        console.error('An error occurred during the build process:', error);
    }
}

main();
