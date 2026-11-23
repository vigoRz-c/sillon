# Audit complet de Sillon (v0.2.0), 23/11/2026

Cet audit a été réalisé avec le plugin ECC. Dix agents spécialisés ont tourné en parallèle et en lecture seule :

- security-reviewer
- typescript-reviewer
- rust-reviewer
- silent-failure-hunter
- performance-optimizer
- architect
- a11y-architect
- pr-test-analyzer
- refactor-cleaner
- doc-updater

J'ai ensuite lancé moi-même les outils et revérifié les constats majeurs.

**Légende :** ✅ vérifié dans le code ou sur le binaire · 🔶 plausible, à confirmer à l'exécution.

## Résultats des outils

| Contrôle | Résultat |
|---|---|
| `npm run check` (syntaxe, 42 fichiers) | ✅ OK |
| `eslint .` | ✅ 0 erreur, 0 avertissement |
| `prettier --check` | ✅ conforme |
| `npm test` | ✅ 18/18. Couverture : 80 % de lignes, chiffre gonflé par les fichiers de test eux-mêmes |
| `npm audit --omit=dev` | ✅ 0 vulnérabilité en production |
| `npm audit` (dev) | 6 « moderate » via `minimatch` dans `electron-builder` (outil de build, non embarqué) |
| `cargo check` / `cargo clippy -W pedantic` | ✅ compile. 55 avertissements pedantic seulement, aucun `unwrap` ni `panic` |
| Tests Rust | aucun `#[test]` |

**Verdict global :** la base est saine et bien tenue. Electron est sûr par défaut (isolation, sandbox, CSP stricte, bridge étroit), on ne trouve aucun cycle de `require`, le helper est isolé et la CI couvre aussi Rust. Il n'y a **aucune faille critique**.

Les vrais problèmes se trouvent ailleurs :

- quelques **bugs visibles** ;
- un **défaut de packaging** ;
- la **consommation au repos** d'une app qui tourne en permanence ;
- la **robustesse face aux pannes** (helper, réglages, réseau).

---

## P0 : bugs à corriger d'abord

1. ✅ **Le helper exige le redistribuable Visual C++.** `native/sillon-helper/.cargo/config.toml` (`+crt-static`) n'est jamais lu. Cargo cherche sa config depuis le répertoire courant, or `scripts/build-helper.js:25` et `ci.yml:44-45` lancent cargo depuis la racine. L'exe livré importe `VCRUNTIME140.dll` et `api-ms-win-crt-*.dll` (vérifié). Sur un PC sans le redistribuable, l'assistant ne démarre pas, et l'app perd la capture par application et les infos média.
   - Correction : déplacer le fichier dans `.cargo/config.toml` à la racine, ou passer `cwd: native/sillon-helper` à `spawnSync` et en CI.
   - Vérification : l'exe ne doit plus contenir `VCRUNTIME140`.
2. ✅ **Disque masqué : des barres s'affichent en plein écran.** `widget.js:188` met `style = 'none'`. Or `VISUALIZERS.none` n'existe pas, et `engine.js:797` retombe sur `bars`. Correction : `none() {}`, et ne rien dessiner dans ce cas.
3. ✅ **Les paroles du morceau précédent restent à l'écran** pendant la recherche LRCLIB, ou après l'arrêt du lecteur. `lyrics-view.js:67-71` : `set()` remet `fallbackKey` à `''` sans retirer `this.current`, donc `update()` ne voit aucun changement. Correction : `swap(null)` quand les données passent en `pending` ou que `media.active` est faux.
4. ✅ **Une coupure réseau empoisonne le cache des pochettes pendant 7 jours.** `cover-lookup.js:92` : `getAlbum(id).catch(() => null)`. Si tous les appels échouent (réseau, 429 Deezer), `null` est écrit sur disque comme « rien trouvé ». Correction : relancer l'erreur quand aucun appel album n'a réussi.
5. ✅ **Le helper média crashe le processus principal.** `media.js:104` écrit sur `stdin` sans écouteur `'error'`. Un clic entre la mort du helper et l'événement `exit` produit un EPIPE, donc une exception non gérée.
   - Défauts au même endroit : `restarts` est remis à 0 dès `ready` (aucun vrai backoff si le helper plante juste après), les erreurs de `spawn` ne déclenchent pas de relance, et l'UI garde l'état « en lecture » d'un helper mort.
6. ✅ **Raccourcis V et C du plein écran : le toast affiche « undefined ».** `fullscreen.js:12-13` ne connaît ni `blocks`, ni `halo`, ni `violet`. Le menu de l'icône (`tray.js:7-22`) ne les a pas non plus. Correction : une seule table des styles et thèmes, partagée.
7. ✅ **Le helper de capture est relancé toutes les 3 s quand Spotify est fermé.** C'est le réglage par défaut (`preferApp: 'spotify'`). Voir `app-audio.js:95` et `:111`. Cela fait environ 29 000 créations de processus par jour, chacune analysée par l'antivirus. Correction : backoff exponentiel, ou ne rien relancer tant que SMTC n'annonce pas l'application.
8. 🔶 **Rafraîchissement du jeton Spotify en double.** `queue.js:99-101` lance `refreshPlayer()` et `spotify.queue()` en même temps. Les deux appellent `accessToken()` (`spotify-api.js:236`) et rafraîchissent chacun le jeton. Si Spotify fait tourner le refresh token, l'un reçoit `invalid_grant`, et `logout()` déconnecte l'utilisateur. Correction : mémoriser la promesse de rafraîchissement en cours.
9. 🔶 **La version portable pourrait se mettre à jour via l'installateur.** `updater.js:32` ne teste que `app.isPackaged`, sans regarder `PORTABLE_EXECUTABLE_DIR`, alors que le commentaire de la ligne 6 dit le contraire.
10. 🔶 **Instance unique.** `main.js:40` fait `app.quit()` sans `return`. La suite du démarrage (IPC, `whenReady`) peut encore s'exécuter dans la 2e instance.

## P1 : robustesse (échecs silencieux)

- **Capture Rust muette après un changement de périphérique audio.** `capture.rs:151` : `GetNextPacketSize().unwrap_or(0)` masque `AUDCLNT_E_DEVICE_INVALIDATED`. Le helper reste vivant sans données, et le repli sur « tout le son du PC » ne se déclenche jamais. Correction : `fail(2, …)` sur ces erreurs.
- **Appels WinRT sans délai.** `media.rs:73,80,164,201` : `.join()` bloquant. Un lecteur qui ne répond pas gèle toute la boucle du helper.
- **Réglages perdus.**
  - `settings.js` écrit avec `writeFileSync`, sans écriture atomique.
  - Un JSON corrompu est remplacé en silence par les valeurs par défaut, puis écrasé.
  - `settings:set` accepte n'importe quel patch, et un patch `null` lève une exception.
  - Le fichier est écrit et le menu reconstruit à chaque cran de curseur.
  - Correction : fichier temporaire puis `rename`, copie `.bak`, liste blanche basée sur `DEFAULTS`, debounce.
- **Jetons Spotify.**
  - Fichier illisible = déconnexion sans message (`spotify-api.js:61`).
  - Le jeton est stocké en clair si `safeStorage` est indisponible.
  - `save` échoue après la mise à jour en mémoire, donc la déconnexion n'apparaît qu'au redémarrage.
- **Pas de reprise après un crash du rendu de la scène.** `widget-window.js` n'écoute pas `render-process-gone`, contrairement à `controls-window.js`.
- **Fuite d'`AudioContext`.** `engine.js:21-80` : deux démarrages rapprochés écrasent `ctx` et `stream` sans les fermer, et `ctx` n'est pas fermé en cas d'erreur de `addModule`.
- **Paroles :** une erreur réseau ne se distingue pas de « pas de paroles », et elle n'apparaît pas dans le diagnostic.
- **`volume.rs:74-76`** : `any = true` même si `SetMasterVolume` échoue. L'UI affiche un volume qui n'a pas été appliqué.
- 🔶 **PCM de longueur impaire** : `engine.js:63` jette l'octet restant, ce qui désaligne tout le flux suivant. Il faut garder l'octet pour le morceau suivant.

## Sécurité (aucun constat critique ni élevé)

| Sév. | Constat | Correction |
|---|---|---|
| Moyenne | Mise à jour auto silencieuse sans signature de code : un compte GitHub compromis suffit à exécuter du code chez tous les utilisateurs | Signature (Azure Trusted Signing, SignPath), 2FA matérielle, publication depuis la CI |
| Moyenne | Jetons Spotify en clair si DPAPI est indisponible | Ne pas persister, ou prévenir l'utilisateur |
| Basse | IPC : `media:command` écrit une chaîne libre sur le stdin du helper (injection par `\n`, limitée aux commandes du helper). `settings:set` n'est pas validé | Liste blanche des commandes et des clés |
| Basse | Ni `setWindowOpenHandler` ni `will-navigate`, fuses Electron non configurés | `deny` + `preventDefault`, `@electron/fuses` |
| Basse | Callback OAuth : un `state` invalide ferme le serveur (n'importe quelle page peut annuler la connexion). `e.message` n'est pas échappé | Répondre 400 sans fermer, échapper le HTML |
| Basse | Images Deezer et Spotify récupérées sans liste blanche d'hôtes, sans contrôle du type ni plafond de taille | Hôtes autorisés, `image/*`, environ 2 Mo |
| Basse | Actions CI non épinglées par SHA, pas de `npm audit` ni de `cargo audit` en CI | Épingler, ajouter les audits |

Points vérifiés sains : pas d'`innerHTML` sur des données externes, `spawn` sans shell, liste blanche des noms d'exe côté Rust, cache disque nommé par sha1 (pas de traversée de chemin), aucun secret commité, PKCE et `state` corrects.

## Performance (app qui tourne en permanence)

1. **Toute la chaîne audio tourne même quand la scène dort, est masquée ou qu'un jeu est en plein écran.** Cela comprend le helper, environ 100 messages IPC par seconde, le worklet et un `AudioContext` relié à la sortie. Avec `sceneHidden`, la page continue même à dessiner (`backgroundThrottling: false`). C'est le plus gros gain possible : arrêter le helper, faire `ctx.suspend()` et mettre le rendu en pause dans tous ces cas.
2. **La boucle `requestAnimationFrame` se réarme même en pause** (`engine.js:787`) : 60 à 144 réveils par seconde pour rien.
3. **Canvas de la scène** : il couvre tout l'écran au `devicePixelRatio` (environ 8 Mpx en 4K), avec environ 12 `shadowBlur` par image et une pochette de 500 px redessinée en rotation. Plafonner le dpr à 1 et pré-rendre la pochette.
4. **La pochette (data URL de 100 à 250 Ko) est renvoyée dans chaque message `media`**, y compris à la fenêtre des boutons, qui ne s'en sert pas. Le menu de l'icône est aussi reconstruit à chaque fois.
5. **Cache disque** : `prune` ne s'exécute qu'au démarrage, les fichiers sont en base64 dans du JSON et lus en synchrone, et ce sont les pochettes les plus écoutées qui sont évincées en premier.
6. **Autres travaux de fond** :
   - échantillonnage du fond d'écran toutes les 60 s, même hors du thème « fond d'écran » ;
   - sondage SMTC à 2,5 Hz au lieu d'écouter ses événements ;
   - `refreshPlayer` ne respecte pas le 429 de Spotify.

## Accessibilité (WCAG 2.2)

- **Critique : aucun `prefers-reduced-motion`**, et aucun réglage pour réduire l'animation. Les lueurs et le bord d'écran pulsent avec les basses, ce qui présente un risque photosensible (critère 2.3.1). Il faut plafonner la fréquence des impulsions et ajouter un réglage « Réduire les animations ».
- **Boutons icônes nommés seulement par `title`** (controls, plein écran, volume). Il manque `aria-pressed` sur aléatoire et répétition, et l'état lecture/pause n'est pas exposé.
- **Focus visible absent presque partout.** `.vol-range` a `outline: none`, et les contrôles en `opacity: 0` restent focalisables.
- **Raccourcis à une touche** (V, C, [, ]) toujours actifs, et Espace capturé même quand un bouton a le focus.
- **Contraste non garanti** du texte blanc à 35-75 % d'opacité posé sur le fond d'écran ou la pochette.
- **Éditeur de scène** : les éléments ne sont pas focalisables au clavier, et la poignée fait 14 px.

## Tests

- 4 fichiers de test (264 lignes) pour environ 4 500 lignes de JS. Ils sont solides (aucun réseau ni horloge réelle) mais ne couvrent que la logique pure.
- Modules à 0 % : `settings`, `spotify-api`, `queue`, `app-audio`, `now-playing`, `engine`, et le protocole du helper (`media.js` : 12,5 % des fonctions).
- **Tests à ajouter en priorité :**
  1. `findLyrics` : repli sur `/search`, tolérance de durée, bon artiste.
  2. `lookupLyrics` et `lookupCover` : une erreur réseau n'est pas mise en cache (couvre le P0-4).
  3. `cleanTitle`, `firstArtist` et `norm`. Ces fonctions sont dupliquées entre `lyrics.js` et `cover-lookup.js`, à mettre en commun.
  4. `SpotifyApi.get` : 401 avec un seul nouvel essai, 429 `retryAfter`, 204, 403.
  5. Migration et validation de `settings` (avec Electron simulé, ou en extrayant `DEFAULTS`).
  6. `disk-cache` : TTL des entrées « rien trouvé », `prune` à 600 fichiers.
  7. Protocole du helper (`WindowsMediaSource` avec un faux processus).
  8. Tests Rust : analyse des commandes, `secs`, cycle de répétition, plus `cargo test --locked` en CI.

## Architecture, documentation, CI

- ✅ **`demo/` est cassée** sur ses 3 pages : il manque `lyrics-view.js` et `volume-control.js`, et `fake-bridge.js` n'a que 13 méthodes sur 36. Deux options : charger les vraies pages, ou supprimer le dossier.
- **Contrat IPC non documenté.**
  - Canal caché : `executeJavaScript('window.sillon.startAppAudio()')` dans `app-audio.js:134`.
  - Le rejeu de l'état est recopié dans 4 fichiers.
  - Un test `ipc-contract.test.js` qui lit les fichiers comme du texte suffirait à garder preload, renderer et démo alignés.
- **Le protocole du helper n'a pas de version.** Les commandes inconnues sont ignorées en silence.
- ✅ **`ci.yml` est encodé deux fois** (« VÃ©rifications »).
  - Le packaging (`electron-builder`) n'est jamais testé en CI.
  - Pas de cache Cargo, pas de `--locked`, pas de toolchain épinglée.
- **`release.js` pousse le tag avant la construction.** Si le build échoue, le tag est publié sans Release.
- **README faux** : il annonce « 5 visualiseurs » (il y en a 7) et « 5 thèmes » (il y en a 6, Violet manque), la « version 0.1 », et décrit la capture par loopback alors que c'est le repli. Les prérequis MSVC et la vérification Rust en local manquent aussi.
- **Code mort minime** :
  - exports `REDIRECT_URI`, `BUILTIN_CLIENT_ID`, `DEFAULTS` et `withAlpha` non utilisés ;
  - 5 anciens réglages (`showPanel`, `discX`, `discY`, `discSize`, `showClock`) lus seulement par la migration ;
  - aucun canal IPC orphelin, aucune dépendance inutile.
- **Gros fichiers** : `engine.js` (835 lignes) et `widget.js` (689). À découper seulement quand ces zones changeront.

---

## Plan d'action proposé

| Lot | Contenu | Effort estimé |
|---|---|---|
| 1. Bugs visibles | P0-1 à P0-7 (CRT, style `none`, paroles figées, cache des pochettes, EPIPE et backoff, libellés, relance toutes les 3 s), chacun avec son test de régression | ½ à 1 j |
| 2. Robustesse | Jeton Spotify (promesse unique), réglages atomiques et validés, erreurs WASAPI, reprise après crash du rendu, fuite d'`AudioContext` | 1 j |
| 3. Repos | Couper la chaîne audio et le rendu à l'arrêt, rAF en pause, dpr 1, pochette hors des messages `media` | 1 j |
| 4. Accessibilité | `prefers-reduced-motion` et réglage, `aria-label`, `:focus-visible`, raccourcis | ½ j |
| 5. Outillage | `ci.yml` en UTF-8, actions épinglées, `npm audit` et `cargo audit`, ordre de `release.js`, README, démo, test du contrat IPC | ½ j |
| 6. Long terme | Signature de code et publication depuis la CI | à planifier |
