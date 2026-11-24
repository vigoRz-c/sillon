# Contributing to Sillon

Thanks for wanting to help! Sillon is a personal project in **beta**: feedback matters as much as code.

## Reporting a bug or suggesting an idea

- **Easiest:** write to me on Discord, **`_vigorz_`**.
- **On GitHub:** open an [issue](https://github.com/vigoRz-c/sillon/issues/new/choose) with the "Bug" or "Idea" template.

For a bug, attach the diagnostic: Settings → Diagnostic → "Copy the diagnostic", then paste it. It gives the version, Windows, the screens and the state of the scene, with no password or token.

A security flaw is not reported in a public issue: see [SECURITY.md](SECURITY.md).

## Proposing a code change

1. Fork the repository and create a branch from `main`.
2. Install [Node.js](https://nodejs.org) 20+ and [Rust](https://rustup.rs), then run:
   ```bash
   npm install
   npm start
   ```
3. Before sending, check that everything passes:
   ```bash
   npm run verify        # syntax, ESLint, types, Prettier, JavaScript tests, and Rust if cargo is installed
   npm run verify:rust   # formatting, clippy (warnings = errors) and tests of the native helper
   ```
   Without Rust, `npm run verify` skips the Rust step with a message; the CI always runs it. If you change `native/sillon-helper`, run `npm run verify:rust`.
4. Open a pull request explaining the problem fixed and how you checked it (a screenshot is welcome for a visible change). The CI runs the same checks again.

### Conventions

- **Language:** code, comments, logs, tests and commit messages are in English. The interface is in English with a French translation: every visible text goes through `src/renderer/shared/locales/en.js` and `fr.js` (`test/i18n.test.js` checks that both have the same keys).
- **Commits:** a short title in the imperative that says what changes ("Fix the clock size"), then the details if needed.
- **Style:** 2-space indentation, see `.editorconfig` and `eslint.config.js`.
- **Tests:** add a test in `test/` when you touch the logic (lyrics, position, layout…). They run with `npm test` (Node's built-in runner).
- **Dependencies:** as few as possible; justify any addition in the pull request.
- **Data:** nothing must leave the PC without a reason (see "Data and privacy" in the README). No secret in the repository.

## Publishing a version (maintainer)

Move the entries of the "Unreleased" section of [CHANGELOG.md](../CHANGELOG.md) under the number of the new version (`## [x.y.z] - YYYY-MM-DD`): `npm run release` refuses to publish without this section, and uses it as the Release notes. The script runs `npm run verify`, builds, then pushes and publishes (see the README).

## License

By contributing, you agree that your contribution is published under [GPL-3.0](../LICENSE), like the rest of the project.
