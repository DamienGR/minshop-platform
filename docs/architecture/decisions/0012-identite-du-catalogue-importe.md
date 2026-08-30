# ADR 0012 — Identité du catalogue importé

- **Statut** : Accepté
- **Date** : 2026-08-30
- **Jalon** : 4

## Contexte

Le plan §5.4 demande un import « idempotent par SKU » et « capable de
reprendre ». Ces deux exigences n'en sont qu'une : elles portent toutes deux sur
la question de savoir comment une seconde exécution reconnaît ce que la première
a écrit. Tant que cette question n'a pas une réponse, « idempotent » n'est qu'une
intention et « reprise » demande un journal.

Trois candidats existaient pour tenir cette identité.

**L'identifiant de ligne.** Stable, unique, déjà là — et absent du fichier que le
commerçant maintient. Le lui faire écrire reviendrait à lui demander de recopier
une invention de la boutique, qu'il ne peut ni vérifier ni reconstruire, et qui
n'existe pas encore au premier import.

**Le slug.** Présent des deux côtés, lisible — et il bouge. Un slug est dérivé du
nom, et le premier import qui suit une correction de libellé ne retrouverait plus
le produit : il en créerait un second, en laissant le premier en ligne.

**Le SKU.** C'est la référence que le commerçant utilise déjà avec son
fournisseur, son inventaire et son comptable. Les variantes en portaient une
depuis la migration 0017, parce qu'une variante *est* l'unité d'inventaire ; les
produits simples n'avaient nulle part où mettre la leur.

Les images posaient la même question sous une autre forme. `mediaKeyFor()`
attribue à chaque téléversement de l'administration une clé aléatoire, ce qui est
juste là-bas — deux téléversements de la même photo sont deux gestes délibérés —
et faux pour un import, qui rejoue le même geste après une panne réseau, après
une correction de prix, ou après rien du tout.

## Décision

**Le SKU est l'identité de l'import, à tous les niveaux.** La migration 0042
ajoute `products.sku` avec un index unique partiel. Une ligne du CSV décrit une
unité vendue et porte sa référence dans `sku` ; les lignes d'un produit à
variantes portent en plus la référence du produit parent dans `product`, qui est
le `products.sku` de celui-ci. Un produit simple est donc le cas où la référence
du produit et celle de l'unité coïncident, et non un cas particulier du code.

**La clé d'un objet importé est dérivée de son contenu** :
`media/<20 hex de sha256>.<ext>`. Deux produits qui partagent une photo partagent
un objet et une ligne `media` ; un réimport n'envoie rien, sans interroger le
bucket. La longueur n'est pas négociable : au-delà de 32 chiffres hexadécimaux,
le pipeline d'observabilité de Cloudflare biffe l'identifiant dans l'URL et
chaque requête d'image se journalise en `GET /images/media/REDACTED.webp`. Vingt
caractères est le budget que `mediaKeyFor()` documente déjà, dépensé ici en
préfixe de condensat plutôt qu'en octets aléatoires. La promesse
d'immuabilité de `/images/*` est renforcée, pas affaiblie : même clé, mêmes
octets, toujours.

**Il n'y a pas de journal d'import.** L'état de la boutique est le journal. Une
exécution interrompue laisse un état que la suivante lit, et le plan calculé
depuis cet état est exactement le reste à faire. C'est la conséquence directe des
deux choix ci-dessus, et c'est ce qui permet à `--dry-run` d'emprunter le même
chemin de code que l'import réel.

**`product_variants.sku` ne reçoit pas d'index unique.** La colonne est du texte
libre dans l'administration depuis 0017, donc une boutique en exploitation peut
déjà porter des doublons ; une migration qui échoue sur les données d'une
boutique est une migration qu'on ne peut pas livrer à une flotte (ADR 0006).
L'import refuse une référence ambiguë au moment du plan, en nommant les deux
lignes — ce qu'un index ne saurait pas faire.

**L'administration ne contraint pas la forme d'un SKU.** Le champ est du texte
libre : la référence du commerçant est ce que son fournisseur imprime sur le
carton. Le CSV est plus strict, parce qu'un tableur maltraite ce qu'un champ de
formulaire respecte. `shopctl catalog validate` signale l'écart au lieu de
laisser les deux règles diverger en silence.

## Conséquences

- un produit sans référence ne peut pas être maintenu par un fichier : l'import
  l'adopte par son URL au premier passage, et le rapport compte les produits qui
  n'en ont pas ;
- deux boutiques peuvent porter la même référence sans se gêner : l'identité est
  locale à une base, comme tout le reste (ADR 0001) ;
- une reprise après interruption coûte au pire quelques objets R2 non
  référencés, jamais une ligne pointant vers un objet absent : l'objet est écrit
  avant la ligne qui le nomme, dans le même ordre que `uploadMedia()` ;
- changer la dérivation de la clé d'image rendrait orphelins tous les objets déjà
  écrits. Cette décision est donc aussi durable que les URL publiques qu'elle
  produit ;
- l'export du catalogue, quand il viendra, écrit le même fichier que l'import
  lit : c'est la même identité des deux côtés.

## Alternatives écartées

- **Un journal d'import dans D1** : demande à un fichier de bookkeeping de
  survivre à l'interruption qu'il est censé décrire, et ajoute un second état
  qui peut diverger de celui du catalogue.
- **Rendre le slug identifiant** : rendrait toute correction de libellé
  destructrice, ou interdirait les corrections de libellé.
- **Une clé d'image aléatoire, avec une table de correspondance chemin → clé** :
  reconstruit une table de bookkeeping pour éviter un condensat, et casse dès
  qu'un fichier est renommé alors que son contenu n'a pas changé.
- **Un index unique sur `product_variants.sku`** : correct sur une base neuve,
  irrecevable sur une flotte déjà en exploitation.
- **Imposer la forme du SKU dans l'administration** : inventerait une contrainte
  que le fournisseur du commerçant ne respecte pas, dans le seul endroit où la
  saisie est déjà relue par un humain.
