# Contribuer à Sillon

Merci de vouloir aider ! Sillon est un projet perso en **bêta** : les retours comptent autant que le code.

## Signaler un bug ou proposer une idée

- **Le plus simple :** écris-moi sur Discord, **`_vigorz_`**.
- **Sur GitHub :** ouvre une [issue](https://github.com/vigoRz-c/sillon/issues/new/choose) avec le modèle « Bug » ou « Idée ».

Pour un bug, joins le diagnostic : Paramètres → Diagnostic → « Copier le diagnostic », puis colle-le. Il indique la version, Windows, les écrans et l'état de la scène, sans mot de passe ni jeton.

Une faille de sécurité ne se signale pas dans une issue publique : voir [SECURITY.md](SECURITY.md).

## Proposer une modification du code

1. Forke le dépôt et crée une branche depuis `main`.
2. Installe [Node.js](https://nodejs.org) 20+ et [Rust](https://rustup.rs), puis lance :
   ```bash
   npm install
   npm start
   ```
3. Avant d'envoyer, vérifie que tout passe :
   ```bash
   npm run verify        # syntaxe, ESLint, Prettier, tests JavaScript, et Rust si cargo est installé
   npm run verify:rust   # formatage, clippy (avertissements = erreurs) et tests de l'assistant natif
   ```
   Sans Rust, `npm run verify` saute l'étape Rust avec un message ; la CI, elle, la lance toujours. Si tu modifies `native/sillon-helper`, lance `npm run verify:rust`.
4. Ouvre une pull request en expliquant le problème réglé et comment tu as vérifié (capture d'écran bienvenue pour un changement visible). La CI relance les mêmes vérifications.

### Conventions

- **Langue :** l'interface, les commentaires et les messages de commit sont en français.
- **Commits :** un titre court au présent qui dit ce qui change (« Corrige la taille de l'horloge »), puis le détail si besoin.
- **Style :** indentation de 2 espaces, voir `.editorconfig` et `eslint.config.js`.
- **Tests :** ajoute un test dans `test/` quand tu touches à la logique (paroles, position, disposition…). Ils se lancent avec `npm test` (runner intégré de Node).
- **Dépendances :** le moins possible ; justifie tout ajout dans la pull request.
- **Données :** rien ne doit quitter le PC sans raison (voir « Données et vie privée » dans le README). Aucun secret dans le dépôt.

## Publier une version (mainteneur)

Range les entrées de la section « Non publié » de [CHANGELOG.md](../CHANGELOG.md) sous le numéro de la nouvelle version (`## [x.y.z] - AAAA-MM-JJ`) : `npm run release` refuse de publier sans cette section, et l'utilise comme notes de la Release. Le script lance `npm run verify`, construit, puis pousse et publie (voir le README).

## Licence

En contribuant, tu acceptes que ta contribution soit publiée sous [GPL-3.0](../LICENSE), comme le reste du projet.
