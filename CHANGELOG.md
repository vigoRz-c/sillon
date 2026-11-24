# Changelog

All notable changes to Sillon. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), version numbers follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Karaoke: the whole line is readable as soon as it starts, with the upcoming words pale and the next word a little stronger; the next line is announced in small type below (when it comes in less than 8 s).
- Ctrl+Alt keyboard shortcuts for almost everything, even when Sillon is not in the foreground: play / pause (P), next (N), previous (B), shuffle (A), repeat (R), full screen (F), show / hide Sillon (H), scene or strip (T), next visualizer (V), next colors (C), screen saver (L), lyrics shown or not (U), lyrics later / earlier (J / K), settings (O), scene editor (G), strip placement (D). The list is in the settings (Behavior tab), which flag a combination already taken by another application; one checkbox turns them all off (also in the tray icon menu). The active combinations are shown in the tray icon menu. None uses a key that types a character with AltGr (€, @, #, {…).
- Sillon is now in English, with a French translation. The language follows Windows by default (French on a French Windows, English otherwise) and can be chosen in the settings (Advanced tab, "Language"). Every window, the tray icon menu, the update and Spotify messages switch right away.

### Changed
- The repository is in English: README (French version in `README.fr.md`), comments, tests, scripts, GitHub documents and this changelog.

## [0.4.4] - 2026-11-24

Karaoke better timed on lyrics without word-by-word timing.

### Fixed
- Karaoke: on lyrics without word-by-word timing, a slowly sung line no longer lights up in two or three seconds (which ran ahead, then behind). The time is spread until the next line, according to the syllables of each word, and the line stays shown as long as it is sung. With word-by-word timing, a held note colors its word to the end (3 s instead of 1.5 s).

## [0.4.3] - 2026-11-24

The disc intensity no longer touches the light behind it.

### Changed
- "Disc intensity" now only sets the ring (rays, wave, dots…): the glow behind the disc no longer brightens or grows with it.

## [0.4.2] - 2026-11-24

Four new shapes for the disc ring of the scene and the screen saver.

### Added
- Four new shapes for the disc ring (scene and screen saver), on top of the fine and thick rays: Wave, Dots, Arcs and Ripples. Chosen in the settings (Scene tab, "Disc ring") and in the scene editor.

## [0.4.1] - 2026-11-24

Fixes for 0.4.0: strip placement usable again, full-screen shortcut help shown only on request.

### Fixed
- "Move / resize the strip": with the strip on the wallpaper under Windows 11, neither "Done" nor the handle responded (the whole window served to move it), and Sillon had to be quit. Placement now happens in a separate window, like the scene editor, without detaching the strip from the wallpaper; Esc or Enter also finish.

### Changed
- Full screen: the shortcut help no longer shows on every mouse move; press **?** (or **H**) to show or hide it. Screen readers still read it.

## [0.4.0] - 2026-11-24

Customization (color wheel, four new visualizers) and a second pass of the 0.3.0 audit: each page limited to its own messages, non-blocking disk cache, type checking.

### Added
- Color wheel in the settings (Colors tab): hue and saturation on the wheel, lightness on the slider, or a hex code. The chosen color becomes the "Custom color" set of the strip, the full screen and the screen saver, and can also color the scene's disc ("Custom" swatch, or in the scene editor). Usable with the keyboard.
- Four new visualizers: Spectrum (smooth filled curve), Dots (light matrix), Sparks (particles rising with the sound) and Rosette (rotating spectrum petals). Chosen in the settings, the tray icon menu and the full screen (V key); the first three also for the "Bars" element of the scene editor.

### Security
- Each page can only ask for what it needs: the buttons window cannot sign out of Spotify, the screen saver's black screen can only leave it. A refused request is noted in the diagnostic.
- The screen saver's black screens (secondary screens) are an app page instead of a `data:` page, with the same security rules as the others.
- The native helper refuses a command that is too long instead of running it truncated.

### Performance
- The cover is no longer sent again to the pages on every volume or playback change: it is sent once, then only when it changes.
- The cover and lyrics cache reads and writes the disk without blocking the main process; a damaged entry is deleted.

### Internal
- Commands and exit codes of the native helper gathered in a single module (`helper-protocol.js`).
- Type checking (JSDoc, `npm run typecheck`) on the main modules, also in CI.
- Pre-commit hook: ESLint and formatting of the changed files.
- New tests: check of the pages that send messages, Spotify sign-in (success, missing code, refusal), update errors, sending the cover; no more real-time waits in the tests.
- Build tool dependency (`minimatch`) updated: `npm audit` no longer reports anything.

## [0.3.1] - 2026-11-24

Quick fixes from the 0.3.0 audit: permissions limited to Sillon's pages, failed startup reported, less work when the scene is hidden.

### Security
- Only Sillon's pages get permissions (sound capture, clipboard); any other request is refused and noted in the diagnostic.
- Window security preferences written explicitly (isolation, sandbox, no Node), and page security rules (CSP) completed (`object-src`, `base-uri`, `form-action`).
- Spotify sign-in: a return without a code is refused cleanly, and the return page is no longer cached and sends no referrer.

### Fixed
- A failed startup no longer leaves Sillon running without an icon: a message is shown and the app closes. Unexpected errors are noted in the diagnostic.
- A keyboard shortcut already taken by another application (Ctrl+Alt+F as well as Ctrl+Alt+L) is reported in the diagnostic.
- Track duration: no more absurd value when a player announces an end before the start.

### Performance
- The Spotify queue is no longer read when the scene is hidden, asleep or covered by a game; it is read again on wake-up.
- The wallpaper is no longer sent again to the pages when it has not changed.
- Cover memory cache limited to 30 images (instead of 200).

## [0.3.0] - 2026-11-23

New color sets, redone settings window, full audit of 0.2.0 and about thirty bugs fixed.

### Added
- 14 new color sets for the visualizer and the disc: Cyberpunk, Synthwave, Acid, Pastel, Lavender, Peach, Mint, Forest, Embers, Ice, Desert, Gold and black, Blood red, Midnight. Every list (settings, scene editor, tray icon menu, full-screen C shortcut) comes from the same catalog.

### Changed
- By default, the scene no longer hides on its own without music ("Hide the scene without music after": Never). Before, it went to sleep after 5 minutes, even when a game or a program without media controls was making sound. Existing installs keep their setting.
- New settings window: wider, with a menu on the left (Layout, Scene, Visualizer, Colors, Sound, Behavior, Spotify, Advanced), an animated preview of the visualizer with the chosen style and colors, and a search across every setting (accents and case ignored, Ctrl+F). Colors are picked on swatches sorted by family (Image, Classics, Bright, Soft, Natural, Dark), usable with the keyboard.

### Fixed
- Screen saver: it no longer starts during a full-screen video or game (it then locked the PC).
- Play / pause: Sillon sends "play" or "pause" according to the known state instead of a toggle, with a fallback on the Spotify API if Spotify ignores the command. A command sent while the helper restarts is replayed.
- Player followed first: it no longer hides another player that plays while it is paused. Media events follow the right session after Spotify restarts.
- Player sound: a passing failure no longer switches to all the PC's sound for good; a player that cannot be found is no longer restarted every 3 seconds; the capture helper stops with Sillon.
- Settings: a file that is unreadable for a moment (antivirus, sync) is no longer overwritten with the default values.
- Lyrics: search started again when the track duration arrives late, new attempt after a network outage, words reset after seeking back, no more doubled line after an offset, no more frozen lyrics when the player does not give the duration.
- Spotify: a token that does not renew is no longer hidden by an empty queue.
- Full screen: the shortcuts (V, C, arrows, [ ]) still work after clicking a button.
- Rendering: an error in a visualizer no longer freezes the animation; the Ring no longer crashes in a very small window.
- Scene editor: Esc and Ctrl+Z work after setting a slider; a simple click no longer clutters the undo history; the bars' "Style" list shows the right choice.
- Strip: changing the layout during its placement no longer gives it the size of the whole screen.
- Misc: cover colors reset if the image is unreadable, volume slider no longer stuck, update no longer stuck on "downloading", correct game mode on two screens with different scales.
- Native helper: cargo is run from the helper's folder, so `.cargo/config.toml` (static linking of the C runtime) is finally applied. On a PC without the Visual C++ redistributable, the helper starts and per-application capture and media info work.
- Hidden disc: bars no longer show in full screen.
- Lyrics: those of the previous track no longer stay on screen during a search or after the player stops.
- Covers: a network outage or an API refusal no longer caches "no cover" for 7 days.
- Media helper: writing to a stopped helper no longer crashes the main process, and restarts are spaced out.
- Helper: unknown commands get an answer instead of being silently ignored. A panic writes "ERR 5 …" on the error output before stopping; new exit code 6 for an error reading the standard input.
- Full screen: the V and C shortcuts no longer show "undefined" for the recent styles and colors (Blocks, Halo, Violet). The tray icon menu and the full screen use the same list.
- Sound reading: the helper is no longer restarted every 3 seconds when Spotify is closed.

### Security
- Windows: no new window and no navigation away from the loaded page (`secure.js`).
- Electron process: `runAsNode`, `NODE_OPTIONS` and `--inspect` argument fuses turned off, loading only from `app.asar`.
- IPC messages: sender check (only Sillon's pages) and settings validated against an allow list.
- GitHub actions pinned by commit SHA.
- Code signing: the build signs only if a certificate is provided through environment variables (documented in `SECURITY.md`). Without a certificate, the installers stay unsigned.

### Performance
- Rest: the scene sleeps when the music has not played for a while, and the sound capture stops with it, instead of running all the time.
- Polling of the media controls replaced by their system events.
- The animation loop no longer re-arms while paused.

### Accessibility
- New "Reduce animations and glows" setting: it stops the edge light and glow pulses on the bass beat.

### Tooling
- CI: file re-encoded in UTF-8; actions pinned by SHA; `persist-credentials: false`; Cargo cache; `cargo fmt`, `clippy -D warnings`, `cargo test --locked` and `cargo build --locked` from the helper's folder; `npm audit --omit=dev` and `cargo audit`; JavaScript tests on Node 20 and 22; packaging job without publishing; check that `sillon-helper.exe` does not embed `VCRUNTIME140`; `windows-2025`.
- `npm run verify:rust` (Rust formatting, clippy, tests); `npm run verify` includes it when cargo is installed.
- `npm run lint` fails on any warning (`--max-warnings 0`).
- `npm run release`: refuses to publish without a `## [x.y.z]` section in this changelog; builds before pushing the commit and the tag; undoes the local commit and tag if the build or the push fails; uses the section as the Release notes; publishes `SHA256SUMS.txt`.
- Demo: loads the real pages (`src/renderer/pages`) with a fake bridge that exposes every preload method; the outdated HTML copies are deleted.
- Tests: IPC contract checked on every run (preload channels, channels sent by the main process, the pages' `bridge.X`, demo); publishing tests. The helper has 28 Rust tests.
- Dependabot: follows the GitHub actions (grouped) and the Rust crate; `windows-core` and `windows-future` are still updated by hand together with `windows`.
- README, CONTRIBUTING and pull request template updated (Rust and MSVC prerequisites, `npm run verify`).

## [0.2.0] - 2026-11-23

### Changed
- Memory: about 700 MB → 430 MB. The two PowerShell scripts (current track, volume, player sound) are replaced by a small native helper written in Rust (about 8 MB instead of 155 MB, instant startup), and Chromium's graphics cache is capped (about 120 MB less, with no visible difference).
- Development: Rust is needed to build the helper (`native/sillon-helper`), built automatically by `npm start`.

## [0.1.9] - 2026-11-22

### Added
- Player volume bar in the scene buttons and in full screen: sets the sound of Spotify (or of the followed player) in the Windows mixer, without touching the general volume or the other applications. Click the speaker to mute, scroll to adjust.

## [0.1.8] - 2026-11-22

### Added
- "Analyzed sound" setting: by default, Sillon now listens only to the followed player (Spotify, browser…). Voice chat (Discord, TeamSpeak), notifications and games no longer move the visualizer. Falls back on all the PC's sound if Windows does not allow it.

### Changed
- Dependencies: koffi 3, ESLint 10.

## [0.1.7] - 2026-11-22

### Added
- Automatic checks on GitHub (CI): syntax, ESLint rules and tests on every push.
- ESLint, `.editorconfig`, Dependabot, contributing guide, security policy, code of conduct, issue and pull request templates.

### Fixed
- Cover search: "live" versions were meant to be left out, but the filter did not work (invisible characters in the expression).

## [0.1.6] - 2026-11-22

### Fixed
- Enlarging the lyrics no longer enlarges the clock.
- The settings page no longer freezes while scrolling (visualizer previews drawn only when visible, at 30 fps, paused while scrolling).

## [0.1.5] - 2026-11-22

### Changed
- Fewer resources: glows of the rays, bars, ring and halo grouped together (about a third less graphics work at 60 fps).
- 30 frames per second by default; installs set to 60 switch to 30 once.
- Music paused: the scene runs at 15 fps.

## [0.1.4] - 2026-11-21

### Changed
- Settings reorganized into Layout, Scene and Visualizer; only the settings useful for the chosen display are shown.

## [0.1.3] - 2026-11-21

### Added
- Scene editor: each element (disc, lyrics, big title, cover, "Now playing", buttons, "Up next", clock, bars) can be moved, resized, shown or hidden; templates, snapping, undo, keyboard shortcuts.
- Shuffle and repeat buttons through the Spotify API.
- Blocks and Halo visualizers, Violet theme, thick rays, disc glow, edge light, cover rings, clock, preview gallery.

### Fixed
- The scene buttons are put back above the desktop if they go under it.

## [0.1.2] - 2026-11-21

### Added
- Diagnostic to copy from the settings or the tray icon menu.

## [0.1.1] - 2026-11-21

### Added
- Automatic updates through GitHub Releases.

### Fixed
- Publishing: a single GitHub Release per version.

## [0.1.0] - 2026-11-21

First public version: visualizer on the Windows wallpaper, scene (disc, synced lyrics, "now playing" panel, queue), screen saver, full screen, Spotify sign-in.

[Unreleased]: https://github.com/vigoRz-c/sillon/compare/v0.4.4...HEAD
[0.4.4]: https://github.com/vigoRz-c/sillon/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/vigoRz-c/sillon/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/vigoRz-c/sillon/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/vigoRz-c/sillon/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/vigoRz-c/sillon/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/vigoRz-c/sillon/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/vigoRz-c/sillon/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vigoRz-c/sillon/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/vigoRz-c/sillon/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/vigoRz-c/sillon/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/vigoRz-c/sillon/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/vigoRz-c/sillon/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/vigoRz-c/sillon/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/vigoRz-c/sillon/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/vigoRz-c/sillon/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/vigoRz-c/sillon/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vigoRz-c/sillon/releases/tag/v0.1.1
[0.1.0]: https://github.com/vigoRz-c/sillon/commit/e7b9a19
