# Sillon

[![CI](https://github.com/vigoRz-c/sillon/actions/workflows/ci.yml/badge.svg)](https://github.com/vigoRz-c/sillon/actions/workflows/ci.yml) [![Dernière version](https://img.shields.io/github/v/release/vigoRz-c/sillon?label=version)](https://github.com/vigoRz-c/sillon/releases/latest) [![Licence GPL-3.0](https://img.shields.io/badge/licence-GPL--3.0-blue)](LICENSE)

Visualiseur musical qui vit **sur le fond d'écran Windows**, derrière toutes les fenêtres, et réagit à ce que tu écoutes sur Spotify.

> **Projet en bêta.** Sillon évolue encore : des bugs sont possibles. Si tu en trouves un, ou si tu as une idée pour l'améliorer, contacte-moi sur Discord : **`_vigorz_`**. Voir aussi [CONTRIBUTING.md](.github/CONTRIBUTING.md) et le [journal des versions](CHANGELOG.md).

- Scène sur tout le bureau : pochette en disque avec rayons en soleil et halo (intensité, position et taille réglables), paroles synchronisées en karaoké avec la ligne précédente en fantôme, panneau « en lecture » avec boutons (aléatoire, répéter, masquer…) et file d'attente « À suivre »
- Écran de veille (**Ctrl + Alt + L** ou après inactivité) qui verrouille la session en sortant
- Discret : s'arrête pendant un jeu ou une vidéo en plein écran, s'atténue en pause, se masque sans musique
- 5 visualiseurs pour le bandeau et le plein écran : Barres, Miroir, Anneau, Onde, Aurore
- Couleurs tirées automatiquement de la pochette du morceau (ou 5 thèmes fixes)
- Titre, artiste, pochette et progression du morceau en cours
- Mode plein écran (**Ctrl + Alt + F**) : pochette au centre, fond flouté qui dérive, ondes sur les basses
- Aucun compte : fonctionne avec Spotify **et** tout lecteur qui s'affiche dans les contrôles média de Windows (YouTube dans le navigateur, VLC…)

Windows 10 et 11.

## Lancer le projet

Il faut [Node.js](https://nodejs.org) 20 ou plus et [Rust](https://rustup.rs) (pour l'assistant natif, compilé automatiquement au lancement).

```bash
npm install
npm start
```

L'icône Sillon apparaît dans la zone de notification (en bas à droite). Tout se règle depuis son menu.

Créer l'installateur et la version portable (dans `dist/`) :

```bash
npm run dist
```

`Sillon-Setup-<version>.exe` installe l'app ; `Sillon-<version>-portable.exe` se lance sans installation. Ils ne sont pas signés : Windows SmartScreen peut demander « Informations complémentaires → Exécuter quand même ».

### Mises à jour automatiques

La version **installée** cherche les nouvelles versions sur les [Releases GitHub](https://github.com/vigoRz-c/sillon/releases) au démarrage puis toutes les 4 heures, les télécharge en arrière-plan et les installe à la fermeture (ou tout de suite via « Redémarrer pour installer » dans le menu de l'icône). Réglable dans Paramètres → Général. La version portable et `npm start` ne se mettent pas à jour.

Publier une nouvelle version (dépôt **public**, GitHub CLI connecté) :

```bash
npm run release
```

Le script vérifie que tout est commité et à jour, lance les tests, passe la version de 0.1.0 à 0.1.1 (`npm run release -- minor` pour 0.2.0), pousse le commit et son tag, puis construit et publie l'installateur sur GitHub. Les amis qui ont installé Sillon reçoivent la mise à jour tout seuls.

Tests automatiques (position de lecture, paroles, choix des pochettes, cache) :

```bash
npm test
```

Prévisualiser les visuels dans un navigateur, sans Windows et avec un son de synthèse : ouvre `demo/widget.html` ou `demo/fullscreen.html` (`?style=ring`, `?style=aurora`, etc.).

## Utilisation

Menu de l'icône dans la zone de notification :

| Entrée | Effet |
|---|---|
| Lecture / pause, Suivant, Précédent, Aléatoire, Répéter | Pilote Spotify (ou le lecteur actif) |
| Paroles de ce morceau | Décale les paroles (±0,25 s) quand LRCLIB a celles d'une autre version ; mémorisé par morceau |
| Réafficher Sillon | Après « masquer » depuis le panneau |
| Style | Choix du visualiseur |
| Couleurs | Pochette, Spotify, Néon, Coucher de soleil, Océan, Blanc |
| Position | Sur le fond d'écran · Toujours au premier plan · Fenêtre normale |
| Réglages | Morceau affiché ou non, sensibilité, opacité, images/s, lecteur suivi, lancement au démarrage |
| Déplacer / redimensionner… | Le widget passe devant : glisse-le, tire le coin, puis « Terminé » |
| Plein écran | Identique à Ctrl + Alt + F |
| Écran de veille | Identique à Ctrl + Alt + L |
| Paramètres… | Tous les réglages, dont le disque (intensité, taille, position), l'écran de la scène, le mode jeu, la veille et le compte Spotify |

En plein écran : **Espace** lecture/pause · **← →** morceau précédent/suivant · **V** visualiseur suivant · **C** couleurs suivantes · **[ ]** décaler les paroles · **Échap** quitter.

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
| Réagir au son | Capture « loopback » de la sortie audio du PC via Electron (`getDisplayMedia` + `audio: 'loopback'`). Jamais le micro. Le son n'est ni enregistré ni envoyé nulle part. |
| Être sur le fond d'écran | `src/main/windows/wallpaper.js` place la fenêtre dans le `WorkerW` d'Explorer (via `koffi` + `user32.dll`), avec une variante pour Windows 11 24H2. Ré-accroche automatique si Explorer redémarre. |
| Dessiner | Canvas 2D dans `src/renderer/shared/engine.js`, analyse FFT en bandes logarithmiques (35 Hz → 16 kHz). |

```
src/
  main/
    app/
      main.js            assemblage, réglages, IPC, démarrage
      state.js           état partagé entre modules
      settings.js        réglages sauvegardés (%APPDATA%/Sillon/settings.json)
      preload.js         pont sécurisé page ↔ process principal
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
    media/
      media.js           source « morceau en cours » + position de lecture
      now-playing.js     morceau en cours, pochette, paroles, décalage
      queue.js           file d'attente (API Spotify)
      cover-lookup.js    pochette officielle (Deezer)
      lyrics.js          paroles synchronisées (LRCLIB)
      spotify-api.js     connexion à l'API Spotify (PKCE)
      disk-cache.js      cache disque des pochettes et paroles
    audio/
      app-audio.js       son analysé : seulement le lecteur, ou tout le PC
      capture.js         son du système, couleurs du fond d'écran
      helper.js          lance l'assistant natif (sillon-helper.exe)
  renderer/
    pages/
      widget.*           la scène et le bandeau
      controls.*         boutons du panneau
      fullscreen.*       plein écran et écran de veille
      settings.*         fenêtre de paramètres
    shared/
      engine.js          audio, couleurs, visualiseurs (dont le disque)
      common.js          logique partagée widget / plein écran
      lyrics-view.js     paroles en karaoké
      scene-layout.js    disposition de la scène (modèles, placement)
      volume-control.js  barre de volume du lecteur
      pcm-worklet.js     lecture du son capturé pour l'analyse
    style.css            styles de toutes les pages
native/
  sillon-helper/       assistant natif en Rust : morceau en cours (SMTC),
                       volume du lecteur, capture du son du seul lecteur
test/                  tests (node --test)
demo/                  aperçu navigateur avec faux pont + son de synthèse
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

**Bêta** (version 0.1). Bugs, idées, retours : écris-moi sur Discord, **`_vigorz_`**. Pour un bug, joins si possible le diagnostic (Paramètres → Diagnostic → « Copier le diagnostic ») : il ne contient ni mot de passe ni jeton.

Testée sur Windows 11 24H2 avec Electron 45 : accroche au fond d'écran (y compris avec Wallpaper Engine), deux écrans, capture du son, contrôles média, paroles, file d'attente, écran de veille et version empaquetée. Si l'accroche au fond d'écran ne marche pas sur ta version de Windows, le mode « Toujours au premier plan » ou « Fenêtre normale » reste utilisable.

## Licence

[GPL-3.0](LICENSE) : tu peux utiliser, étudier, modifier et redistribuer Sillon ; toute version modifiée que tu diffuses doit rester sous GPL-3.0, avec son code source.

Projet indépendant, sans lien avec Spotify, Deezer ou LRCLIB. Spotify est une marque de Spotify AB. Les pochettes et les paroles affichées appartiennent à leurs ayants droit.
