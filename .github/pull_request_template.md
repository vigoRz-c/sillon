## Ce que ça change

<!-- Le problème réglé ou la fonction ajoutée, en deux ou trois phrases. -->

## Comment c'est vérifié

<!-- Ce que tu as testé, sur quelle version de Windows ; capture d'écran pour un changement visible. -->

- [ ] `npm run verify` passe (syntaxe, ESLint, Prettier, tests JavaScript, Rust si cargo est installé)
- [ ] `npm run verify:rust` passe, si `native/sillon-helper` est modifié
- [ ] Pour une modification des pages : `demo/index.html` s'affiche toujours (les pages sont chargées telles quelles)
- [ ] Testé dans l'appli (`npm start`)
- [ ] CHANGELOG.md mis à jour (section « Non publié », en français)
