# Journal des versions

Toutes les évolutions notables de Sillon. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), numéros de version [SemVer](https://semver.org/lang/fr/).

## [Non publié]

## [0.4.2] - 2026-11-24

Quatre nouvelles formes pour l'anneau du disque de la scène et de la veille.

### Ajouté
- Quatre nouvelles formes pour l'anneau du disque (scène et veille), en plus des rayons fins et épais : Onde, Points, Arcs et Ondes concentriques. Au choix dans les paramètres (onglet Scène, « Anneau du disque ») et dans l'éditeur de scène.

## [0.4.1] - 2026-11-24

Correctifs de la 0.4.0 : placement du bandeau de nouveau utilisable, aide des raccourcis du plein écran affichée seulement à la demande.

### Corrigé
- « Déplacer / redimensionner le bandeau » : avec le bandeau sur le fond d'écran sous Windows 11, ni « Terminé » ni la poignée ne répondaient (toute la fenêtre servait à la déplacer), il fallait quitter Sillon. Le placement se fait aussi dans une fenêtre à part, comme l'éditeur de la scène, sans décrocher le bandeau du fond d'écran ; Échap ou Entrée terminent aussi.

### Modifié
- Plein écran : l'aide des raccourcis ne s'affiche plus à chaque mouvement de la souris ; touche **?** (ou **H**) pour l'afficher ou la masquer. Elle reste lue par les lecteurs d'écran.

## [0.4.0] - 2026-11-24

Personnalisation (roue des couleurs, quatre nouveaux visualiseurs) et seconde passe de l'audit de la version 0.3.0 : chaque page limitée à ses propres messages, cache disque sans blocage, vérification des types.

### Ajouté
- Roue des couleurs dans les paramètres (onglet Couleurs) : teinte et saturation sur la roue, luminosité au curseur, ou code hexadécimal. La couleur choisie devient le jeu « Couleur personnalisée » du bandeau, du plein écran et de la veille, et peut aussi colorer le disque de la scène (pastille « Personnalisée », ou dans l'éditeur de scène). Utilisable au clavier.
- Quatre nouveaux visualiseurs : Spectre (courbe lisse remplie), Points (matrice lumineuse), Étincelles (particules qui montent avec le son) et Rosace (pétales de spectre qui tournent). Au choix dans les paramètres, le menu de l'icône et le plein écran (touche V) ; les trois premiers aussi pour l'élément « Barres » de l'éditeur de scène.

### Sécurité
- Chaque page ne peut plus demander que ce dont elle a besoin : la fenêtre des boutons ne peut pas déconnecter Spotify, l'écran noir de la veille ne peut que la quitter. Une demande refusée est notée au diagnostic.
- Les écrans noirs de la veille (écrans secondaires) sont une page de l'app au lieu d'une page `data:`, avec les mêmes règles de sécurité que les autres.
- L'assistant natif refuse une commande trop longue au lieu de l'exécuter tronquée.

### Performance
- La pochette n'est plus renvoyée aux pages à chaque changement de volume ou de lecture : elle part une fois, puis seulement quand elle change.
- Le cache des pochettes et des paroles lit et écrit le disque sans bloquer le processus principal ; une entrée abîmée est supprimée.

### Interne
- Commandes et codes de sortie de l'assistant natif réunis dans un seul module (`helper-protocol.js`).
- Vérification des types (JSDoc, `npm run typecheck`) sur les modules principaux, aussi en CI.
- Hook avant commit : ESLint et formatage des fichiers modifiés.
- Nouveaux tests : contrôle des pages qui envoient des messages, connexion Spotify (réussite, code absent, refus), erreurs de mise à jour, envoi de la pochette ; plus d'attentes en temps réel dans les tests.
- Dépendance des outils de construction (`minimatch`) mise à jour : `npm audit` ne signale plus rien.

## [0.3.1] - 2026-11-24

Correctifs rapides issus de l'audit de la version 0.3.0 : autorisations limitées aux pages de Sillon, démarrage raté signalé, moins de travail quand la scène est cachée.

### Sécurité
- Seules les pages de Sillon reçoivent des autorisations (capture du son, presse-papiers) ; toute autre demande est refusée et notée au diagnostic.
- Préférences de sécurité des fenêtres écrites explicitement (isolation, bac à sable, pas de Node), et règles de sécurité des pages (CSP) complétées (`object-src`, `base-uri`, `form-action`).
- Connexion Spotify : un retour sans code est refusé proprement, et la page de retour n'est plus mise en cache ni ne transmet de référent.

### Corrigé
- Un démarrage raté ne laisse plus Sillon tourner sans icône : un message s'affiche et l'app se ferme. Les erreurs imprévues sont notées au diagnostic.
- Un raccourci clavier déjà pris par une autre application (Ctrl+Alt+F comme Ctrl+Alt+L) est signalé au diagnostic.
- Durée du morceau : plus de valeur absurde si un lecteur annonce une fin avant le début.

### Performance
- La file d'attente Spotify n'est plus lue quand la scène est masquée, endormie ou cachée par un jeu ; elle est relue au réveil.
- Le fond d'écran n'est plus renvoyé aux pages quand il n'a pas changé.
- Cache mémoire des pochettes limité à 30 images (au lieu de 200).

## [0.3.0] - 2026-11-23

Nouveaux jeux de couleurs, fenêtre des paramètres refaite, audit complet de la version 0.2.0 et une trentaine de bugs corrigés.

### Ajouté
- 14 nouveaux jeux de couleurs pour le visualiseur et le disque : Cyberpunk, Synthwave, Acide, Pastel, Lavande, Pêche, Menthe, Forêt, Braise, Glace, Désert, Or et noir, Rouge sang, Minuit. Toutes les listes (paramètres, éditeur de la scène, menu de l'icône, raccourci C du plein écran) viennent du même catalogue.

### Modifié
- La scène ne se masque plus d'elle-même sans musique par défaut (« Masquer la scène sans musique après » : Jamais). Avant, elle s'endormait au bout de 5 minutes, même quand un jeu ou un programme sans contrôles média faisait du son. Les installations existantes gardent leur réglage.
- Nouvelle fenêtre des paramètres : plus large, avec un menu à gauche (Disposition, Scène, Visualiseur, Couleurs, Son, Comportement, Spotify, Avancé), un aperçu animé du visualiseur avec le style et les couleurs choisis, et une recherche dans tous les réglages (accents et majuscules ignorés, Ctrl+F). Les couleurs se choisissent sur des pastilles rangées par famille (Image, Classiques, Vifs, Doux, Naturels, Sombres), utilisables au clavier.

### Corrigé
- Écran de veille : il ne se lance plus pendant une vidéo ou un jeu en plein écran (il verrouillait ensuite le PC).
- Lecture / pause : Sillon envoie « lecture » ou « pause » selon l'état connu au lieu d'une bascule, avec repli sur l'API Spotify si Spotify ignore la commande. Une commande envoyée pendant le redémarrage de l'assistant est rejouée.
- Lecteur suivi en priorité : il ne masque plus un autre lecteur qui joue pendant qu'il est en pause. Les événements média suivent la bonne session après un redémarrage de Spotify.
- Son du lecteur : un échec passager ne bascule plus pour toujours sur tout le son du PC ; un lecteur introuvable n'est plus relancé toutes les 3 secondes ; l'assistant de capture s'arrête avec Sillon.
- Réglages : un fichier momentanément illisible (antivirus, synchronisation) n'est plus écrasé par les valeurs par défaut.
- Paroles : recherche relancée quand la durée du morceau arrive en retard, nouvel essai après une coupure réseau, mots remis à zéro après un retour en arrière, plus de ligne en double après un décalage, plus de paroles figées quand le lecteur ne donne pas la durée.
- Spotify : un jeton qui ne se renouvelle pas n'est plus masqué par une file d'attente vide.
- Plein écran : les raccourcis (V, C, flèches, [ ]) marchent encore après un clic sur un bouton.
- Rendu : une erreur dans un visualiseur ne fige plus l'animation ; l'Anneau ne plante plus dans une très petite fenêtre.
- Éditeur de la scène : Échap et Ctrl+Z marchent après avoir réglé un curseur ; un simple clic n'encombre plus l'historique d'annulation ; la liste « Style » des barres montre le bon choix.
- Bandeau : changer de disposition pendant son placement ne lui donne plus la taille de l'écran entier.
- Divers : couleurs de la pochette remises à zéro si l'image est illisible, curseur de volume qui ne reste plus bloqué, mise à jour qui ne reste plus bloquée en « téléchargement », mode jeu correct sur deux écrans d'échelles différentes.
- Assistant natif : cargo est lancé depuis le dossier du helper, si bien que `.cargo/config.toml` (liaison statique du runtime C) est enfin appliqué. Sur un PC sans le redistribuable Visual C++, l'assistant démarre et la capture par application et les infos média fonctionnent.
- Disque masqué : des barres ne s'affichent plus en plein écran.
- Paroles : celles du morceau précédent ne restent plus à l'écran pendant une recherche ni après l'arrêt du lecteur.
- Pochettes : une coupure réseau ou un refus de l'API ne met plus « aucune pochette » en cache pendant 7 jours.
- Assistant média : une écriture vers un assistant arrêté ne fait plus planter le processus principal, et les relances sont espacées.
- Assistant : les commandes inconnues reçoivent une réponse au lieu d'être ignorées en silence. Une panique écrit « ERR 5 … » sur la sortie d'erreur avant l'arrêt ; nouveau code de sortie 6 pour une erreur de lecture de l'entrée standard.
- Plein écran : les raccourcis V et C n'affichent plus « undefined » pour les styles et couleurs récents (Blocs, Halo, Violet). Le menu de l'icône et le plein écran utilisent la même liste.
- Lecture du son : l'assistant n'est plus relancé toutes les 3 secondes quand Spotify est fermé.

### Sécurité
- Fenêtres : aucune nouvelle fenêtre et aucune navigation hors de la page chargée (`secure.js`).
- Processus Electron : fusibles `runAsNode`, `NODE_OPTIONS` et arguments `--inspect` désactivés, chargement uniquement depuis `app.asar`.
- Messages IPC : contrôle de l'expéditeur (seules les pages de Sillon) et réglages validés par liste blanche.
- Actions GitHub épinglées par SHA de commit.
- Signature de code : la construction signe seulement si un certificat est fourni par variables d'environnement (documenté dans `SECURITY.md`). Sans certificat, les installateurs restent non signés.

### Performance
- Repos : la scène dort quand la musique ne joue plus depuis un moment, et la capture du son s'arrête avec elle, au lieu de tourner en permanence.
- Le sondage des contrôles média est remplacé par leurs événements système.
- La boucle d'animation ne se réarme plus en pause.

### Accessibilité
- Nouveau réglage « Réduire les animations et les lueurs » : il arrête les pulsations de la lumière de bord et des lueurs au rythme des basses.

### Outillage
- CI : fichier réencodé en UTF-8 ; actions épinglées par SHA ; `persist-credentials: false` ; cache Cargo ; `cargo fmt`, `clippy -D warnings`, `cargo test --locked` et `cargo build --locked` depuis le dossier du helper ; `npm audit --omit=dev` et `cargo audit` ; tests JavaScript sous Node 20 et 22 ; job d'empaquetage sans publication ; vérification que `sillon-helper.exe` n'embarque pas `VCRUNTIME140` ; `windows-2025`.
- `npm run verify:rust` (formatage, clippy, tests Rust) ; `npm run verify` l'inclut quand cargo est installé.
- `npm run lint` échoue sur tout avertissement (`--max-warnings 0`).
- `npm run release` : refuse de publier sans section `## [x.y.z]` dans ce journal ; construit avant de pousser le commit et le tag ; annule le commit et le tag locaux si la construction ou le push échoue ; utilise la section comme notes de la Release ; publie `SHA256SUMS.txt`.
- Démo : charge les vraies pages (`src/renderer/pages`) avec un faux pont qui expose toutes les méthodes du preload ; les copies HTML périmées sont supprimées.
- Tests : contrat IPC vérifié à chaque exécution (canaux du preload, canaux émis par le processus principal, `bridge.X` des pages, démo) ; tests de la publication. L'assistant compte 28 tests Rust.
- Dependabot : suit les actions GitHub (regroupées) et le crate Rust ; `windows-core` et `windows-future` restent mis à jour à la main avec `windows`.
- README, CONTRIBUTING et modèle de pull request mis à jour (prérequis Rust et MSVC, `npm run verify`).

## [0.2.0] - 2026-11-23

### Modifié
- Mémoire : environ 700 Mo → 430 Mo. Les deux scripts PowerShell (morceau en cours, volume, son du lecteur) sont remplacés par un petit assistant natif écrit en Rust (environ 8 Mo au lieu de 155 Mo, démarrage immédiat), et le cache graphique de Chromium est plafonné (environ 120 Mo de moins, sans différence à l'écran).
- Développement : Rust est nécessaire pour compiler l'assistant (`native/sillon-helper`), compilé automatiquement par `npm start`.

## [0.1.9] - 2026-11-22

### Ajouté
- Barre de volume du lecteur dans les boutons de la scène et en plein écran : règle le son de Spotify (ou du lecteur suivi) dans le mélangeur de Windows, sans toucher au volume général ni aux autres applications. Clic sur le haut-parleur pour couper le son, molette pour régler.

## [0.1.8] - 2026-11-22

### Ajouté
- Réglage « Son analysé » : par défaut, Sillon n'écoute plus que le lecteur suivi (Spotify, navigateur…). Le chat vocal (Discord, TeamSpeak), les notifications et les jeux ne font plus bouger le visualiseur. Repli sur tout le son du PC si Windows ne le permet pas.

### Modifié
- Dépendances : koffi 3, ESLint 10.

## [0.1.7] - 2026-11-22

### Ajouté
- Vérifications automatiques sur GitHub (CI) : syntaxe, règles ESLint et tests à chaque push.
- ESLint, `.editorconfig`, Dependabot, guide de contribution, politique de sécurité, code de conduite, modèles d'issue et de pull request.

### Corrigé
- Recherche de la pochette : les versions « live » étaient censées être écartées, mais le filtre ne marchait pas (caractères invisibles dans l'expression).

## [0.1.6] - 2026-11-22

### Corrigé
- Agrandir les paroles n'agrandit plus l'horloge.
- La page de paramètres ne gèle plus pendant le défilement (aperçus du visualiseur dessinés seulement s'ils sont visibles, à 30 i/s, en pause pendant le défilement).

## [0.1.5] - 2026-11-22

### Modifié
- Moins de ressources : lueurs des rayons, barres, anneau et halo regroupées (environ un tiers de calcul graphique en moins à 60 i/s).
- 30 images par seconde par défaut ; les installations réglées sur 60 passent à 30 une seule fois.
- Musique en pause : la scène tourne à 15 i/s.

## [0.1.4] - 2026-11-21

### Modifié
- Paramètres réorganisés en Disposition, Scène et Visualiseur ; seuls les réglages utiles à l'affichage choisi sont montrés.

## [0.1.3] - 2026-11-21

### Ajouté
- Éditeur de la scène : chaque élément (disque, paroles, grand titre, pochette, « En lecture », boutons, « À suivre », horloge, barres) se déplace, se redimensionne, s'affiche ou se masque ; modèles, aimantation, annulation, raccourcis clavier.
- Boutons aléatoire et répétition via l'API Spotify.
- Visualiseurs Blocs et Halo, thème Violet, rayons épais, lueur du disque, bord lumineux, anneaux de la pochette, horloge, galerie d'aperçus.

### Corrigé
- Les boutons de la scène sont remis au-dessus du bureau s'ils passent dessous.

## [0.1.2] - 2026-11-21

### Ajouté
- Diagnostic à copier depuis les paramètres ou le menu de l'icône.

## [0.1.1] - 2026-11-21

### Ajouté
- Mises à jour automatiques via les Releases GitHub.

### Corrigé
- Publication : une seule Release GitHub par version.

## [0.1.0] - 2026-11-21

Première version publique : visualiseur sur le fond d'écran Windows, scène (disque, paroles synchronisées, panneau « en lecture », file d'attente), écran de veille, plein écran, connexion Spotify.

[Non publié]: https://github.com/vigoRz-c/sillon/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/vigoRz-c/sillon/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/vigoRz-c/sillon/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/vigoRz-c/sillon/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/vigoRz-c/sillon/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/vigoRz-c/sillon/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vigoRz-c/sillon/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/vigoRz-c/sillon/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/vigoRz-c/sillon/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/vigoRz-c/sillon/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/vigoRz-c/sillon/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/vigoRz-c/sillon/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/vigoRz-c/sillon/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/vigoRz-c/sillon/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/vigoRz-c/sillon/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vigoRz-c/sillon/releases/tag/v0.1.1
[0.1.0]: https://github.com/vigoRz-c/sillon/commit/e7b9a19
