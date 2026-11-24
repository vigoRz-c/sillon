# Security

## Supported versions

Only the latest version published on the [Releases](https://github.com/vigoRz-c/sillon/releases) gets fixes. The installed version updates on its own.

## Reporting a flaw

**Do not open a public issue.** Use one of these private channels:

- the **"Report a vulnerability"** button of the repository's [Security](https://github.com/vigoRz-c/sillon/security/advisories/new) tab;
- a private message on Discord: **`_vigorz_`**.

Describe the flaw, how to reproduce it and the version concerned. I answer as soon as possible; the fix is published in a new version, then the flaw is made public with your agreement (and your name if you wish).

## What Sillon does with data

- The PC's sound is analyzed live, never recorded or sent.
- The Spotify tokens are encrypted by Windows and stay on the PC (`%APPDATA%/Sillon`).
- Only the track information (artist, album, title, duration) goes to public services, to find the cover and the lyrics.

The details are in the "Data and privacy" section of the [README](../README.md).

## Code signing and integrity

- **The installers are not signed**: Sillon does not have a code signing certificate yet. Without a signature, Windows SmartScreen warns at install time, and the automatic update trusts what is published on GitHub: a compromised GitHub account would be enough to ship a modified executable. This is the main known risk, and signing (or publishing from the CI only) is planned.
- **Signing without changing the code**: electron-builder only signs if a certificate environment variable is present when `npm run dist` or `npm run release` runs: `WIN_CSC_LINK` (or `CSC_LINK`) points to the `.pfx` certificate, `WIN_CSC_KEY_PASSWORD` or `CSC_KEY_PASSWORD` to its password. Without these variables, the build goes on unsigned, with the message "no code signing certificate configured". Never commit the certificate or the password.
- **Electron fuses** (`build.electronFuses` in `package.json`): `runAsNode`, `NODE_OPTIONS` and the `--inspect` arguments are disabled, and the application only loads from `app.asar`. The `app.asar` integrity check (`enableEmbeddedAsarIntegrityValidation`) is **not** enabled: with Electron 45.4.1 and electron-builder 26.18.1, the application stopped at launch on "ASAR Integrity Violation". To be looked at again before enabling it.
- The CI checks that `sillon-helper.exe` does not ship the VC++ runtime (`VCRUNTIME140`), and reads the fuses of the test package.
