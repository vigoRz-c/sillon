# Spoti-View

Visualiseur musical qui vit **sur le fond d'écran Windows**, derrière toutes les fenêtres, et réagit à ce que tu écoutes sur Spotify.

- 5 visualiseurs : Barres, Miroir, Anneau, Onde, Aurore
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

Créer un installateur `.exe` (dans `dist/`) :

```bash
npm run dist
```

Prévisualiser les visuels dans un navigateur, sans Windows et avec un son de synthèse : ouvre `demo/widget.html` ou `demo/fullscreen.html` (`?style=ring`, `?style=aurora`, etc.).

## Utilisation

Menu de l'icône dans la zone de notification :

| Entrée | Effet |
|---|---|
| Lecture / pause, Suivant, Précédent | Pilote Spotify (ou le lecteur actif) |
| Style | Choix du visualiseur |
| Couleurs | Pochette, Spotify, Néon, Coucher de soleil, Océan, Blanc |
| Position | Sur le fond d'écran · Toujours au premier plan · Fenêtre normale |
| Réglages | Morceau affiché ou non, sensibilité, opacité, images/s, lecteur suivi, lancement au démarrage |
| Déplacer / redimensionner… | Le widget passe devant : glisse-le, tire le coin, puis « Terminé » |
| Plein écran | Identique à Ctrl + Alt + F |

En plein écran : **Espace** lecture/pause · **← →** morceau précédent/suivant · **V** visualiseur suivant · **C** couleurs suivantes · **Échap** quitter.

## Comment ça marche

| Besoin | Solution |
|---|---|
| Savoir ce qui joue | Les contrôles média de Windows (SMTC), lus par `src/main/media-helper.ps1`. C'est la même source que le panneau média du volume Windows : pas de connexion à Spotify. |
| Afficher la bonne pochette | Spotify transmet parfois à Windows une image du clip au lieu de la pochette. `src/main/cover-lookup.js` cherche sur la recherche publique de Deezer (sans compte) la pochette de l'album studio où figure le morceau, à défaut celle de l'EP ou du single : seuls l'artiste, l'album et le titre sont envoyés. Rien de fiable trouvé : on garde l'image de Windows. |
| Réagir au son | Capture « loopback » de la sortie audio du PC via Electron (`getDisplayMedia` + `audio: 'loopback'`). Jamais le micro. Le son n'est ni enregistré ni envoyé nulle part. |
| Être sur le fond d'écran | `src/main/wallpaper.js` place la fenêtre dans le `WorkerW` d'Explorer (via `koffi` + `user32.dll`), avec une variante pour Windows 11 24H2. Ré-accroche automatique si Explorer redémarre. |
| Dessiner | Canvas 2D dans `src/renderer/engine.js`, analyse FFT en bandes logarithmiques (35 Hz → 16 kHz). |

```
src/
  main/
    main.js            fenêtres, menu, raccourci, réglages
    wallpaper.js       accroche au fond d'écran (Win32)
    media.js           source "morceau en cours" (interface commune)
    media-helper.ps1   lecture des contrôles média Windows
    settings.js        réglages sauvegardés (%APPDATA%/Spoti-View/settings.json)
    preload.js         pont sécurisé page ↔ process principal
  renderer/
    engine.js          audio, couleurs, visualiseurs
    common.js          logique partagée widget / plein écran
    widget.*           le widget du bureau
    fullscreen.*       le mode plein écran
demo/                  aperçu navigateur avec faux pont + son de synthèse
```

## Brancher l'API Spotify plus tard

Tout ce qui concerne le morceau en cours passe par une seule interface dans `src/main/media.js` (`start`, `stop`, `command`, événement `media`). Pour l'API Spotify :

1. Créer une app sur le [tableau de bord développeurs Spotify](https://developer.spotify.com/dashboard) (gratuit) et récupérer le *Client ID*.
2. Ajouter une `SpotifyApiSource` dans `media.js` : connexion OAuth **PKCE** (pas de secret dans l'app), puis `GET /v1/me/player/currently-playing`.
3. Elle peut compléter la source Windows plutôt que la remplacer : la source Windows reste la plus réactive pour le titre et les commandes, l'API ajoute le reste (like, ajout à une playlist, stats d'écoute).

## État du projet

Version 0.1. Les visuels, le plein écran et le démarrage de l'app ont été testés hors Windows. L'accroche au fond d'écran, la capture audio et la lecture des contrôles média reposent sur des API Windows : ce sont les points à vérifier en premier sur une vraie machine. Si l'accroche au fond d'écran ne marche pas sur ta version de Windows, le mode « Toujours au premier plan » ou « Fenêtre normale » reste utilisable.
