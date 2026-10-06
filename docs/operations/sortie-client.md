# Procédure — départ d'un client

Le commerçant qui quitte l'agence part avec sa boutique, en état de marche, et
l'agence ne garde rien de ses données. C'est la promesse de réversibilité de
l'ADR 0002, et elle tient parce que les comptes sont déjà les siens : il n'y a
**rien à migrer**, seulement des accès à rendre et des copies à effacer.

Deux départs sont possibles, et le second contient le premier :

- **il garde l'infrastructure** (Cloudflare, Stripe, Resend, le domaine) et
  change seulement d'opérateur ;
- **il quitte aussi Cloudflare** : il emporte alors une sauvegarde lisible sans
  Cloudflare (ADR 0005) et la clé qui l'ouvre.

## 1. Avant de rendre les accès

- [ ] le dernier run nocturne est vert, et une sauvegarde fraîche est prise et
  vérifiée :
  `npm run shopctl -- backup --env production --upload` puis
  `npm run shopctl -- backup verify <id>` ;
- [ ] la boutique est à une version publiée du socle
  (`npm run shopctl -- core status`) : le repreneur doit pouvoir dire de quel
  tag il part ;
- [ ] les migrations en attente sont appliquées — aucune ne doit rester entre
  deux opérateurs.

## 2. Remettre

- [ ] **le dépôt** : transfert du dépôt GitHub de la boutique vers
  l'organisation du commerçant (Settings → Transfer), ou une copie complète
  avec son historique si l'agence doit garder l'original pour sa propre
  comptabilité. L'historique compte : c'est lui qui dit de quel tag du socle
  la boutique part et quelles divergences elle porte ;
- [ ] **la clé de sauvegarde**, par un canal chiffré et jamais avec une
  archive dans le même envoi. Le commerçant peut ensuite en écrire une nouvelle
  (`backup keygen`) et reprendre une sauvegarde sous sa clé ;
- [ ] **les secrets d'environnement GitHub** : `shopctl repo`, lancé par le
  repreneur avec ses propres jetons, réécrit `CLOUDFLARE_API_TOKEN` ;
  `SHOPCTL_BACKUP_KEY` se remplace en supprimant le secret puis en relançant ;
- [ ] **la documentation** : ce dossier `docs/operations/`, les ADR, le plan,
  et les dérogations écrites encore ouvertes.

S'il quitte aussi Cloudflare : une archive pleine (`backup` sans `--no-media`,
qui emporte les octets des images et des fichiers vendus), copiée hors du
bucket par `backup pull`, et la clé. Le format est documenté par
`shopctl/src/backup/archive.mjs` : un manifeste en clair, un corps gzip puis
AES-256-GCM, un fichier par objet.

## 3. Révoquer les accès de l'agence

Le commerçant les retire lui-même, l'agence le lui demande et vérifie :

- [ ] Cloudflare : membres du compte, et jetons API créés pour l'agence ;
- [ ] Stripe : membres de l'équipe, clés restreintes créées pour l'agence ;
- [ ] Resend, registrar du domaine : membres ;
- [ ] GitHub : collaborateurs et équipes de l'agence sur le dépôt ;
- [ ] Cloudflare Access : les politiques qui nomment des adresses de
  l'agence.

## 4. Effacer ce que l'agence détient

L'article 28, paragraphe 3, point g) du RGPD : au terme du service, le
sous-traitant supprime ou renvoie les données personnelles, et en supprime les
copies.

- [ ] sur les postes des opérateurs : le répertoire `backups/` de l'arbre, les
  exports `privacy/`, `.shopctl/backup.key` une fois la clé remise ;
- [ ] tout environnement de la boutique encore présent sur le compte de
  l'agence : `shopctl destroy --env staging --confirm <slug>` (ADR 0015 ;
  normalement fait à la mise en ligne) ;
- [ ] les artefacts du workflow Deploy restent avec le dépôt transféré ; ils ne
  portent aucune donnée personnelle, seulement des rapports.

## 5. Clore

Un procès-verbal daté, signé des deux parties : la liste ci-dessus cochée,
l'identifiant de la dernière sauvegarde remise et son empreinte, la date de
révocation de chaque accès, et l'attestation de suppression des copies.
