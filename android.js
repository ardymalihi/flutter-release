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

    // Update AndroidManifest.xml with the new package name and app name
    let androidManifest = fs.readFileSync(androidManifestPath, 'utf8');
    const oldPackageNameMatch = androidManifest.match(/package="([^"]+)"/);
    if (!oldPackageNameMatch) {
        throw new Error('Could not find the package name in AndroidManifest.xml');
    }
    const oldPackageName = oldPackageNameMatch[1];
    const oldPackagePath = path.join(kotlinPath, ...oldPackageName.split('.'));

    androidManifest = androidManifest.replace(/package="[^"]+"/, `package="${bundleName}"`);
    androidManifest = androidManifest.replace(/android:label="[^"]+"/, `android:label="${appName}"`);
    fs.writeFileSync(androidManifestPath, androidManifest, 'utf8');

    // Update build.gradle with the new applicationId
    let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
    buildGradle = buildGradle.replace(/applicationId "[^"]+"/, `applicationId "${bundleName}"`);
    fs.writeFileSync(buildGradlePath, buildGradle, 'utf8');

    // Update the package structure
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

// Update environment variables or configuration files
function updateConfigFiles(offlineCategoryId, apiUrl, projectDir) {
    const configFilePath = path.join(projectDir, 'lib', 'config.dart'); // Assuming a config.dart file exists
    let configContent = fs.readFileSync(configFilePath, 'utf8');
    configContent = configContent.replace(/const int OFFLINE_CATEGORY_ID = [^']*;/, `const int OFFLINE_CATEGORY_ID = ${offlineCategoryId};`);
    configContent = configContent.replace(/const String API_URL = '[^']*';/, `const String API_URL = '${apiUrl}';`);
    fs.writeFileSync(configFilePath, configContent, 'utf8');

}

// Build the Flutter app for Android
function buildApp(projectDir) {
    return new Promise((resolve, reject) => {
        console.log('Building Flutter app...');



        const buildCommand = 'flutter build apk';
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
                resolve();
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

    // Ensure the shippable folder exists
    fs.ensureDirSync(shippableAppDir);

    const androidApkPath = path.join(projectDir, 'build', 'app', 'outputs', 'apk', 'release', 'app-release.apk');

    console.log(`Checking Android APK at: ${androidApkPath}`);

    // Copy Android APK to shippable folder
    if (fs.existsSync(androidApkPath)) {
        fs.copyFileSync(androidApkPath, path.join(shippableAppDir, 'app-release.apk'));
        console.log('Android APK copied to the shippable folder.');
    } else {
        console.error('Android APK not found!');
    }

    console.log('Build outputs copied to the shippable folder.');
}



// Main function to control the process
async function main() {
    const { flutterAppFolderName, bundleName, appName, offlineCategoryId, apiUrl } = await promptUser();
    const flutterAppFolderPath = resolveFlutterAppPath(flutterAppFolderName);
    const projectDir = copyProject(flutterAppFolderPath, bundleName);

    // Step 2: Update Android files
    updateAndroidFiles(bundleName, appName, projectDir);
    updateConfigFiles(offlineCategoryId, apiUrl, projectDir);

    // Step 3: Build the app for selected platforms
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
