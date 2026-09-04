# Notes de migration du socle

Une note par version publiée : `v<major>.<minor>.<patch>.md`, du nom du tag.

Elle dit ce que la version demande à une boutique qui la prend — pas ce qu'elle
change dans le socle, ce qui est le travail du diff. C'est le texte que trois
lecteurs différents voient :

- `shopctl core upgrade --to v<x.y.z>` l'affiche avant de fusionner ;
- la pull request de mise à niveau le reprend, pour que le relecteur décide sans
  ouvrir le diff en premier ;
- la GitHub Release est créée à partir du même fichier.

Une version sans note ne se publie pas : `npm run check:release` refuse le tag
(ADR 0003, ADR 0016). `node scripts/check-release.mjs --set <version>` écrit la
version partout où elle est déclarée et dépose le squelette de la note.

Les migrations D1 restent additives et rétrocompatibles (ADR 0006) : une note
n'autorise jamais une suppression, elle décrit ce que le commerçant ou
l'exploitant doit faire en plus de la fusion.
