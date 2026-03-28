# Jtzt Android APK

This folder contains the full no-Android-Studio Android packaging path for the TWA build.

## Layout

```text
apk/
  build.ps1              # one entrypoint for generate/build/sign/copy
  config/                # build inputs and examples
  release/               # final installable APK output
  scripts/               # helper automation
  twa/                   # generated Android project workspace
```

## What the website must provide

- `https://app.jtzt.com/manifest.webmanifest`
- `https://app.jtzt.com/.well-known/assetlinks.json`
- A valid HTTPS certificate
- An icon in the manifest, currently reused from `/favicon.svg`

## Build

Run:

```powershell
.\apk\build.ps1
```

The script will:

1. Generate or reuse the Bubblewrap project
2. Install or verify required Android SDK packages
3. Build the release APK
4. Sign it if needed
5. Copy the final artifact to `apk/release/Jtzt.apk`

## Configuration

- `apk/config/build-settings.json` holds the local defaults.
- `apk/config/assetlinks.json.example` is the release template for the server.
- `apk/config/bubblewrap-init-answers.txt` keeps the Bubblewrap defaults around for reference.

## Android behavior

- Android-specific behavior lives inside the generated project under `apk/twa/app/src/main/java/com/jtzt/app/`.
- Fullscreen policy is centralized in `apk/twa/app/src/main/java/com/jtzt/app/android/AndroidUiController.java`.
- `LauncherActivity` applies that policy at startup and when focus returns.
- A native kiosk controller is exposed through the launcher shortcut `Exit kiosk`.
- The production host is forced to `https://app.jtzt.com/` during build sync.

## Notes

- Bubblewrap is still the recommended path because it produces a normal installable APK without Android Studio.
- Keep your release keystore secure. For published builds, update `/.well-known/assetlinks.json` with the release certificate fingerprint.
