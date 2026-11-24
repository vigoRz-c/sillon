# Sillon

[English](README.md) · **Français**

[![CI](https://github.com/vigoRz-c/sillon/actions/workflows/ci.yml/badge.svg)](https://github.com/vigoRz-c/sillon/actions/workflows/ci.yml) [![Dernière version](https://img.shields.io/github/v/release/vigoRz-c/sillon?label=version)](https://github.com/vigoRz-c/sillon/releases/latest) [![Licence GPL-3.0](https://img.shields.io/badge/licence-GPL--3.0-blue)](LICENSE)

Visualiseur musical qui vit **sur le fond d'écran Windows**, derrière toutes les fenêtres, et réagit à ce que tu écoutes sur Spotify.

> **Projet en bêta (version 0.2).** Sillon évolue encore : des bugs sont possibles. Si tu en trouves un, ou si tu as une idée pour l'améliorer, contacte-moi sur Discord : **`_vigorz_`**. Voir aussi [CONTRIBUTING.md](.github/CONTRIBUTING.md), la [politique de sécurité](.github/SECURITY.md) et le [journal des versions](CHANGELOG.md).

- Scène sur tout le bureau : pochette en disque avec rayons en soleil et halo (intensité, position et taille réglables), paroles synchronisées en karaoké avec la ligne précédente en fantôme, panneau « en lecture » avec boutons (aléatoire, répéter, masquer…) et file d'attente « À suivre »
- Écran de veille (**Ctrl + Alt + L** ou après inactivité) qui verrouille la session en sortant
- Discret : s'arrête pendant un jeu ou une vidéo en plein écran, s'atténue en pause, se masque sans musique
- 11 visualiseurs pour le bandeau et le plein écran : Barres, Miroir, Blocs, Anneau, Halo, Onde, Aurore, Spectre, Points, Étincelles, Rosace
- 8 jeux de couleurs : Couleurs de la pochette, Couleurs du fond d'écran (tirées de l'image du bureau), Spotify, Néon, Coucher de soleil, Océan, Violet, Blanc, et une couleur personnalisée choisie sur une roue des couleurs
- Titre, artiste, pochette et progression du morceau en cours
- Mode plein écran (**Ctrl + Alt + F**) : pochette au centre, fond flouté qui dérive, ondes sur les basses
- Réglage « Réduire les animations et les lueurs » pour les personnes sensibles au mouvement ou aux lumières qui pulsent
- Aucun compte : fonctionne avec Spotify **et** tout lecteur qui s'affiche dans les contrôles média de Windows (YouTube dans le navigateur, VLC…)
- En anglais ou en français : suit la langue de Windows, ou se règle dans Paramètres → Avancé → Langue

Windows 10 et 11.

## Lancer le projet

Prérequis :

- [Node.js](https://nodejs.org) 20 ou plus ;
- [Rust](https://rustup.rs) (toolchain **MSVC**, celle par défaut de rustup sous Windows) pour l'assistant natif `native/sillon-helper`, compilé automatiquement par `npm start` ;
- **Visual Studio Build Tools** avec le composant **« Développement Desktop en C++ »** : la chaîne MSVC (linker et Windows SDK) en a besoin pour compiler Rust sous Windows. Le binaire produit n'a pas besoin du redistribuable Visual C++ : il est lié statiquement (`native/sillon-helper/.cargo/config.toml`).

```bash
npm install
npm start
```

Sans Rust, `npm start` démarre quand même, mais sans morceau en cours ni son du lecteur seul : un message l'indique.

L'icône Sillon apparaît dans la zone de notification (en bas à droite). Tout se règle depuis son menu.

Créer l'installateur et la version portable (dans `dist/`) :

```bash
npm run dist
```

`npm run dist` **exige Rust** : l'assistant doit être compilé pour être inclus dans l'installateur (`build-helper --strict`).

`Sillon-Setup-<version>.exe` installe l'app ; `Sillon-<version>-portable.exe` se lance sans installation. Ils ne sont pas signés : Windows SmartScreen peut demander « Informations complémentaires → Exécuter quand même ». La préparation de la signature de code est décrite dans la [politique de sécurité](.github/SECURITY.md).

### Mises à jour automatiques

La version **installée** cherche les nouvelles versions sur les [Releases GitHub](https://github.com/vigoRz-c/sillon/releases) au démarrage puis toutes les 4 heures, les télécharge en arrière-plan et les installe à la fermeture (ou tout de suite via « Redémarrer pour installer » dans le menu de l'icône). Réglable dans Paramètres → Avancé. La version portable et `npm start` ne se mettent pas à jour.

Publier une nouvelle version (dépôt **public**, GitHub CLI connecté, branche `main` propre et à jour) :

```bash
npm run release              # 0.2.0 -> 0.2.1
npm run release -- minor     # 0.2.0 -> 0.3.0
npm run release -- major     # 0.2.0 -> 1.0.0
```

Avant de lancer, la section `## [x.y.z]` correspondant à la nouvelle version doit exister dans `CHANGELOG.md` : son contenu sert de notes de la Release. Le script lance `npm run verify` (tests, lint, formatage, Rust si présent), passe la version et crée le commit et le tag **en local**, construit l'installateur et la version portable, calcule `SHA256SUMS.txt`, puis seulement pousse le commit et le tag et publie la Release. Si la construction ou le push échoue, le commit et le tag locaux sont annulés. Les amis qui ont installé Sillon reçoivent la mise à jour tout seuls.

### Vérifications

```bash
npm run verify        # syntaxe, ESLint, types, Prettier, tests, et Rust si cargo est installé
npm run typecheck     # vérification des types (JSDoc) des fichiers marqués // @ts-check
npm run verify:rust   # formatage, clippy (avertissements = erreurs) et tests Rust ; échoue sans cargo
npm test              # tests JavaScript seuls (node --test)
```

À chaque commit, un hook (installé par `npm install`, voir `simple-git-hooks` dans `package.json`) vérifie ESLint et le formatage des fichiers modifiés.

Ce qu'exécute la CI (`.github/workflows/ci.yml`) est la même chose : tests JavaScript sous Node 20 et 22, Rust, audits (`npm audit`, `cargo audit`), empaquetage sans publication et vérification que l'assistant n'embarque pas le runtime VC++.

Prévisualiser les visuels dans un navigateur, sans Windows et avec un son de synthèse : sers le dépôt depuis sa racine (par exemple `npx --yes http-server -p 8080`), puis ouvre **http://localhost:8080/demo/**. La démo affiche les vraies pages de `src/renderer/pages` avec un faux pont (`demo/fake-bridge.js`) : elle ne peut donc pas diverger de l'application. Le son démarre après un clic dans la page.

## Utilisation

Menu de l'icône dans la zone de notification :

| Entrée | Effet |
|---|---|
| Lecture / pause, Suivant, Précédent, Aléatoire, Répéter | Pilote Spotify (ou le lecteur actif) |
| Paroles de ce morceau | Décale les paroles (±0,25 s) quand LRCLIB a celles d'une autre version ; mémorisé par morceau |
| Réafficher Sillon | Après « masquer » depuis le panneau |
| Style | Choix du visualiseur |
| Couleurs | Pochette, Fond d'écran, Spotify, Néon, Coucher de soleil, Océan, Violet, Blanc |
| Position | Sur le fond d'écran · Toujours au premier plan · Fenêtre normale |
| Réglages | Morceau affiché ou non, sensibilité, opacité, images/s, lecteur suivi, lancement au démarrage |
| Déplacer / redimensionner… | Le widget passe devant : glisse-le, tire le coin, puis « Terminé » |
| Plein écran | Identique à Ctrl + Alt + F |
| Écran de veille | Identique à Ctrl + Alt + L |
| Paramètres… | Tous les réglages, dont le disque (intensité, taille, position), l'écran de la scène, le mode jeu, la veille, « Réduire les animations et les lueurs » et le compte Spotify |

En plein écran : **Espace** lecture/pause · **← →** morceau précédent/suivant · **V** visualiseur suivant · **C** couleurs suivantes · **[ ]** décaler les paroles · **?** afficher l'aide des raccourcis · **Échap** quitter.

## Comment ça marche

| Besoin | Solution |
|---|---|
| Savoir ce qui joue | Les contrôles média de Windows (SMTC), lus par l'assistant natif `native/sillon-helper` (Rust). C'est la même source que le panneau média du volume Windows : pas de connexion à Spotify. |
| Afficher la bonne pochette | Spotify transmet parfois à Windows une image du clip au lieu de la pochette. `src/main/media/cover-lookup.js` cherche sur la recherche publique de Deezer (sans compte) la pochette de l'album studio où figure le morceau, à défaut celle de l'EP ou du single : seuls l'artiste, l'album et le titre sont envoyés. Rien de fiable trouvé : on garde l'image de Windows. |
| Paroles synchronisées | `src/main/media/lyrics.js` les demande à [LRCLIB](https://lrclib.net) (gratuit, sans compte), mot par mot quand c'est disponible : seuls l'artiste, le titre, l'album et la durée sont envoyés. Pas de paroles synchronisées : le titre s'affiche à la place. |
| File d'attente | `src/main/media/spotify-api.js` : API Web Spotify (facultative), connexion PKCE sans secret, jetons chiffrés par Windows. Le propriétaire de l'app développeur Spotify doit être Premium (règle de Spotify depuis février 2026). |
| Hors ligne | `src/main/media/disk-cache.js` garde pochettes et paroles déjà trouvées dans `%APPDATA%/Sillon/cache`. |
| Mode jeu | `SHQueryUserNotificationState` (plein écran signalé par Windows) + la fenêtre au premier plan couvre l'écran de la scène. |
| Boutons de la scène | La scène est sous les icônes du bureau et ne reçoit pas les clics : les boutons du panneau sont une petite fenêtre à part (`controls.html`), gardée tout en bas de la pile des fenêtres. |
| Réagir au son | **Par application** : l'assistant natif capte seulement le son du lecteur suivi (Spotify, navigateur…), ce qui laisse de côté le chat vocal, les notifications et les jeux. **Repli** : si Windows ne permet pas la capture par application, Sillon écoute tout le son du PC (capture « loopback » d'Electron, `getDisplayMedia` + `audio: 'loopback'`). Jamais le micro. Le son n'est ni enregistré ni envoyé nulle part. Réglage : Paramètres → « Son analysé ». |
| Être sur le fond d'écran | `src/main/windows/wallpaper.js` place la fenêtre dans le `WorkerW` d'Explorer (via `koffi` + `user32.dll`), avec une variante pour Windows 11 24H2. Ré-accroche automatique si Explorer redémarre. |
| Dessiner | Canvas 2D (`src/renderer/shared/visualizers.js`, boucle dans `engine.js`), analyse FFT en bandes logarithmiques (35 Hz → 16 kHz). Les visualiseurs et les couleurs viennent d'un catalogue unique, `src/renderer/shared/catalog.js`. |

```
src/
  main/
    app/
      main.js            assemblage, démarrage, instance unique
      state.js           état partagé entre modules
      ipc.js             enregistrement des canaux IPC (chacun vérifie l'expéditeur)
      ipc-guard.js       contrôle des expéditeurs IPC (seulement nos pages)
      settings.js        réglages sauvegardés (%APPDATA%/Sillon/settings.json)
      settings-schema.js valeurs par défaut et validation des réglages
      settings-store.js  lecture tolérante et écriture atomique des réglages
      preload.js         pont sécurisé page ↔ processus principal
      i18n.js            langue du processus principal (menu, notifications) et des pages
      shortcuts.js       raccourcis clavier globaux Ctrl+Alt
      rest.js            repos de la scène (mise en veille quand la musique s'arrête)
      diagnostic.js      rapport copiable pour les signalements
      updater.js         mises à jour automatiques
    windows/
      widget-window.js   scène / bandeau sur le fond d'écran
      controls-window.js boutons du panneau de la scène
      windows.js         plein écran et paramètres
      layout-editor.js   personnalisation de la scène
      veille.js          écran de veille
      tray.js            menu de l'icône
      wallpaper.js       accroche au fond d'écran et appels Win32
      secure.js          durcissement des fenêtres (aucune nouvelle fenêtre, pas de navigation)
    media/
      media.js           source « morceau en cours » + position de lecture
      now-playing.js     morceau en cours, pochette, paroles, décalage
      queue.js           file d'attente (API Spotify)
      cover-lookup.js    pochette officielle (Deezer)
      lyrics.js          paroles synchronisées (LRCLIB)
      spotify-api.js     connexion à l'API Spotify (PKCE)
      text-norm.js       normalisation des titres et artistes (recherches Deezer et LRCLIB)
      disk-cache.js      cache disque des pochettes et paroles
    audio/
      app-audio.js       son analysé : seulement le lecteur, ou tout le PC
      app-ids.js         correspondance entre la session média et le programme écouté
      audio-utils.js     fonctions audio pures, délais de relance de l'assistant
      capture.js         son du système, couleurs du fond d'écran
      helper.js          lance l'assistant natif (sillon-helper.exe)
  renderer/
    pages/
      widget.*           la scène et le bandeau
      scene-editor.js    éditeur de disposition de la scène (widget.html?edit=1)
      controls.*         boutons du panneau
      fullscreen.*       plein écran et écran de veille
      settings.*         fenêtre de paramètres
    shared/
      catalog.js         visualiseurs et jeux de couleurs (source unique)
      audio-engine.js    analyse audio (capture, bandes, battement), audio simulé
      colors.js          palettes (pochette, couleur), opacité des couleurs
      visualizers.js     visualiseurs (dont le disque), bord lumineux, anneaux
      engine.js          boucle de rendu, position du morceau, assemble window.SV
      common.js          logique partagée widget / plein écran
      lyrics-view.js     paroles en karaoké
      scene-layout.js    disposition de la scène (modèles, placement)
      volume-control.js  barre de volume du lecteur
      pcm-worklet.js     lecture du son capturé pour l'analyse
      shortcuts.js       liste des raccourcis clavier (source unique)
      i18n.js            traduction des pages (anglais par défaut, français)
      locales/           textes de l'interface : en.js, fr.js
    style.css            styles de toutes les pages
native/
  sillon-helper/       assistant natif en Rust : morceau en cours (SMTC),
                       volume du lecteur, capture du son du seul lecteur
                       (.cargo/config.toml : runtime C lié statiquement)
scripts/               build de l'assistant, vérifications, publication
  build-helper.js      compile l'assistant (cargo, depuis son dossier)
  check.js             syntaxe de tous les fichiers JavaScript
  verify-rust.js       formatage, clippy et tests Rust
  release.js           publication (voir « Mises à jour automatiques »)
  release-lib.js       fonctions pures de la publication (version, notes, SHA-256)
test/                  tests (node --test)
demo/                  aperçu navigateur : vraies pages + faux pont + son de synthèse
.github/               CI, Dependabot, modèles d'issue et de pull request, sécurité
```

## Connecter Spotify (file d'attente, facultatif)

**Simple** : Paramètres → **Compte Spotify** → **Se connecter à Spotify**, puis accepte dans le navigateur. Sillon utilise son app Spotify intégrée.

Spotify limite cette app intégrée (mode développement) à **5 comptes**, que son propriétaire ajoute un par un dans *User Management* de son [tableau de bord](https://developer.spotify.com/dashboard). Un compte non ajouté est refusé, avec un message qui l'explique.

**Avec ta propre app** (si tu n'es pas dans ces 5 comptes, ou si tu as récupéré Sillon sur GitHub) :

1. Coche **Utiliser mon propre Client ID** et ouvre le lien vers le [tableau de bord développeurs](https://developer.spotify.com/dashboard). Il faut un compte **Premium** (règle de Spotify depuis février 2026).
2. **Create app** : coche **Web API**, ajoute la Redirect URI `http://127.0.0.1:43821/callback`.
3. Colle le **Client ID** dans Sillon, puis **Se connecter à Spotify**.

Le Client ID intégré dans le code n'est pas un secret : avec la connexion PKCE, il identifie seulement l'app.

La même connexion pourrait servir plus tard au like ou à l'ajout à une playlist.

## Données et vie privée

Sillon n'a pas de serveur et ne collecte rien. Ce qui sort de ton PC :

| Vers | Quoi | Pourquoi |
|---|---|---|
| [Deezer](https://developers.deezer.com/api) (API publique) | artiste, album, titre | trouver la pochette de l'album |
| [LRCLIB](https://lrclib.net) | artiste, titre, album, durée | trouver les paroles synchronisées |
| [Spotify](https://developer.spotify.com/documentation/web-api) (seulement si tu connectes ton compte) | jeton d'accès | lire la file d'attente, régler aléatoire et répétition |
| [GitHub](https://github.com/vigoRz-c/sillon/releases) (version installée, mises à jour activées) | rien de personnel | savoir s'il existe une nouvelle version |

Sillon s'appelait auparavant Spoti-View : au premier lancement, il reprend les réglages et le cache de `%APPDATA%/Spoti-View` (il faut seulement reconnecter le compte Spotify).

Le son du PC est analysé en direct et jamais enregistré ni envoyé. Les réglages, le cache et les jetons Spotify (chiffrés par Windows) restent dans `%APPDATA%/Sillon`.

## État du projet

**Bêta** (version 0.2). Bugs, idées, retours : écris-moi sur Discord, **`_vigorz_`**. Pour un bug, joins si possible le diagnostic (Paramètres → Diagnostic → « Copier le diagnostic ») : il ne contient ni mot de passe ni jeton.

Testée sur Windows 11 24H2 avec Electron 45 : accroche au fond d'écran (y compris avec Wallpaper Engine), deux écrans, capture du son, contrôles média, paroles, file d'attente, écran de veille et version empaquetée. Si l'accroche au fond d'écran ne marche pas sur ta version de Windows, le mode « Toujours au premier plan » ou « Fenêtre normale » reste utilisable.

## Licence

[GPL-3.0](LICENSE) : tu peux utiliser, étudier, modifier et redistribuer Sillon ; toute version modifiée que tu diffuses doit rester sous GPL-3.0, avec son code source.

Projet indépendant, sans lien avec Spotify, Deezer ou LRCLIB. Spotify est une marque de Spotify AB. Les pochettes et les paroles affichées appartiennent à leurs ayants droit.
