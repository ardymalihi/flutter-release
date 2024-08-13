const inquirer = require('inquirer');
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

// Update Android files
function updateAndroidFiles(bundleName, appName, projectDir) {
  const androidManifestPath = path.join(projectDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const buildGradlePath = path.join(projectDir, 'android', 'app', 'build.gradle');

  // Update AndroidManifest.xml
  let androidManifest = fs.readFileSync(androidManifestPath, 'utf8');
  androidManifest = androidManifest.replace(/package="[^"]+"/, `package="${bundleName}"`);
  fs.writeFileSync(androidManifestPath, androidManifest, 'utf8');

  // Update build.gradle
  let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
  buildGradle = buildGradle.replace(/applicationId "[^"]+"/, `applicationId "${bundleName}"`);
  fs.writeFileSync(buildGradlePath, buildGradle, 'utf8');
}

// Update iOS files
function updateIOSFiles(appName, projectDir) {
  const infoPlistPath = path.join(projectDir, 'ios', 'Runner', 'Info.plist');

  // Update Info.plist
  let infoPlist = fs.readFileSync(infoPlistPath, 'utf8');
  infoPlist = infoPlist.replace(/<key>CFBundleName<\/key>\s*<string>[^<]+<\/string>/, `<key>CFBundleName</key>\n\t<string>${appName}</string>`);
  fs.writeFileSync(infoPlistPath, infoPlist, 'utf8');
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
    exec('flutter build apk && flutter build ios', { cwd: projectDir }, (err, stdout, stderr) => {
      if (err) {
        console.error(`Error during build: ${stderr}`);
        return reject(err);
      }
      console.log('Build completed successfully.');
      resolve(stdout);
    });
  });
}

// Copy build outputs to a separate "shippable" folder
function copyToShippableFolder(projectDir, folderName) {
  console.log('Copying build outputs to the shippable folder...');

  const androidApkPath = path.join(projectDir, 'build', 'app', 'outputs', 'apk', 'release', 'app-release.apk');
  const iosAppPath = path.join(projectDir, 'build', 'ios', 'iphoneos');
  const shippableAppDir = path.join(outputDir, folderName);

  // Create shippable folder if it doesn't exist
  fs.ensureDirSync(shippableAppDir);

  // Copy Android APK
  if (fs.existsSync(androidApkPath)) {
    fs.copyFileSync(androidApkPath, path.join(shippableAppDir, 'app-release.apk'));
  }

  // Copy iOS build folder
  if (fs.existsSync(iosAppPath)) {
    fs.copySync(iosAppPath, path.join(shippableAppDir, 'ios'));
  }

  console.log('Build outputs copied to the shippable folder.');
}

async function main() {
  const { flutterAppFolderName, bundleName, appName, offlineCategoryId, apiUrl } = await promptUser();
  const flutterAppFolderPath = resolveFlutterAppPath(flutterAppFolderName);  // Resolve path based on user input
  const projectDir = copyProject(flutterAppFolderPath, bundleName);  // Step 1: Create a copy of the project based on bundle name
  updateAndroidFiles(bundleName, appName, projectDir);
  updateIOSFiles(appName, projectDir);
  updateConfigFiles(offlineCategoryId, apiUrl, projectDir);

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
