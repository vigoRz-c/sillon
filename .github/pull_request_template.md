## What this changes

<!-- The problem fixed or the feature added, in two or three sentences. -->

## How it was checked

<!-- What you tested, on which Windows version; a screenshot for a visible change. -->

- [ ] `npm run verify` passes (syntax, ESLint, Prettier, JavaScript tests, Rust if cargo is installed)
- [ ] `npm run verify:rust` passes, if `native/sillon-helper` is changed
- [ ] For a change to the pages: `demo/index.html` still shows (the pages are loaded as they are)
- [ ] New visible texts added to `src/renderer/shared/locales/en.js` and `fr.js`
- [ ] Tested in the app (`npm start`)
- [ ] CHANGELOG.md updated ("Unreleased" section)
