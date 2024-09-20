const inquirer = require('inquirer').default;
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const sharp = require('sharp');

// Define the parent directory for sibling folders
const parentDir = path.resolve(__dirname, '..');
const outputDir = path.join(__dirname, 'shippable');

// Keystore file name
const keystoreFileName = 'my-release-key.jks';

// Check if keytool is installed
function checkKeytoolInstalled() {
    return new Promise((resolve, reject) => {
        exec('keytool -help', (error, stdout, stderr) => {
            if (error) {
                resolve(false); // keytool is not installed
            } else {
                resolve(true); // keytool is installed
            }
        });
    });
}

// Prompt user for app settings and the Flutter app folder name
async function promptUser() {
    const currentTimestampInSeconds = Math.floor(Date.now() / 1000);  // Unix timestamp in seconds

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
            name: 'androidProductId',
            message: 'Enter the ANDROID_PRODUCT_ID:',
            default: 'com.prepto.ccp.premium_access'
        },
        {
            name: 'versionName',
            message: 'Enter the app version (e.g., 1.0.0):',
            default: '1.0.0',
            when: (answers) => answers.buildMode === 'Release'  // Only ask in Release mode
        },
        {
            name: 'versionCode',
            message: 'Enter the app version code:',
            default: currentTimestampInSeconds.toString(),  // Use Unix timestamp in seconds as default
            validate: function (input) {
                return !isNaN(parseInt(input)) || 'Version code must be a number.';
            },
            when: (answers) => answers.buildMode === 'Release'  // Only ask in Release mode
        }
    ]);
    return answers;
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

// Update Android files and package structure
function updateAndroidFiles(bundleName, appName, projectDir) {
    const androidManifestPath = path.join(projectDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    const buildGradlePath = path.join(projectDir, 'android', 'app', 'build.gradle');
    const kotlinPath = path.join(projectDir, 'android', 'app', 'src', 'main', 'kotlin');

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

    let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
    buildGradle = buildGradle.replace(/applicationId "[^"]+"/, `applicationId "${bundleName}"`);

    fs.writeFileSync(buildGradlePath, buildGradle, 'utf8');

    const packageParts = bundleName.split('.');
    const newPackagePath = path.join(kotlinPath, ...packageParts);
    fs.ensureDirSync(newPackagePath);

    const mainActivityFile = fs.existsSync(path.join(oldPackagePath, 'MainActivity.kt')) ? 'MainActivity.kt' : 'MainActivity.java';
    fs.moveSync(path.join(oldPackagePath, mainActivityFile), path.join(newPackagePath, mainActivityFile));

    const mainActivityPath = path.join(newPackagePath, mainActivityFile);
    let mainActivityContent = fs.readFileSync(mainActivityPath, 'utf8');
    mainActivityContent = mainActivityContent.replace(/package .+;/, `package ${bundleName};`);
    fs.writeFileSync(mainActivityPath, mainActivityContent, 'utf8');
}

// Update environment variables or configuration files
function updateConfigFiles(offlineCategoryId, apiUrl, androidProductId, projectDir) {
    const configFilePath = path.join(projectDir, 'lib', 'config.dart');
    let configContent = fs.readFileSync(configFilePath, 'utf8');
    configContent = configContent.replace(/const int OFFLINE_CATEGORY_ID = [^;]*;/, `const int OFFLINE_CATEGORY_ID = ${offlineCategoryId};`);
    configContent = configContent.replace(/const String API_URL = '[^']*';/, `const String API_URL = '${apiUrl}';`);
    configContent = configContent.replace(/const String ANDROID_PRODUCT_ID = '[^']*';/, `const String ANDROID_PRODUCT_ID = '${androidProductId}';`);
    fs.writeFileSync(configFilePath, configContent, 'utf8');
}

// Update App Icons
const updateAppIcon = async (projectDir) => {
    const iconPath = path.join(__dirname, 'icon.png');
    if (await fs.pathExists(iconPath)) {
        console.log('Custom icon found. Updating app icons...');

        // Define target sizes and directories for Android
        const androidTargets = [
            { size: 48, dir: 'mipmap-mdpi' },
            { size: 72, dir: 'mipmap-hdpi' },
            { size: 96, dir: 'mipmap-xhdpi' },
            { size: 144, dir: 'mipmap-xxhdpi' },
            { size: 192, dir: 'mipmap-xxxhdpi' }
        ];

        // Resize and copy icons for Android
        await Promise.all(androidTargets.map(async target => {
            const destPath = path.join(projectDir, 'android', 'app', 'src', 'main', 'res', target.dir, 'ic_launcher.png');
            await sharp(iconPath)
                .resize(target.size, target.size) // Resize icon to the target size
                .toFile(destPath); // Save resized icon
        }));

        console.log('Android app icons updated.');
    } else {
        console.log('No custom icon found. Using default Flutter app icon.');
    }
};

// Update pubspec.yaml with versionName and versionCode
function updatePubspecVersion(versionName, versionCode, projectDir) {
    const pubspecPath = path.join(projectDir, 'pubspec.yaml');
    let pubspecContent = fs.readFileSync(pubspecPath, 'utf8');

    const versionRegex = /version:\s*([0-9.]+)\+([0-9]+)/;
    pubspecContent = pubspecContent.replace(versionRegex, `version: ${versionName}+${versionCode}`);

    fs.writeFileSync(pubspecPath, pubspecContent, 'utf8');
    console.log(`Updated pubspec.yaml with version: ${versionName}+${versionCode}`);
}

// Generate the release keystore if it doesn't exist
async function generateKeystore(projectDir) {
    const defaultKeystorePath = path.join(__dirname, keystoreFileName);
    const keystorePath = path.join(projectDir, 'android', keystoreFileName);

    const defaultKeyPropertiesPath = path.join(__dirname, 'key.properties');
    const keyPropertiesPath = path.join(projectDir, 'android', 'key.properties');

    if (await fs.pathExists(defaultKeystorePath)) {
        console.log('Keystore already exists. Skipping keystore generation.');
        fs.copyFile(defaultKeystorePath, keystorePath, (err) => {
            if (err) {
                console.error('Error copying the keystore file:', err);
                return;
            }
            console.log('Keystore file copied successfully to:', keystorePath);
        });
        fs.copyFile(defaultKeyPropertiesPath, keyPropertiesPath, (err) => {
            if (err) {
                console.error('Error copying the key properties file:', err);
                return;
            }
            console.log('Key properties file copied successfully to:', keystorePath);
        });
    } else {
        console.log('Keystore not found. Generating a new keystore...');

        const keystoreDetails = await inquirer.prompt([
            {
                name: 'keyAlias',
                message: 'Enter a key alias for your keystore:',
                default: 'ccp'
            },
            {
                type: 'password',
                name: 'keyPassword',
                message: 'Enter a password for your keystore (at least 6 characters):',
                mask: '*',
                validate: function (input) {
                    return input.length >= 6 || 'Password must be at least 6 characters long.';
                }
            },
            {
                name: 'validity',
                message: 'Enter the validity period (in days):',
                default: '10000',
                validate: function (input) {
                    return !isNaN(parseInt(input)) || 'Please enter a valid number.';
                }
            },
            {
                name: 'name',
                message: 'Enter your full name:',
                default: 'Ardalan Malihi'
            },
            {
                name: 'organizationUnit',
                message: 'Enter your organizational unit:',
                default: 'omix'
            },
            {
                name: 'organization',
                message: 'Enter your organization:',
                default: 'omix'
            },
            {
                name: 'city',
                message: 'Enter your city or locality:',
                default: 'Vancouver'
            },
            {
                name: 'state',
                message: 'Enter your state or province:',
                default: 'BC'
            },
            {
                name: 'countryCode',
                message: 'Enter your country code (e.g., US):',
                default: 'CA',
                validate: function (input) {
                    return input.length === 2 || 'Country code must be 2 characters.';
                }
            }
        ]);

        const keyPropertiesPath = path.join(projectDir, 'android', 'key.properties');

        const keystoreConfig = `
        storePassword=${keystoreDetails.keyPassword}
        keyPassword=${keystoreDetails.keyPassword}
        keyAlias=${keystoreDetails.keyAlias}
        storeFile=../${keystoreFileName}
        `;

        fs.writeFileSync(keyPropertiesPath, keystoreConfig.trim(), 'utf8');

        const keytoolCommand = `keytool -genkeypair -v -keystore "${defaultKeystorePath}" -alias "${keystoreDetails.keyAlias}" -keyalg RSA -keysize 2048 -validity ${keystoreDetails.validity} -storepass "${keystoreDetails.keyPassword}" -keypass "${keystoreDetails.keyPassword}" -dname "CN=${keystoreDetails.name}, OU=${keystoreDetails.organizationUnit}, O=${keystoreDetails.organization}, L=${keystoreDetails.city}, S=${keystoreDetails.state}, C=${keystoreDetails.countryCode}"`;

        return new Promise((resolve, reject) => {
            exec(keytoolCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error generating keystore: ${stderr}`);
                    reject(error);
                } else {
                    console.log('Keystore generated successfully.');
                    fs.copyFile(defaultKeystorePath, keystorePath, (err) => {
                        if (err) {
                            console.error('Error copying the keystore file:', err);
                            return;
                        }
                        console.log('Keystore file copied successfully to:', keystorePath);
                    });
                    resolve(defaultKeystorePath);
                }
            });
        });
    }
}

// Build the Flutter app for Android (APK and AAB)
function buildApp(projectDir, buildMode) {
    return new Promise((resolve, reject) => {
        console.log(`Building Flutter app in ${buildMode} mode...`);
        let buildCommand = '';

        if (buildMode === 'Release') {
            buildCommand = 'flutter build apk --release && flutter build appbundle --release';
        } else {
            buildCommand = 'flutter build apk --debug';
        }

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

// Copy build outputs (APK and AAB) to a separate "shippable" folder
function copyToShippableFolder(projectDir, folderName, buildMode) {
    console.log(`Preparing to copy build outputs to the shippable folder for "${folderName}"...`);

    const shippableAppDir = path.join(outputDir, folderName);

    // Ensure the shippable folder exists
    fs.ensureDirSync(shippableAppDir);

    if (buildMode === 'Release') {
        // Copy APK
        const androidApkPath = path.join(projectDir, 'build', 'app', 'outputs', 'apk', 'release', 'app-release.apk');
        console.log(`Checking Android APK at: ${androidApkPath}`);
        if (fs.existsSync(androidApkPath)) {
            fs.copyFileSync(androidApkPath, path.join(shippableAppDir, 'app-release.apk'));
            console.log('Android APK copied to the shippable folder.');
        } else {
            console.error('Android APK not found!');
        }

        // Copy AAB
        const androidAabPath = path.join(projectDir, 'build', 'app', 'outputs', 'bundle', 'release', 'app-release.aab');
        console.log(`Checking Android AAB at: ${androidAabPath}`);
        if (fs.existsSync(androidAabPath)) {
            fs.copyFileSync(androidAabPath, path.join(shippableAppDir, 'app-release.aab'));
            console.log('Android AAB copied to the shippable folder.');
        } else {
            console.error('Android AAB not found!');
        }
    } else {
        // Copy Debug APK
        const androidApkPath = path.join(projectDir, 'build', 'app', 'outputs', 'apk', 'debug', 'app-debug.apk');
        console.log(`Checking Android APK at: ${androidApkPath}`);
        if (fs.existsSync(androidApkPath)) {
            fs.copyFileSync(androidApkPath, path.join(shippableAppDir, 'app-debug.apk'));
            console.log('Android APK copied to the shippable folder.');
        } else {
            console.error('Android APK not found!');
        }
    }
}

// Main function to control the process
async function main() {
    const { buildMode, flutterAppFolderName, bundleName, appName, offlineCategoryId, apiUrl, androidProductId, versionName, versionCode } = await promptUser();
    const flutterAppFolderPath = resolveFlutterAppPath(flutterAppFolderName);
    
    try {
        const projectDir = await copyProject(flutterAppFolderPath, bundleName);
        await updateAppIcon(projectDir);

        updateAndroidFiles(bundleName, appName, projectDir);
        updateConfigFiles(offlineCategoryId, apiUrl, androidProductId, projectDir);

        // Conditionally update the version in pubspec.yaml if in Release mode
        if (buildMode === 'Release') {
            console.log('Release mode selected. Updating app version...');
            updatePubspecVersion(versionName, versionCode, projectDir);

            const isKeytoolInstalled = await checkKeytoolInstalled();
            if (!isKeytoolInstalled) {
                console.error('Error: keytool is not installed on your system.');
                process.exit(1);
            }

            // Generate keystore if it doesn't exist
            await generateKeystore(projectDir);
        } else {
            console.log('Debug mode selected. Skipping version update.');
        }

        await buildApp(projectDir, buildMode);

        const folderName = convertBundleNameToFolderName(bundleName);
        copyToShippableFolder(projectDir, folderName, buildMode);

        console.log('App is ready for deployment!');
    } catch (error) {
        console.error('An error occurred:', error.message);
    }
}

main();
