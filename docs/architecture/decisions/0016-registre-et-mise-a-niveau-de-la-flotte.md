# ADR 0016 — Registre de flotte et forme d'une mise à niveau

- **Statut** : Accepté
- **Date** : 2026-09-03
- **Jalon** : 9

## Contexte

L'ADR 0003 fixe qu'une boutique est un clone d'un tag immuable du socle et
qu'elle reçoit les versions suivantes par fusion. Il ne dit pas **qui tient la
liste des boutiques**, ni **ce qu'une mise à niveau fait exactement** : ce sont
les deux questions que le jalon 9 doit trancher pour que l'offre soit
industrialisable (point de décision E).

Trois faits contraignent la réponse.

**Une flotte n'est pas découvrable.** Deux boutiques sont deux dépôts sur deux
comptes Cloudflare (ADR 0001) ; rien sur le poste d'un exploitant ne dit quels
répertoires sont sous contrat. Balayer le disque à la recherche de
`client/client.yaml` ramasserait un essai abandonné, le clone d'un collègue et
la boutique d'un client parti — et la commande de mise à niveau **écrit**.

**Le manifeste est une déclaration, l'historique est un fait.** `coreVersion`
est un champ que quelqu'un peut éditer ; le tag fusionné dans `HEAD` est ce que
la boutique embarque réellement. Les deux peuvent diverger, et c'est précisément
ce que l'ADR 0003 demande à `shopctl core status` de repérer.

**Une mise à niveau non approuvée est une mise en production non approuvée.**
Le jalon 6 a mis le déploiement de production derrière un GitHub Environment
avec relecteurs obligatoires. Une commande de flotte qui déploierait après avoir
fusionné contournerait cette porte pour toutes les boutiques à la fois.

## Décision

**La flotte est déclarée dans un registre, jamais devinée.** Un fichier
`fleet.json` — hors du socle et hors des boutiques, dans l'espace de travail de
l'agence — liste les boutiques exploitées et le dépôt du socle dont elles
prennent les versions. Une boutique que personne n'y a inscrite n'est pas dans
la flotte. Le registre ne contient **aucun secret et aucun identifiant de
compte** : tout le reste est déjà dans le manifeste de chaque boutique.

Il est en **JSON** et non en YAML. Le lecteur de manifeste
(`scripts/manifest-yaml.mjs`) refuse délibérément les séquences, et un registre
est une liste : élargir ce lecteur pour servir un fichier que le commerçant ne
voit jamais affaiblirait celui qui lit le fichier dont les valeurs deviennent
des noms de ressources Cloudflare.

**La version d'une boutique est lue dans son historique.** Le tag `v<semver>` le
plus récent fusionné dans `HEAD` fait foi ; le manifeste est comparé à lui, et
un désaccord est un défaut rapporté, pas une valeur corrigée en silence.

**Une mise à niveau est une proposition, jamais un déploiement.** Elle récupère
le tag, crée la branche `socle/<tag>`, fusionne, met `coreVersion` à jour, rend
les fichiers générés, exécute les portes que la boutique transporte — celles de
la **nouvelle** version — et, sur demande, ouvre une pull request. Elle ne
fusionne aucune pull request et n'appelle jamais `shopctl deploy`.

**Trois refus sont durs**, parce que chacun coûterait beaucoup plus tard :

- un arbre de travail modifié — la fusion mêlerait un travail en cours à un
  commit qui prétend être une version du socle ;
- un retour en arrière — un tag publié est immuable (ADR 0003) ; une version
  fautive se corrige par la suivante ;
- une version qui réécrit une migration publiée — une base qui l'a déjà
  exécutée ne la rejouera pas (ADR 0006).

**Un conflit est laissé dans l'arbre.** La commande nomme chaque fichier en
conflit et sa propriété (cœur, client, généré), puis s'arrête en code 6 ; la
résolution est un travail git dans cet arbre, et un `--abort` automatique
détruirait le seul exemplaire de l'état à trois voies dont l'exploitant a
besoin. `--abort-on-conflict` existe pour l'appelant qui préfère l'inverse.

**Une boutique en défaut n'arrête pas la flotte.** `fleet upgrade` rapporte
l'échec contre sa boutique et continue ; le code de sortie est non nul à la fin.

**Une version du socle est publiée par une porte, pas par une convention.**
`scripts/release.mjs` exige que `package.json`, les manifestes témoins et
`docs/migrations/v<version>.md` disent la même chose, refuse de déplacer un tag
publié, refuse une migration réécrite et refuse une migration destructive. Le
workflow `Release` exécute la suite complète et la construction depuis un clone
vierge **avant** de poser le tag.

## Conséquences

- une agence peut proposer une version à toute sa flotte d'une commande, et
  chaque boutique la prend quand un humain approuve sa pull request ;
- une boutique peut rester volontairement sur une version antérieure : la
  flotte n'est jamais mise à niveau d'un bloc, et le rapport de versions dit qui
  est où ;
- la dérive est visible avant la fusion : les fichiers du cœur qu'une boutique a
  modifiés sont exactement les endroits où la fusion devra choisir ;
- le socle doit publier des notes de migration pour chaque version, sans quoi la
  porte de publication refuse le tag ;
- le registre est un fichier de plus à tenir à jour ; c'est le prix d'une
  commande qui écrit dans plusieurs dépôts et ne doit jamais en toucher un que
  personne n'a inscrit.

## Alternatives écartées

- **Découvrir les boutiques en balayant un répertoire** : une commande qui écrit
  ne doit pas deviner sa cible ; un clone oublié deviendrait une boutique de la
  flotte.
- **Tenir le registre dans le dépôt du socle** : il nommerait les clients dans
  un dépôt qui doit rester neutre (ADR 0008), et le socle est cloné par chaque
  boutique — chaque client repartirait avec la liste des autres.
- **Lire la version dans le manifeste seul** : c'est une déclaration ; une
  boutique dont quelqu'un a édité `coreVersion` mentirait à toute la flotte.
- **Déployer après une mise à niveau réussie** : contourne l'approbation humaine
  du jalon 6, pour toutes les boutiques d'un coup.
- **Fusionner automatiquement la pull request quand la CI est verte** : la CI
  d'une boutique ne lit pas ses notes de migration et ne connaît pas son
  calendrier commercial.

## Vérification

- `test/scripts/fleet.test.mjs` : deux boutiques témoins mises à niveau depuis
  un socle réel, thème et manifeste inchangés (hors `coreVersion`), conflit
  volontaire signalé fichier par fichier, migration additive appliquée,
  écriture de l'ancienne version toujours acceptée par le nouveau schéma,
  boutique non sélectionnée restée sur sa version et toujours verte, une seule
  pull request par boutique ;
- `test/scripts/release.test.mjs` : la porte de publication et les statements
  qu'une migration ne peut pas porter ;
- `npm run check:release` à chaque commit, `Release` avant chaque tag.
