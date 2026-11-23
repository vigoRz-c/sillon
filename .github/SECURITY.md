# Sécurité

## Versions suivies

Seule la dernière version publiée sur les [Releases](https://github.com/vigoRz-c/sillon/releases) reçoit des correctifs. La version installée se met à jour toute seule.

## Signaler une faille

**N'ouvre pas d'issue publique.** Utilise l'un de ces moyens privés :

- le bouton **« Report a vulnerability »** de l'onglet [Security](https://github.com/vigoRz-c/sillon/security/advisories/new) du dépôt ;
- un message privé sur Discord : **`_vigorz_`**.

Décris la faille, comment la reproduire et la version concernée. Je réponds dès que possible ; le correctif est publié dans une nouvelle version, puis la faille est rendue publique avec ton accord (et ton nom si tu le souhaites).

## Ce que Sillon fait des données

- Le son du PC est analysé en direct, jamais enregistré ni envoyé.
- Les jetons Spotify sont chiffrés par Windows et restent sur le PC (`%APPDATA%/Sillon`).
- Seules les informations du morceau (artiste, album, titre, durée) partent vers des services publics, pour trouver la pochette et les paroles.

Le détail est dans la section « Données et vie privée » du [README](../README.md).

## Signature de code et intégrité

- **Les installateurs ne sont pas signés** : Sillon n'a pas encore de certificat de signature de code. Sans signature, Windows SmartScreen prévient à l'installation, et la mise à jour automatique fait confiance à ce qui est publié sur GitHub : un compte GitHub compromis suffirait à diffuser un exécutable modifié. C'est le principal risque connu, et la signature (ou une publication depuis la CI seulement) est prévue.
- **Signer sans changer le code** : electron-builder signe seulement si une variable d'environnement de certificat est présente au moment de `npm run dist` ou `npm run release` : `WIN_CSC_LINK` (ou `CSC_LINK`) désigne le certificat `.pfx`, `WIN_CSC_KEY_PASSWORD` ou `CSC_KEY_PASSWORD` son mot de passe. Sans ces variables, la construction se poursuit sans signature, avec le message « no code signing certificate configured ». Ne jamais committer le certificat ni le mot de passe.
- **Fusibles Electron** (`build.electronFuses` dans `package.json`) : `runAsNode`, `NODE_OPTIONS` et les arguments `--inspect` sont désactivés, et l'application ne se charge que depuis `app.asar`. La vérification d'intégrité d'`app.asar` (`enableEmbeddedAsarIntegrityValidation`) n'est **pas** activée : avec Electron 45.4.1 et electron-builder 26.18.1, l'application s'arrêtait au lancement sur « ASAR Integrity Violation ». À réexaminer avant de l'activer.
- La CI vérifie que `sillon-helper.exe` n'embarque pas le runtime VC++ (`VCRUNTIME140`), et lit les fusibles de l'empaquetage de test.
