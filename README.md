# flutter-release
Automate Flutter Apps

key.properties and my-release.jks should generated only once for each project.

make sure the files are not redundant for each project.

when creating a new app with different name and bundle, delete those two files, the script will generate a new one.

note: when deploy and sign, you can't change it anymore.


build for web: 
after Android build then call this command under shippable/[namespace]
flutter build web --base-href="/flutter-web/"
