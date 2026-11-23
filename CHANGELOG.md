# Journal des versions

Toutes les évolutions notables de Sillon. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), numéros de version [SemVer](https://semver.org/lang/fr/).

## [Non publié]

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

[Non publié]: https://github.com/vigoRz-c/sillon/compare/v0.2.0...HEAD
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
