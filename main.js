const inquirer = require('inquirer').default;
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

// Define the parent directory for sibling folders
const parentDir = path.resolve(__dirname, '..'); // This will give you the parent directory path
const outputDir = path.join(__dirname, 'shippable'); // This will place the output in the shippable folder within flutter-release

// Prompt user for app settings and the Flutter app folder name
async function promptUser() {
    const answers = await inquirer.prompt([
        {
            name: 'flutterAppFolderName',
            message: 'Enter the name or path of your Flutter app folder:',
        },
        {
            name: 'bundleName',
            message: 'Enter the new bundle name (e.g., com.example.app):',
        },
        {
            name: 'appName',
            message: 'Enter the new app name:',
        },
        {
            name: 'offlineCategoryId',
            message: 'Enter the OFFLINE_CATEGORY_ID:',
        },
        {
            name: 'apiUrl',
            message: 'Enter the API_URL:',
        },
        {
            name: 'teamId',
            message: 'Enter your Apple Development Team ID:',
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
function copyProject(flutterAppFolderPath, bundleName) {
    const folderName = convertBundleNameToFolderName(bundleName);
    const appDir = path.join(outputDir, folderName);

    console.log(`Creating a copy of the project in folder "${folderName}"...`);
    fs.copySync(flutterAppFolderPath, appDir);
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
    // Example: Update an environment file or a specific Dart file with the provided values
    const envFilePath = path.join(projectDir, '.env'); // Assuming you have a .env file

    let envFileContent = `OFFLINE_CATEGORY_ID=${offlineCategoryId}\nAPI_URL=${apiUrl}\n`;

    fs.writeFileSync(envFilePath, envFileContent, 'utf8');

    // Alternatively, if you store these variables in a Dart file
    const configFilePath = path.join(projectDir, 'lib', 'config.dart'); // Assuming a config.dart file exists
    if (fs.existsSync(configFilePath)) {
        let configContent = fs.readFileSync(configFilePath, 'utf8');
        configContent = configContent.replace(/const String OFFLINE_CATEGORY_ID = '[^']*';/, `const String OFFLINE_CATEGORY_ID = '${offlineCategoryId}';`);
        configContent = configContent.replace(/const String API_URL = '[^']*';/, `const String API_URL = '${apiUrl}';`);
        fs.writeFileSync(configFilePath, configContent, 'utf8');
    }
}

// Build the Flutter app for Android and iOS
function buildApp(projectDir) {
    return new Promise((resolve, reject) => {
        console.log('Building Flutter app for Android and iOS...');
        const buildProcess = exec('flutter clean && flutter build apk --verbose && flutter build ios --verbose', { cwd: projectDir });

        buildProcess.stdout.on('data', (data) => {
            console.log(data.toString());
        });

        buildProcess.stderr.on('data', (data) => {
            console.error(data.toString());
        });

        buildProcess.on('close', (code) => {
            if (code === 0) {
                console.log('Build completed successfully.');
                resolve();
            } else {
                console.error(`Build process exited with code ${code}`);
                reject(new Error(`Build process exited with code ${code}`));
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


async function main() {
    const { flutterAppFolderName, bundleName, appName, offlineCategoryId, apiUrl, teamId } = await promptUser();
    const flutterAppFolderPath = resolveFlutterAppPath(flutterAppFolderName);  // Resolve path based on user input
    const projectDir = copyProject(flutterAppFolderPath, bundleName);  // Step 1: Create a copy of the project based on bundle name

    // Step 2: Update Android and iOS files
    updateAndroidFiles(bundleName, appName, projectDir);
    updateIOSFilesAndSetupSigning(appName, projectDir, teamId);
    updateConfigFiles(offlineCategoryId, apiUrl, projectDir);

    // Step 3: Build the app
    try {
        await buildApp(projectDir);
        const folderName = convertBundleNameToFolderName(bundleName);
        copyToShippableFolder(projectDir, folderName);
        console.log('App is ready for deployment!');
    } catch (error) {
        console.error('An error occurred during the build process:', error);
    }
}

main();
