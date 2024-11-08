const inquirer = require('inquirer').default;
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const sharp = require('sharp');  // Ensure sharp is installed via npm

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
            default: 'https://www.prepto.pro'
        },
        {
            name: 'teamId',
            message: 'Enter your Apple Development Team ID:',
            default: 'ZBWAG62J88'
        }
    ]);
    return answers;
}

// Function to update iOS files and setup xcconfig for automated signing
function updateIOSFilesAndSetupSigning(bundleName, appName, projectDir, teamId) {
    const infoPlistPath = path.join(projectDir, 'ios', 'Runner', 'Info.plist');
    const xcconfigPath = path.join(projectDir, 'ios', 'config', 'build.xcconfig');

    let infoPlist = fs.readFileSync(infoPlistPath, 'utf8');
    infoPlist = infoPlist.replace(/<key>CFBundleName<\/key>\s*<string>[^<]+<\/string>/, `<key>CFBundleName</key>\n\t<string>${appName}</string>`);
    fs.writeFileSync(infoPlistPath, infoPlist, 'utf8');

    const xcconfigContent = `
CODE_SIGN_STYLE = Automatic
DEVELOPMENT_TEAM = ${teamId}
CODE_SIGN_IDENTITY = iPhone Developer
    `;
    fs.ensureDirSync(path.dirname(xcconfigPath));
    fs.writeFileSync(xcconfigPath, xcconfigContent.trim(), 'utf8');

    console.log('iOS files and signing configurations updated.');
}

// Function to update iOS app icons
async function updateIOSAppIcons(flutterAppFolderPath, projectDir) {
    const iconPath = path.join(flutterAppFolderPath, 'icon.png');
    const appIconSetPath = path.join(projectDir, 'ios', 'Runner', 'Assets.xcassets', 'AppIcon.appiconset');
    const iosIconSizes = [
        { size: 20, scales: [2, 3] }, // Notification
        { size: 29, scales: [1, 2, 3] }, // Settings and Spotlight
        { size: 40, scales: [2, 3] }, // Spotlight
        { size: 60, scales: [2, 3] } // App
    ];

    if (await fs.pathExists(iconPath)) {
        console.log('Custom iOS icon found. Updating iOS app icons...');
        await Promise.all(iosIconSizes.flatMap(({ size, scales }) =>
            scales.map(scale => {
                const dimension = size * scale;
                const iconName = `Icon-${dimension}.png`;
                return sharp(iconPath)
                    .resize(dimension, dimension)
                    .toFile(path.join(appIconSetPath, iconName));
            })
        ));
        console.log('iOS app icons updated.');
    } else {
        console.log('No custom iOS icon found. Using default Flutter app icon.');
    }
}

// Build the iOS app
function buildIOSApp(projectDir) {
    console.log('Building iOS app...');
    return new Promise((resolve, reject) => {
        const buildCommand = 'xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -sdk iphoneos -configuration Release archive -archivePath ios/Runner.xcarchive -allowProvisioningUpdates';
        const xcodeBuildProcess = exec(buildCommand, { cwd: projectDir });

        xcodeBuildProcess.stdout.on('data', (data) => {
            console.log(data.toString());
        });

        xcodeBuildProcess.stderr.on('data', (data) => {
            console.error(data.toString());
        });

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
}

// Main function to control the process
async function main() {
    const { flutterAppFolderName, bundleName, appName, offlineCategoryId, apiUrl, teamId } = await promptUser();
    const flutterAppFolderPath = resolveFlutterAppPath(flutterAppFolderPath);
    const projectDir = await copyProject(flutterAppFolderPath, bundleName);

    updateIOSFilesAndSetupSigning(bundleName, appName, projectDir, teamId);
    await updateIOSAppIcons(flutterAppFolderPath, projectDir);  // Update iOS app icons

    try {
        await buildIOSApp(projectDir);
        console.log('App is ready for deployment!');
    } catch (error) {
        console.error('An error occurred during the build process:', error);
    }
}

main();
