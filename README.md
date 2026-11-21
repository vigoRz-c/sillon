# Spoti-View

Visualiseur musical qui vit **sur le fond d'écran Windows**, derrière toutes les fenêtres, et réagit à ce que tu écoutes sur Spotify.

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

Il faut [Node.js](https://nodejs.org) 20 ou plus.

```bash
npm install
npm start
```

L'icône Spoti-View apparaît dans la zone de notification (en bas à droite). Tout se règle depuis son menu.

Créer l'installateur et la version portable (dans `dist/`) :

```bash
npm run dist
```

`Spoti-View Setup 0.1.0.exe` installe l'app ; `Spoti-View 0.1.0.exe` se lance sans installation. Ils ne sont pas signés : Windows SmartScreen peut demander « Exécuter quand même ».

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
| Réafficher Spoti-View | Après « masquer » depuis le panneau |
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
| Savoir ce qui joue | Les contrôles média de Windows (SMTC), lus par `src/main/media-helper.ps1`. C'est la même source que le panneau média du volume Windows : pas de connexion à Spotify. |
| Afficher la bonne pochette | Spotify transmet parfois à Windows une image du clip au lieu de la pochette. `src/main/cover-lookup.js` cherche sur la recherche publique de Deezer (sans compte) la pochette de l'album studio où figure le morceau, à défaut celle de l'EP ou du single : seuls l'artiste, l'album et le titre sont envoyés. Rien de fiable trouvé : on garde l'image de Windows. |
| Paroles synchronisées | `src/main/lyrics.js` les demande à [LRCLIB](https://lrclib.net) (gratuit, sans compte), mot par mot quand c'est disponible : seuls l'artiste, le titre, l'album et la durée sont envoyés. Pas de paroles synchronisées : le titre s'affiche à la place. |
| File d'attente | `src/main/spotify-api.js` : API Web Spotify (facultative), connexion PKCE sans secret, jetons chiffrés par Windows. Le propriétaire de l'app développeur Spotify doit être Premium (règle de Spotify depuis février 2026). |
| Hors ligne | `src/main/disk-cache.js` garde pochettes et paroles déjà trouvées dans `%APPDATA%/Spoti-View/cache`. |
| Mode jeu | `SHQueryUserNotificationState` (plein écran signalé par Windows) + la fenêtre au premier plan couvre l'écran de la scène. |
| Boutons de la scène | La scène est sous les icônes du bureau et ne reçoit pas les clics : les boutons du panneau sont une petite fenêtre à part (`controls.html`), gardée tout en bas de la pile des fenêtres. |
| Réagir au son | Capture « loopback » de la sortie audio du PC via Electron (`getDisplayMedia` + `audio: 'loopback'`). Jamais le micro. Le son n'est ni enregistré ni envoyé nulle part. |
| Être sur le fond d'écran | `src/main/wallpaper.js` place la fenêtre dans le `WorkerW` d'Explorer (via `koffi` + `user32.dll`), avec une variante pour Windows 11 24H2. Ré-accroche automatique si Explorer redémarre. |
| Dessiner | Canvas 2D dans `src/renderer/engine.js`, analyse FFT en bandes logarithmiques (35 Hz → 16 kHz). |

```
src/
  main/
    main.js            assemblage, réglages, IPC, démarrage
    state.js           état partagé entre modules
    widget-window.js   scène / bandeau sur le fond d'écran
    controls-window.js boutons du panneau de la scène
    windows.js         plein écran et paramètres
    veille.js          écran de veille
    now-playing.js     morceau en cours, pochette, paroles, décalage
    queue.js           file d'attente (API Spotify)
    capture.js         son du système, couleurs du fond d'écran
    tray.js            menu de l'icône
    wallpaper.js       accroche au fond d'écran et appels Win32
    media.js           source "morceau en cours" + position de lecture
    media-helper.ps1   lecture des contrôles média Windows
    cover-lookup.js    pochette officielle (Deezer)
    lyrics.js          paroles synchronisées (LRCLIB)
    spotify-api.js     connexion à l'API Spotify (PKCE)
    disk-cache.js      cache disque des pochettes et paroles
    settings.js        réglages sauvegardés (%APPDATA%/Spoti-View/settings.json)
    preload.js         pont sécurisé page ↔ process principal
  renderer/
    engine.js          audio, couleurs, visualiseurs (dont le disque)
    common.js          logique partagée widget / plein écran
    lyrics-view.js     paroles en karaoké
    widget.*           la scène et le bandeau
    controls.*         boutons du panneau
    fullscreen.*       plein écran et écran de veille
    settings.*         fenêtre de paramètres
test/                  tests (node --test)
demo/                  aperçu navigateur avec faux pont + son de synthèse
```

## Connecter Spotify (file d'attente, facultatif)

1. Paramètres → **Compte Spotify** → lien vers le [tableau de bord développeurs](https://developer.spotify.com/dashboard). Il faut un compte **Premium**.
2. **Create app** : coche **Web API**, ajoute la Redirect URI `http://127.0.0.1:43821/callback`.
3. Colle le **Client ID** dans Spoti-View, puis **Se connecter à Spotify**.

La même connexion pourrait servir plus tard au like ou à l'ajout à une playlist.

## État du projet

Version 0.1, testée sur Windows 11 24H2 avec Electron 45 : accroche au fond d'écran (y compris avec Wallpaper Engine), deux écrans, capture du son, contrôles média, paroles, file d'attente, écran de veille et version empaquetée. Si l'accroche au fond d'écran ne marche pas sur ta version de Windows, le mode « Toujours au premier plan » ou « Fenêtre normale » reste utilisable.
