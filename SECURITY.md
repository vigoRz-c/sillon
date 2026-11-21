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

Le détail est dans la section « Données et vie privée » du [README](README.md).
