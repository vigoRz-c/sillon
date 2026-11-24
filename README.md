# Sillon

**English** · [Français](README.fr.md)

[![CI](https://github.com/vigoRz-c/sillon/actions/workflows/ci.yml/badge.svg)](https://github.com/vigoRz-c/sillon/actions/workflows/ci.yml) [![Latest version](https://img.shields.io/github/v/release/vigoRz-c/sillon?label=version)](https://github.com/vigoRz-c/sillon/releases/latest) [![License GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

A music visualizer that lives **on the Windows wallpaper**, behind every window, and reacts to what you listen to on Spotify.

> **Beta project (version 0.2).** Sillon is still changing: bugs are possible. If you find one, or have an idea to improve it, contact me on Discord: **`_vigorz_`**. See also [CONTRIBUTING.md](.github/CONTRIBUTING.md), the [security policy](.github/SECURITY.md) and the [changelog](CHANGELOG.md).

- A scene across the whole desktop: the cover as a disc with sun rays and a halo (intensity, position and size can be set), synced karaoke lyrics with the previous line as a ghost, a "now playing" panel with buttons (shuffle, repeat, hide…) and an "Up next" queue
- Screen saver (**Ctrl + Alt + L** or after inactivity) that locks the session when you leave it
- Discreet: stops during a full-screen game or video, dims on pause, hides when there is no music
- 11 visualizers for the strip and the full screen: Bars, Mirror, Blocks, Ring, Halo, Wave, Aurora, Spectrum, Dots, Sparks, Rosette
- 8 color sets: Cover colors, Wallpaper colors (taken from the desktop image), Spotify, Neon, Sunset, Ocean, Violet, White, and a custom color picked on a color wheel
- Title, artist, cover and progress of the current track
- Full-screen mode (**Ctrl + Alt + F**): cover in the center, a drifting blurred background, waves on the bass
- A "Reduce animations and glows" setting for people sensitive to motion or pulsing lights
- No account: works with Spotify **and** any player shown in the Windows media controls (YouTube in the browser, VLC…)
- In English or French: follows the Windows language, or set it in Settings → Advanced → Language

Windows 10 and 11.

## Running the project

Requirements:

- [Node.js](https://nodejs.org) 20 or later;
- [Rust](https://rustup.rs) (**MSVC** toolchain, rustup's default on Windows) for the native helper `native/sillon-helper`, built automatically by `npm start`;
- **Visual Studio Build Tools** with the **"Desktop development with C++"** workload: the MSVC toolchain (linker and Windows SDK) needs it to build Rust on Windows. The resulting binary does not need the Visual C++ redistributable: it is statically linked (`native/sillon-helper/.cargo/config.toml`).

```bash
npm install
npm start
```

Without Rust, `npm start` still starts, but without the current track or the player-only sound: a message says so.

The Sillon icon appears in the notification area (bottom right). Everything is set from its menu.

Build the installer and the portable version (in `dist/`):

```bash
npm run dist
```

`npm run dist` **requires Rust**: the helper must be built to be included in the installer (`build-helper --strict`).

`Sillon-Setup-<version>.exe` installs the app; `Sillon-<version>-portable.exe` runs without installing. They are not signed: Windows SmartScreen may ask "More info → Run anyway". Preparing code signing is described in the [security policy](.github/SECURITY.md).

### Automatic updates

The **installed** version looks for new versions on the [GitHub Releases](https://github.com/vigoRz-c/sillon/releases) at startup and then every 4 hours, downloads them in the background and installs them on exit (or right away with "Restart to install" in the icon menu). Can be turned off in Settings → Advanced. The portable version and `npm start` do not update.

Publish a new version (**public** repository, GitHub CLI signed in, clean and up-to-date `main` branch):

```bash
npm run release              # 0.2.0 -> 0.2.1
npm run release -- minor     # 0.2.0 -> 0.3.0
npm run release -- major     # 0.2.0 -> 1.0.0
```

Before running it, the `## [x.y.z]` section for the new version must exist in `CHANGELOG.md`: its content becomes the Release notes. The script runs `npm run verify` (tests, lint, formatting, Rust if present), bumps the version and creates the commit and the tag **locally**, builds the installer and the portable version, computes `SHA256SUMS.txt`, and only then pushes the commit and the tag and publishes the Release. If the build or the push fails, the local commit and tag are undone. Friends who installed Sillon get the update on their own.

### Checks

```bash
npm run verify        # syntax, ESLint, types, Prettier, tests, and Rust if cargo is installed
npm run typecheck     # type checking (JSDoc) of the files marked // @ts-check
npm run verify:rust   # formatting, clippy (warnings = errors) and Rust tests; fails without cargo
npm test              # JavaScript tests only (node --test)
```

On each commit, a hook (installed by `npm install`, see `simple-git-hooks` in `package.json`) checks ESLint and the formatting of the changed files.

The CI (`.github/workflows/ci.yml`) runs the same: JavaScript tests on Node 20 and 22, Rust, audits (`npm audit`, `cargo audit`), packaging without publishing, and a check that the helper does not ship the VC++ runtime.

Preview the visuals in a browser, without Windows and with a synthetic sound: serve the repository from its root (for example `npx --yes http-server -p 8080`), then open **http://localhost:8080/demo/**. The demo shows the real pages of `src/renderer/pages` with a fake bridge (`demo/fake-bridge.js`), so it cannot drift from the application. The sound starts after a click in the page.

## Usage

Menu of the icon in the notification area:

| Entry | Effect |
|---|---|
| Play / pause, Next, Previous, Shuffle, Repeat | Controls Spotify (or the active player) |
| Lyrics of this track | Shifts the lyrics (±0.25 s) when LRCLIB has those of another version; remembered per track |
| Show Sillon on the desktop again | After "hide" from the panel |
| Style | Choice of visualizer |
| Colors | Cover, Wallpaper, Spotify, Neon, Sunset, Ocean, Violet, White |
| Position | On the wallpaper · Always on top · Normal window |
| Options | Track shown or not, sensitivity, opacity, frames per second, followed player, launch at startup |
| Move / resize… | The widget comes to the front: drag it, pull the corner, then "Done" |
| Full screen | Same as Ctrl + Alt + F |
| Screen saver | Same as Ctrl + Alt + L |
| Settings… | All settings, including the disc (intensity, size, position), the scene's screen, game mode, the screen saver, "Reduce animations and glows", the language and the Spotify account |

In full screen: **Space** play/pause · **← →** previous/next track · **V** next visualizer · **C** next colors · **[ ]** shift the lyrics · **?** show the shortcuts help · **Esc** quit.

## How it works

| Need | Solution |
|---|---|
| Know what is playing | The Windows media controls (SMTC), read by the native helper `native/sillon-helper` (Rust). It is the same source as the media panel of the Windows volume flyout: no connection to Spotify. |
| Show the right cover | Spotify sometimes gives Windows a picture of the video instead of the cover. `src/main/media/cover-lookup.js` looks up, on Deezer's public search (no account), the cover of the studio album the track is on, or else that of the EP or single: only the artist, album and title are sent. Nothing reliable found: the Windows picture is kept. |
| Synced lyrics | `src/main/media/lyrics.js` asks [LRCLIB](https://lrclib.net) (free, no account) for them, word by word when available: only the artist, title, album and duration are sent. No synced lyrics: the title is shown instead. |
| Queue | `src/main/media/spotify-api.js`: Spotify Web API (optional), PKCE sign-in without a secret, tokens encrypted by Windows. The owner of the Spotify developer app must be Premium (Spotify's rule since February 2026). |
| Offline | `src/main/media/disk-cache.js` keeps the covers and lyrics already found in `%APPDATA%/Sillon/cache`. |
| Game mode | `SHQueryUserNotificationState` (full screen reported by Windows) + the foreground window covers the scene's screen. |
| Scene buttons | The scene is under the desktop icons and gets no clicks: the panel buttons are a small separate window (`controls.html`), kept at the very bottom of the window stack. |
| React to the sound | **Per application**: the native helper captures only the sound of the followed player (Spotify, browser…), which leaves out voice chat, notifications and games. **Fallback**: if Windows does not allow per-application capture, Sillon listens to all the PC's sound (Electron's "loopback" capture, `getDisplayMedia` + `audio: 'loopback'`). Never the microphone. The sound is neither recorded nor sent anywhere. Setting: Settings → "Analyzed sound". |
| Be on the wallpaper | `src/main/windows/wallpaper.js` puts the window in Explorer's `WorkerW` (via `koffi` + `user32.dll`), with a variant for Windows 11 24H2. Re-attaches automatically if Explorer restarts. |
| Draw | Canvas 2D (`src/renderer/shared/visualizers.js`, loop in `engine.js`), FFT analysis in logarithmic bands (35 Hz → 16 kHz). The visualizers and colors come from a single catalog, `src/renderer/shared/catalog.js`. |
| Languages | English is the source language. `src/renderer/shared/i18n.js` translates the pages from `src/renderer/shared/locales/` (`en.js`, `fr.js`); the main process (`src/main/app/i18n.js`) uses the same texts for the menu and notifications, and tells the pages when the language changes. |

```
src/
  main/
    app/
      main.js            wiring, startup, single instance
      state.js           state shared between modules
      ipc.js             registration of the IPC channels (each checks the sender)
      ipc-guard.js       IPC sender checks (only our pages)
      settings.js        saved settings (%APPDATA%/Sillon/settings.json)
      settings-schema.js default values and validation of the settings
      settings-store.js  tolerant reading and atomic writing of the settings
      preload.js         secure page ↔ main process bridge
      i18n.js            language of the main process (menu, notifications) and of the pages
      shortcuts.js       global Ctrl+Alt keyboard shortcuts
      rest.js            scene rest (sleeps when the music stops)
      diagnostic.js      copyable report for bug reports
      updater.js         automatic updates
    windows/
      widget-window.js   scene / strip on the wallpaper
      controls-window.js buttons of the scene panel
      windows.js         full screen and settings
      layout-editor.js   scene customization
      veille.js          screen saver
      tray.js            icon menu
      wallpaper.js       wallpaper attachment and Win32 calls
      secure.js          window hardening (no new window, no navigation)
    media/
      media.js           "now playing" source + playback position
      now-playing.js     current track, cover, lyrics, offset
      queue.js           queue (Spotify API)
      cover-lookup.js    official cover (Deezer)
      lyrics.js          synced lyrics (LRCLIB)
      spotify-api.js     connection to the Spotify API (PKCE)
      text-norm.js       normalization of titles and artists (Deezer and LRCLIB searches)
      disk-cache.js      disk cache of covers and lyrics
    audio/
      app-audio.js       analyzed sound: only the player, or the whole PC
      app-ids.js         mapping between the media session and the listened program
      audio-utils.js     pure audio functions, helper restart delays
      capture.js         system sound, wallpaper colors
      helper.js          starts the native helper (sillon-helper.exe)
  renderer/
    pages/
      widget.*           the scene and the strip
      scene-editor.js    scene layout editor (widget.html?edit=1)
      controls.*         panel buttons
      fullscreen.*       full screen and screen saver
      settings.*         settings window
    shared/
      catalog.js         visualizers and color sets (single source)
      audio-engine.js    audio analysis (capture, bands, beat), simulated audio
      colors.js          palettes (cover, color), color opacity
      visualizers.js     visualizers (including the disc), glowing edge, rings
      engine.js          render loop, track position, builds window.SV
      common.js          logic shared by the widget and the full screen
      lyrics-view.js     karaoke lyrics
      scene-layout.js    scene layout (templates, placement)
      volume-control.js  player volume bar
      pcm-worklet.js     reads the captured sound for the analysis
      shortcuts.js       list of keyboard shortcuts (single source)
      i18n.js            page translation (English by default, French)
      locales/           interface texts: en.js, fr.js
    style.css            styles of every page
native/
  sillon-helper/       native helper in Rust: current track (SMTC),
                       player volume, capture of the player's sound only
                       (.cargo/config.toml: statically linked C runtime)
scripts/               helper build, checks, publishing
  build-helper.js      builds the helper (cargo, from its folder)
  check.js             syntax of every JavaScript file
  verify-rust.js       Rust formatting, clippy and tests
  release.js           publishing (see "Automatic updates")
  release-lib.js       pure publishing functions (version, notes, SHA-256)
test/                  tests (node --test)
demo/                  browser preview: real pages + fake bridge + synthetic sound
.github/               CI, Dependabot, issue and pull request templates, security
```

## Connecting Spotify (queue, optional)

**Simple**: Settings → **Spotify account** → **Sign in to Spotify**, then accept in the browser. Sillon uses its built-in Spotify app.

Spotify limits this built-in app (development mode) to **5 accounts**, which its owner adds one by one in *User Management* of the [dashboard](https://developer.spotify.com/dashboard). An account that was not added is refused, with a message that explains it.

**With your own app** (if you are not one of these 5 accounts, or if you got Sillon from GitHub):

1. Tick **Use my own Client ID** and open the link to the [developer dashboard](https://developer.spotify.com/dashboard). A **Premium** account is needed (Spotify's rule since February 2026).
2. **Create app**: tick **Web API**, add the Redirect URI `http://127.0.0.1:43821/callback`.
3. Paste the **Client ID** into Sillon, then **Sign in to Spotify**.

The Client ID built into the code is not a secret: with PKCE sign-in, it only identifies the app.

The same connection could later be used to like a track or add it to a playlist.

## Data and privacy

Sillon has no server and collects nothing. What leaves your PC:

| To | What | Why |
|---|---|---|
| [Deezer](https://developers.deezer.com/api) (public API) | artist, album, title | find the album cover |
| [LRCLIB](https://lrclib.net) | artist, title, album, duration | find the synced lyrics |
| [Spotify](https://developer.spotify.com/documentation/web-api) (only if you connect your account) | access token | read the queue, set shuffle and repeat |
| [GitHub](https://github.com/vigoRz-c/sillon/releases) (installed version, updates on) | nothing personal | know whether a new version exists |

Sillon used to be called Spoti-View: on first launch, it takes over the settings and cache of `%APPDATA%/Spoti-View` (only the Spotify account needs to be connected again).

The PC's sound is analyzed live and never recorded or sent. The settings, the cache and the Spotify tokens (encrypted by Windows) stay in `%APPDATA%/Sillon`.

## Project status

**Beta** (version 0.2). Bugs, ideas, feedback: write to me on Discord, **`_vigorz_`**. For a bug, attach the diagnostic if you can (Settings → Diagnostic → "Copy the diagnostic"): it contains no password or token.

Tested on Windows 11 24H2 with Electron 45: wallpaper attachment (including with Wallpaper Engine), two screens, sound capture, media controls, lyrics, queue, screen saver and packaged version. If the wallpaper attachment does not work on your Windows version, the "Always on top" or "Normal window" mode remains usable.

## License

[GPL-3.0](LICENSE): you may use, study, change and redistribute Sillon; any changed version you distribute must stay under GPL-3.0, with its source code.

Independent project, not affiliated with Spotify, Deezer or LRCLIB. Spotify is a trademark of Spotify AB. The covers and lyrics shown belong to their rights holders.
