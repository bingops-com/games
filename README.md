# games

An opt-in common account database is prepared with Slots. Ordinary deployments
keep their existing database: `GAMES_SHARED_ACCOUNTS` defaults to false. When
enabled, Games requires a pre-migrated `identity` schema and uses `games,identity`
as its search path. Password changes, recovery and administrator revocations
invalidate shared player sessions in both applications; administrator access
still requires the separate Authentik identity. Player cookies remain host-only,
so users sign in on each site with the same credentials.

The owning migration/backup/restore procedure is
[LabOps Arcade](https://github.com/bingops-com/labops/tree/master/apps/workloads/arcade).
The Helm `database.sharedAccounts` switch chooses the existing shared Secret
while retaining the original CNPG cluster and backups. `maintenance: true`
stops the application declaratively for the reviewed migration write freeze.
Never enable shared mode against an ordinary Games/Slots database or disable
the original CNPG resources as part of the cutover.

Les jeux de société de `lab.bingo`, à jouer entre amis, chacun sur son écran,
autour d'une même table.

Six jeux se jouent à plusieurs, en direct, dans un salon : on en crée un, on
envoie son lien, tout le monde le rejoint depuis son navigateur, l'hôte choisit
le jeu et lance la partie. On reste dans le même salon pour rejouer ou changer
de jeu. Les comptes sont facultatifs ; ils donnent un profil public, des
statistiques par jeu et des amis.

Un binaire Go sert l'API, les salons (WebSocket) et l'interface Next.js
embarquée. Les règles ne sont jouées que par le serveur ; comptes, amis et
statistiques sont dans PostgreSQL, les salons en cours dans la mémoire du
serveur.

## Démarrer

```sh
make db      # un PostgreSQL local (Docker, compose.yaml)
make run     # construit tout, puis http://localhost:3778
make dev     # API sur :3778 et Next.js avec rechargement à chaud sur :3000
make check   # tests Go, go vet, vérification des types, rendu du chart
make art     # régénère le logo et les illustrations des jeux depuis art/*/src
```

Il faut Go (version de `go.mod`), Node 20.9 ou plus récent et un PostgreSQL.
Les tests parlent à une vraie base : ils créent chacun leur schéma et le
suppriment. Sans `GAMES_TEST_DATABASE_URL` (que `make test` renseigne), `go test`
les saute et répond quand même `ok`.

## Jeux

| Jeu | Joueurs | Règles suivies |
| --- | --- | --- |
| Ono | 2 à 8 | Celles du Uno : 108 cartes, quatre couleurs, passe, changement de sens, +2, joker et joker +4. On annonce « Ono ! » à sa dernière carte ; l'oublier coûte deux cartes si un autre joueur le fait remarquer avant le coup suivant. 30 secondes par tour, sinon on pioche. Pas de cumul des +2, pas de contestation du +4. Une manche, le premier sans carte gagne. |
| Codenoms | 4 à 10 | Celles de Codenames : 25 mots, 9 pour l'équipe qui commence, 8 pour l'autre, 7 neutres, 1 interdit. Un joueur par équipe connaît la grille et donne un indice d'un mot et un nombre ; ses coéquipiers désignent jusqu'à ce nombre plus un. Les équipes s'appellent Bâbord et Tribord. |
| BoomParty | 2 à 12 | Celles de BombParty : une syllabe, un mot français qui la contient pour passer la bombe, deux vies. La mèche dure de 10 à 25 secondes sans que personne sache combien ; qui reçoit la bombe a toujours 5 secondes. Accents et majuscules ne comptent pas. |
| Bombermat | 2 à 4 | Celles de Bomberman : grille de 13 sur 11, piliers, caisses, bombes en croix qui se déclenchent en chaîne, huit bonus sous les caisses (bombe, portée, vitesse, coup de pied, bombes perçantes, gilet, plein feu, tête de mort). On se déplace librement dans les couloirs : le pion s'arrête où la touche est relâchée, entre deux cases s'il le faut, et se recale sur le couloir quand il tourne. Après deux minutes la grille se referme en spirale. |
| Skribouille | 2 à 12 | Celles de skribbl.io : chacun dessine à son tour un mot choisi parmi trois, 75 secondes ; les autres écrivent ce qu'ils voient. 40 à 100 points selon la vitesse, 20 au dessinateur par joueur qui trouve ; des lettres se dévoilent avec le temps ; « presque » à une lettre près. Deux tours de table jusqu'à 6 joueurs, un seul au-delà. |
| Gartik Phone | 3 à 12 | Celles de Gartic Phone : tout le monde écrit une phrase, le suivant la dessine, le suivant décrit le dessin, six manches au plus (50 s pour écrire, 90 s pour dessiner). À la fin l'hôte tourne les pages de chaque album devant tout le monde. Personne ne gagne : la partie compte comme jouée, sans victoire. |

Les noms sont proches de ceux des jeux d'origine sans être les mêmes ; les
dessins et les textes sont originaux. Dans le code et dans la base, les jeux
gardent leurs identifiants d'avant (`terre`, `pavillons`, `meche`, `poudriere` ; les deux jeux de dessin sont
`skrib` et `gartik`) :
les statistiques déjà enregistrées restent valables. Les règles sont dans
`internal/games`, un fichier par jeu, sans réseau ni stockage ; le catalogue
présenté aux joueurs est dans `web/games/catalog.ts`.

Le dictionnaire de BoomParty (`internal/games/words/french.txt.gz`, 325 000
formes sans accents) vient du paquet Debian `wfrench`, **sous licence GPL-3+** :
à garder en tête si le dépôt devient public ou change de licence. Les syllabes
proposées sont les groupes de deux ou trois lettres présents dans assez de ses
mots. Les 358 mots de Codenoms, que Skribouille donne aussi à dessiner, sont dans
`internal/games/pavillons.go`.

## Salons

- **Accueil** : un nom, puis « Créer un salon » ou « Rejoindre avec un code ».
  Cliquer sur un jeu le choisit comme premier jeu du salon ; c'est le bouton
  qui crée le salon.
- Un salon a un code de 8 lettres (sans I ni O) et un lien d'invitation. Celui
  qui le crée en est l'hôte : il choisit le jeu, lance la partie, peut
  l'arrêter, la relancer ou changer de jeu. Les autres voient son choix en
  direct.
- Jusqu'à 12 joueurs s'installent avant une partie. Un jeu qui ne convient pas
  au nombre de joueurs présents ne peut pas être lancé, et le salon dit pourquoi.
- On joue en invité ou avec un compte. Seules les parties jouées jusqu'au bout
  avec un compte comptent dans les statistiques.
- Qui arrive pendant une partie la regarde et joue la suivante.
- Le salon compte les victoires de chacun, invités compris, tant qu'il reste
  dans le salon : une coupe et un nombre à côté de son nom.
- L'hôte peut retirer un joueur du salon (« Retirer », puis « Confirmer »). Le
  joueur retiré sort de la partie en cours et ne peut plus rejoindre ce salon.
- Une connexion perdue garde la place 45 secondes ; la page se reconnecte seule.
  Passé ce délai, ou si le joueur quitte le salon, il sort de la partie.
- Fermer l'onglet, recharger la page du salon ou naviguer hors du site quitte
  immédiatement la partie si le navigateur transmet son départ. Un autre onglet
  du même joueur conserve sa place ; changer d'onglet ne le fait pas partir.
  Après rechargement, il rejoint comme spectateur jusqu'à la partie suivante.
  Si le navigateur est tué sans notification, le délai réseau de 45 secondes
  reste le filet de sécurité. L'hôte est remplacé lorsqu'il quitte le salon.
- Un salon vide est gardé dix minutes. Les salons sont enregistrés en base et
  survivent à un redémarrage (voir « Dans un salon ») ; les parties en cours,
  elles, vivent dans la mémoire du serveur, et il ne faut qu'une instance.

## Langues

L'interface existe en français et en anglais. Elle suit la langue du navigateur
au premier passage ; le lien « English » / « Français » de l'en-tête en change
et le choix est retenu sur l'appareil. Chaque texte est écrit dans les deux
langues là où il sert, `t('Rejoindre', 'Join')` ; les messages du serveur
arrivent en français et sont traduits par `web/lib/i18n.ts` (un message ajouté
côté serveur doit y être ajouté aussi, sinon il s'affiche en français).

Restent en français quelle que soit la langue : les noms des jeux, les mots de
la grille de Codenoms et le dictionnaire de BoomParty (l'interface anglaise
le dit : « a French word »), ainsi que la description de la page lue par les
moteurs de recherche.

## Comptes

- Jouer en invité sous un nom du type `Poulpe-Tenace` (tiré au hasard, avec un lien pour en tirer un autre), modifiable, ou créer un
  compte avec pseudo et mot de passe, sans e-mail ni SMS. Dix codes de
  récupération sont affichés une seule fois et peuvent être téléchargés.
- **Profil public** : `/u/<pseudo>` montre à tout le monde le pseudo, la date
  d'inscription, le nombre d'amis et les statistiques par jeu (parties jouées,
  victoires). Il ne montre jamais qui sont les amis.
- **Amis** : inviter un joueur par son pseudo ou depuis son profil, accepter,
  refuser, annuler, retirer. Deux invitations qui se croisent font une amitié.

## Ce qui reste à faire

- Inviter ses amis dans un salon depuis l'interface (aujourd'hui on leur envoie
  le lien).
- Des réglages par jeu (nombre de vies, durée du tour, variantes).
- Dessin : pas de gomme dédiée (le blanc en tient lieu). Crayon et pot de peinture
  fonctionnent dans Skribouille et Gartik Phone ; un dessin est limité à
  9 000 points et 600 opérations, dont 32 remplissages au plus.
- Des sons, et des illustrations par jeu comme dans slots.
- `make dev` : le passage des WebSockets par le serveur de développement de
  Next.js n'a pas été vérifié ; `make run` sert tout depuis le binaire.

## Configuration

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `GAMES_DATABASE_URL` | Base PostgreSQL, `postgres://user:motdepasse@hôte:5432/games` | obligatoire |
| `GAMES_ADDR` | Adresse d'écoute | `:3778` |
| `GAMES_TRUST_PROXY` | `true` derrière un reverse proxy qui écrit `X-Forwarded-For` et `X-Forwarded-Proto` | |
| `GAMES_ADMIN_ENABLED` | Active le panneau Authentik séparé des comptes joueurs | `false` |
| `GAMES_ADMIN_ISSUER` | Issuer OIDC HTTPS canonique terminé par `/` | obligatoire si activé |
| `GAMES_ADMIN_CLIENT_ID` | Client OIDC public avec PKCE | `games-admin` |
| `GAMES_ADMIN_USERNAME`, `GAMES_ADMIN_GROUP` | Identité et groupe administrateur tous deux obligatoires | `bingops`, `games-admins` |

Ne mettez `GAMES_TRUST_PROXY=true` que si le serveur n'est joignable qu'à travers
le proxy : sinon un client choisit l'adresse sous laquelle il est compté.

Le schéma est créé et mis à jour au démarrage (table `schema_version`, sous
verrou : plusieurs instances peuvent démarrer ensemble). Si la base ne répond pas
encore, le serveur réessaie dix fois avant d'abandonner.

## Mise en production

Le chart Helm est dans `chart/`. Il déploie le serveur et, par défaut, sa base :
un cluster CloudNativePG dont le secret généré (`games-postgresql-app`, clé
`uri`) fournit `GAMES_DATABASE_URL`. Aucun mot de passe n'est écrit dans les
valeurs. **Cette révision est validée hors ligne, pas déployée.**
La configuration LabOps est préparée dans `apps/workloads/games` du dépôt
`bingops-com/labops` ; son runbook possède les prérequis et la mise en service.

Le responsable de la mise en service est l'opérateur LabOps. Les prérequis sont
CloudNativePG et son plugin Barman Cloud, un stockage persistant, un CNI qui
applique les NetworkPolicy et le proxy HTTPS. Avec l'Ingress fourni : Traefik
et cert-manager, émetteur `letsencrypt-cloudflare` (modifiable dans
`ingress.annotations`). Aucun relais SMTP, fournisseur mail ou SMS n'est requis.

Le chart passe automatiquement en production avec `ingress.enabled=true`.
Pour un tunnel qui atteint directement le Service, mettre explicitement
`production=true`. Il refuse les configurations de production sans URL HTTPS,
image épinglée, isolation réseau et sauvegarde continue. Valeurs à
déclarer dans la source GitOps LabOps, sans identifiants en clair :

| Valeur | Rôle |
| --- | --- |
| `image.repository`, `image.digest` ou `image.tag` | Image GHCR épinglée par `sha256:…` ou `sha-<commit de 40 caractères>` |
| `production`, `publicUrl`, `ingress.*` | Origine HTTPS publique ; doit correspondre à l'Ingress s'il est activé |
| `networkPolicy.ingressFrom` | Namespace **et** labels des pods des seuls proxies autorisés ; adapter pour Cloudflare Tunnel |
| `networkPolicy.dnsTo`, `databaseTo` | Sorties limitées au DNS et à PostgreSQL ; vérifier les vrais labels du cluster |
| `admin.*`, `networkPolicy.adminTo` | Panneau Authentik et destinations HTTPS explicites de son issuer ; aucun secret client |
| `database.cnpg.storage` | Taille et classe du volume de la base (2 Gi) |
| `database.cnpg.backup.*` | Activer sauvegarde quotidienne, archivage WAL, destination S3, Secret des clés, rétention et génération d'archive |
| `database.cnpg.recovery.*` | Restauration déclarative d'un **nouveau** cluster depuis une génération d'archive précédente |
| `database.cnpg.enabled=false`, `database.existingSecret.*`, `networkPolicy.databaseTo` | Base externe : référence du Secret, runbook de sauvegarde propriétaire et accès réseau explicite obligatoires |

La NetworkPolicy ne sélectionne que le serveur Games, pas les pods CNPG ; le
runbook CloudNativePG de LabOps possède la sécurité et l'accès S3 de la base.
Les valeurs par défaut restent privées, sans sauvegarde : elles ne
constituent pas une configuration publique. Le Service reste `ClusterIP`.

**Un seul réplica, stratégie `Recreate`.** Les salons actifs ne sont pas
partagés : une mise à jour interrompt les parties en cours, puis retrouve les
salons en attente. Lors du premier passage aux codes de huit lettres, les
anciens salons à quatre lettres ne sont pas restaurés : recréer un salon et
renvoyer son invitation. Comptes, amis et statistiques sont conservés. Le
cluster PostgreSQL est conservé lors d'une désinstallation du chart.

La CI utilise le Go corrigé épinglé dans `go.mod`, audite le verrou npm et
teste le chart. Après un futur push autorisé sur `master`, elle construit
l'image, bloque sa publication si Trivy trouve une vulnérabilité HIGH ou
CRITICAL, puis publie `ghcr.io/bingops-com/games:sha-<commit>`. Une PR ne publie
rien. Un lancement manuel de la CI sur une branche permet de publier une
image candidate scannée, épinglée au SHA de cette branche. La visibilité GHCR ou un `imagePullSecrets` en lecture seule reste à
configurer par l'opérateur ; aucune image n'est publiée par les tests locaux.

Vérifications reproductibles, sans appliquer de ressources :

```sh
bash chart/tests/check.sh
helm template games chart --namespace games --values /path/to/production-values.yaml >/dev/null
```

`chart/tests/production.yaml` contient uniquement des valeurs fictives de test,
jamais une configuration à déployer. Le feu vert opérationnel exige en plus
un certificat HTTPS valide, une récupération par code et la révocation des sessions,
un archivage WAL et une sauvegarde réussis, une restauration contrôlée et un
test effectif de l'isolation réseau. Ces contrôles en cluster ne sont pas
remplacés par `helm template` et ne sont pas exécutés implicitement.

`/livez` contrôle le processus ; `/healthz` contrôle aussi PostgreSQL. Une panne
de base retire le pod du service sans le redémarrer en boucle.

Les salons sauvegardés occupés restent restaurables même après une longue
attente sans changement. Les salons sauvegardés vides expirent après dix
minutes. Une connexion lente libère sa présence et la main de son hôte.

Les tentatives de récupération sont limitées par IP, globalement et par pseudo
sans distinction de casse (cinq tentatives, puis une toutes les trente secondes).
Un code est consommé, le mot de passe modifié et les sessions fermées dans une
transaction ; une double utilisation concurrente a un seul gagnant. Les codes
restants continuent de fonctionner. Le renouvellement des codes et le changement
du mot de passe revérifient atomiquement le condensé validé : une requête ancienne
ne peut pas annuler une récupération concurrente.

### Entrées sensibles et reprise

Les URL, sélecteurs réseau, versions, destination S3 et noms de génération
sont de la configuration déclarative. Les sessions, comptes, salons et
statistiques sont de l'état PostgreSQL ; ne jamais les exporter dans Git.
Pour pouvoir reconstruire sans l'historique d'une conversation :

- **Base CNPG** : le Secret applicatif est généré par l'opérateur et régénéré
  après restauration avec `database` et `owner`. Ne pas copier sa valeur ;
  le chart référence le Secret du cluster restauré.
- **Sauvegardes S3** : clés dans Bitwarden, dossier `labprod`, propriété LabOps ;
  créer/faire tourner une identité limitée au bucket/préfixe Games (lecture,
  écriture, liste et suppression pour la rétention). Son Secret Kubernetes
  synchronisé par BitwardenSecret a les clés `ACCESS_KEY_ID` et `ACCESS_SECRET_KEY`, et est référencé par
  `backup.credentialsSecret`. Procédure propriétaire : runbook CloudNativePG
  de LabOps, `docs/infrastructure/cloudnative-pg.md`. Vérifier les statuts
  `ContinuousArchiving`, `Backup` et `ScheduledBackup`, sans afficher le Secret.
- **Codes de récupération** : credentials personnels des joueurs, sauvegardés
  par leur propriétaire dans un gestionnaire de mots de passe ou un fichier privé.
  PostgreSQL ne garde que les empreintes SHA-256 de codes aléatoires de 128 bits ;
  elles suivent les sauvegardes CNPG. Les codes ne sont jamais envoyés à Bitwarden,
  dans les journaux, dans une URL ni dans le stockage persistant du navigateur.
  En cas de perte, un joueur encore muni de son mot de passe peut renouveler les
  codes depuis « Mon compte » ; sans les deux, il n'existe pas de récupération
  opérateur. Après restauration d'une ancienne sauvegarde, des codes déjà utilisés
  peuvent redevenir valides : avant réouverture, invalider tous les codes restaurés
  et toutes les sessions, puis faire renouveler les codes après connexion avec mot
  de passe. Voir le runbook LabOps pour cette opération explicitement autorisée.
- **CI et registre** : `GITHUB_TOKEN` est éphémère et fourni par GitHub. Si
  l'image reste privée, conserver le jeton de lecture GHCR dans Bitwarden et
  un `imagePullSecrets` scellé ; recréer/faire tourner le jeton depuis le compte
  propriétaire du paquet, puis vérifier un téléchargement sans afficher le jeton.
- **Base externe** : son propriétaire doit documenter identifiants, rotation,
  sauvegarde, restauration et vérification dans `backupRunbook` avant service.

### Restaurer sans écraser les archives

Restaurer vers un **nouveau nom de cluster/release**, jamais en modifiant le
bootstrap d'un cluster existant. Reprendre destination, endpoint et Secret
S3 depuis Git et Bitwarden ; choisir `recovery.serverName` parmi les anciennes
générations archivées et un `backup.serverName` nouveau et différent. Le chart
refuse de réutiliser l'archive source. `recovery.objectStore` vide réutilise
l'ObjectStore défini par cette release ; `recovery.targetTime` permet une
restauration à un instant précis. Exemple de **rendu uniquement** :

```sh
helm template games-restore chart --namespace games --values /path/to/production-values.yaml --set fullnameOverride=games-restore --set ingress.enabled=false --set production=true --set database.cnpg.recovery.enabled=true --set database.cnpg.recovery.serverName=games-postgresql-g1 --set database.cnpg.backup.serverName=games-postgresql-restore-g1 >/dev/null
```

Avant un exercice réel, vérifier la sauvegarde source et la disponibilité des
WAL, réserver un nom et une génération uniques, et faire autoriser sa création.
Sur la copie isolée, vérifier `/healthz` et les parcours d'un compte synthétique,
puis la reprise d'archivage vers la nouvelle génération. Ne pas exposer la copie
aux joueurs ni supprimer l'ancienne base/les archives pendant ce contrôle.
Après une interruption, réutiliser la même déclaration pour reprendre le même
cluster ; ne créer une autre génération qu'en créant réellement un autre
cluster. La bascule DNS/proxy et tout nettoyage restent des opérations
distinctes à autoriser. Référence du bootstrap :
[récupération CloudNativePG](https://cloudnative-pg.io/docs/1.26/recovery/) et
[plugin Barman Cloud](https://cloudnative-pg.io/plugin-barman-cloud/docs/usage/).

Protections du serveur : mots de passe en Argon2id, session dans un cookie
`HttpOnly` et `SameSite=Lax` (30 jours, seul son condensé est stocké), toujours
`Secure` en production même si le proxy oublie son en-tête, refus des
requêtes d'une autre origine, limitation globale et par adresse des tentatives
d'authentification, invitations limitées par compte, corps limité à 20 Ko, en-têtes
(CSP sans ressource externe), arrêt propre, journal JSON d'une ligne par appel
d'API sans jamais le corps. Sondes : `GET /livez` vérifie le processus sans accéder à la base ;
`GET /healthz` vérifie PostgreSQL et sert à la readiness. Une panne de base
ne provoque donc pas de redémarrage des parties en mémoire. WebSockets : 256 connexions au total, 24 par adresse, 3 par identité,
48 par salon ; débit par connexion, identité et adresse, admission et recherche
de salons limitées. Ces limites par adresse sont partagées derrière un même NAT.

## Avatars et objectifs

Chaque joueur a un avatar cartoon en sept pièces : couleur, corps, yeux,
bouche, barbe, lunettes, coiffe (`web/lib/avatar.tsx` les dessine). L'atelier
montre chaque pièce seule, pour bien la voir. Il se compose dans l'atelier, ouvert
depuis l'accueil, le profil ou la page Objectifs. Celui d'un compte est
enregistré et visible sur son profil ; celui d'un invité est tiré au hasard et
ne dure que le temps de l'onglet. Les autres joueurs le voient dans le salon
et dans les jeux : autour de la table d'Ono (chacun avec sa main en éventail
et son nombre de cartes), sur l'anneau de BoomParty, comme pion de Bombermat,
dans les scores de Skribouille et les équipes de Codenoms.

Une partie des pièces se débloque en accomplissant des objectifs
(`internal/server/objectives.go` : la liste, ce que chacun demande et ce qu'il
débloque ; `web/lib/objectives.ts` : leurs textes). Ils comptent les parties
jouées et gagnées, par jeu ou en tout, le nombre de jeux différents essayés,
les amis, et la série : le nombre de jours de suite où le joueur a fini au
moins une partie (jours UTC). Seule une partie jouée jusqu'au bout compte :
une partie arrêtée par l'hôte ne compte pas, une partie qui se termine parce
qu'un joueur l'a quittée (ou en a été retiré, ou ne s'est pas reconnecté) ne
compte pour personne, et qui abandonne une partie qui continue sans lui n'a
rien de compté. Rien n'est stocké par objectif : ils se
recalculent depuis les statistiques, donc en ajouter un le donne aussitôt à
ceux qui l'ont déjà mérité. Le serveur refuse une pièce pas encore débloquée.

Ce qui pousse à revenir : sous la carte de l'accueil, la série à garder ou
l'objectif le plus proche avec la pièce à la clé ; à la fin d'une partie, où en
est le prochain objectif (ou, pour un invité, ce qu'un compte aurait compté) ;
un message quand un objectif est accompli ; la page Objectifs, avec une jauge
par objectif.

## Récupérer un compte

Un compte se crée avec un pseudo et un mot de passe. La réponse initiale affiche
dix codes de récupération de 128 bits chacun, à usage unique et sans date
d'expiration. Enregistrer les codes dans un gestionnaire de mots de passe ou
télécharger le fichier privé, puis confirmer leur sauvegarde. Les codes ne sont
pas réaffichés après fermeture et restent uniquement en mémoire dans l'onglet
tant que la fenêtre est ouverte. Un rechargement les perd : se connecter avec le
mot de passe et en créer de nouveaux si nécessaire.

« Mot de passe oublié ? » ou `/reinitialiser/` demande le pseudo, un code et un
nouveau mot de passe. La récupération consomme ce code une seule fois, conserve
les neuf autres, ferme toutes les anciennes sessions HTTP et WebSocket, puis
connecte le joueur. Un pseudo inconnu, un mauvais code et un code utilisé ont le
même message d'erreur. Aucun e-mail ou SMS ne part.

« Mon compte » indique le nombre de codes restants. Le renouvellement exige une
session connectée et le mot de passe actuel, remplace tous les anciens codes et
déconnecte les autres appareils. Les anciens comptes gardent leur pseudo et leur
mot de passe ; un avertissement les invite à créer leurs codes. Sans mot de passe
et sans code, le compte est irrécupérable.

La migration ajoute `recovery_codes` sans supprimer les comptes ni leurs données
historiques. Les anciennes colonnes d'adresse restent conservées pour éviter une
suppression implicite, mais ne sont plus lues ni exposées ; les anciens liens et
routes de récupération par e-mail sont désactivés. L'ancien binaire ne prend pas
en charge cette nouvelle version du schéma : prévoir une maintenance et un plan
de reprise avant toute mise en service, et ne pas rétablir l'ancienne récupération
par mail contre cette base.

## Administration Authentik

`/admin/` est indépendant des comptes joueurs et désactivé par défaut. LabOps
déclare le provider public `games-admin`, le callback strict
`https://games.lab.bingo/api/admin/callback`, son groupe et sa policy. Seul le
compte actif `bingops`, membre de `games-admins`, peut accéder au panneau ;
`akadmin`, les autres utilisateurs SSO et les joueurs sont refusés. La réponse
userinfo doit aussi contenir `games_admin: true`, calculé par le mapping LabOps
à partir de l'identité active et du groupe courant.

La connexion utilise authorization code avec PKCE S256, state lié au navigateur
et à usage unique, nonce et vérification RS256 de l'issuer, de l'audience et de
l'expiration. Le cookie administrateur opaque est Secure, HttpOnly et SameSite
Lax en production ; il expire au plus tard après 15 minutes. Tokens et verifiers
restent en mémoire serveur, bornée, sans refresh token ni stockage navigateur.
Chaque requête protégée revérifie les droits auprès d'Authentik. Une panne ferme
l'accès administrateur et laisse le jeu public disponible. La déconnexion locale
ne ferme pas la session SSO Authentik. Les en-têtes d'identité du proxy ne donnent
aucun accès. HTML, données et callback administrateur sont servis sans cache.

Le panneau permet de consulter les joueurs, les métadonnées des salons et les
signalements, de traiter/classer un signalement ou de révoquer les sessions HTTP
et WebSocket d'un joueur. Les mutations exigent un token CSRF et un motif de
5 à 500 caractères. Action et journal `admin_audit` sont écrits dans une même
transaction. Le panneau ne montre ni mots de passe, ni e-mails, ni codes de
récupération ; il ne permet pas de contourner la récupération d'un compte.
Révoquer une session ne bannit pas le joueur : il peut se reconnecter.

Le tableau de bord lit les données réelles via `GET /api/admin/analytics`,
protégé par les mêmes contrôles Authentik. Les seules périodes acceptées sont
7, 30 et 90 jours, aujourd'hui compris. Les agrégats PostgreSQL partagent un
instantané cohérent en lecture seule ; les inscriptions et signalements sont
regroupés par jour UTC, avec les jours sans événement à zéro. La journée en
cours est incomplète, y compris pour la comparaison aux jours précédents.
Le graphique s'explore au pointeur ou au clavier et fournit un tableau exact.

Les statistiques par jeu comptent les **participations de comptes**, pas les
parties uniques : quatre comptes dans une partie donnent quatre participations.
Les invités en sont exclus. Ces totaux sont cumulés ; aucun historique quotidien
de parties n'est inventé. Les comptes ayant joué sont ceux dont la dernière
partie terminée se situe dans la période. Les sessions valides ne sont pas un
indicateur de présence. Les salons sont un instantané en mémoire, avec invités
et spectateurs comptés par salon. L'heure de chargement et l'actualisation
manuelle sont affichées ; une erreur conserve les données précédentes en les
signalant comme telles. Aucun service externe de suivi ni migration de base
n'est ajouté.

La migration additive **8** conserve les données existantes, ajoute le statut
des signalements et le journal. Les sauvegardes PostgreSQL couvrent le journal.
Les binaires antérieurs, y compris la version à codes de récupération, refusent
ce nouveau schéma : un retour arrière exige une version compatible ou une
restauration explicitement préparée. Les sessions administrateur disparaissent
au redémarrage. Le runbook LabOps `apps/workloads/games/README.md` possède l'ordre
de reconstruction et les contrôles réseau ; aucun nouveau secret n'est requis.
Avant déploiement, publier l'image du commit Games fusionné, puis épingler ce
même commit pour le chart et l'image LabOps. Une ancienne image n'implémente pas
le panneau, même si `admin.enabled` est ajouté aux valeurs.

Tests de sécurité : `make test` utilise une base PostgreSQL de développement et
des schémas temporaires. Après `make web`, le parcours navigateur complet avec
un émetteur OIDC signé isolé se lance avec :

```sh
GAMES_ADMIN_BROWSER_CHECK=true make test
```

## Accessibilité et petits écrans

Les fenêtres utilisent `<dialog>` : bouton de fermeture visible, Échap, clic
sur le fond, focus contenu dans la fenêtre puis rendu à son déclencheur. Fermer
les codes de récupération sans les enregistrer demande une confirmation explicite
et ne bloque plus la navigation. Le menu mobile garde la navigation et le compte
accessibles. « Quitter le salon » reste visible lorsque les détails sont repliés,
pendant une partie et en pleine fenêtre. Le code de huit lettres tient dans la
sidebar. Les curseurs de réglage occupent leur propre ligne sur petit écran.

Un lien « Aller au contenu » évite le header au clavier. Les pages et parties
ont un titre principal ; les boutons graphiques ont un nom accessible, les
sélections annoncent leur état et les scores défilants sont accessibles au
clavier. Pour dessiner : flèches pour déplacer le pinceau, Espace ou Entrée pour
commencer/finir un trait, Maj pour accélérer. Tab permet de quitter la feuille.
Avec « Remplir », Espace ou Entrée remplit la zone sous le curseur ; revenir
au crayon permet de reprendre les traits. Annuler et Tout effacer agissent aussi
sur les remplissages, partagés en direct et conservés lors d'une reconnexion.

L'audit Chromium/axe couvre les pages invité/connecté, les modales, les six jeux
et les phases de dessin, de 320 px au PC, avec un format paysage. Il vérifie aussi
le focus, la fermeture, le dessin au clavier et la sortie de salon. À lancer
uniquement contre une instance de développement : il crée des comptes et salons
synthétiques, et écrit les diagnostics sans HTML ni codes de récupération dans
`/tmp/games-accessibility-report.json` (`GAMES_A11Y_REPORT` pour changer le chemin).

```sh
make e2e
make e2e-accessibility
```

Après `make web`, la suite complète construit son propre serveur temporaire
et le redémarre avant chaque scénario et avant l'audit d'accessibilité. Les
quotas de création de salons et de connexion sont conservés :

```sh
GAMES_DATABASE_URL=postgres://games:games@127.0.0.1:5432/games make e2e-check
```

Cette URL est celle d'une base de développement avec des identifiants fictifs ;
ne jamais pointer la suite vers une base de production. `GAMES_E2E_PORT` permet
de remplacer le port local 3789 ; `CHROMIUM` choisit le navigateur installé.
Les scripts navigateur refusent désormais une URL de site hors loopback.
La CI installe la version Chromium associée au verrou Playwright et exécute
les parcours de jeu, l'audit public et le parcours Authentik isolé avant publication.

Ces contrôles automatisés ne remplacent pas une évaluation avec lecteur d'écran
et des appareils réels ; ils ne constituent pas une certification WCAG.

## Dans un salon

- **Discussion** : chacun écrit aux autres, avant et pendant la partie ; le
  salon garde les 40 derniers messages.
- **Trois points à côté d'un joueur** : l'hôte peut le nommer hôte ou le
  retirer ; tout le monde peut masquer ses messages, le signaler, et le bloquer
  s'il a un compte.
- **Réglages** : l'hôte règle le jeu choisi (temps par tour à Ono, vies à
  BoomParty, temps de dessin et tours de table à Skribouille, temps d'écriture
  et de dessin à Gartik Phone, moment où la grille se referme à Bombermat) et
  peut fournir sa propre liste de mots pour Skribouille (12 au moins) et
  Codenoms (25 au moins). Les réglages sont décrits dans `internal/games/game.go`.
- **Salon public** : l'hôte peut ouvrir son salon à tous. « Partie publique »,
  sur l'accueil, liste les salons publics par jeu : on en rejoint un, ou l'on
  en ouvre un. L'hôte règle le nombre de places du salon.
- **Redémarrage du serveur** : les salons sont enregistrés en base et
  reviennent, dans leur salle d'attente, avec leurs joueurs, leur hôte, leurs
  réglages et leurs scores ; les pages s'y reconnectent seules. Une partie en
  cours, elle, est perdue, et il ne faut toujours qu'une instance.

## Modération

Les pseudos, les messages et les listes de mots passent par une courte liste de
mots refusés (`internal/server/filter.go`) : un pseudo qui en contient un est
refusé, un message voit le mot remplacé par des astérisques. Les dessins ne
sont pas filtrés : ils se signalent. Un signalement (insultes, dessin, pseudo,
triche, autre) est enregistré dans la table `reports`, avec les derniers
messages du joueur dans le salon ; le panneau administrateur permet de les
examiner et de consigner une décision, sans sanction automatique. Bloquer un compte met fin à l'amitié, empêche les
invitations dans les deux sens et masque ses messages.

## Crédits, magasin et effets de pseudo

Une partie finie avec un compte rapporte 2 crédits, une victoire 10 de plus
(`store.CreditsPlayed`, `store.CreditsWon`), dans la limite de 150 crédits par
jour (`store.CreditsPerDay`) : au-delà, les parties comptent toujours pour les
objectifs mais ne rapportent plus. Une partie annulée ou finie sur un abandon
ne rapporte rien. Le magasin (`internal/server/shop.go`) met en
vente quatre articles par jour, les mêmes pour tout le monde, tirés du
catalogue d'après le numéro du jour (UTC) : des pièces d'avatar qu'aucun
objectif ne donne, et des effets qui animent le pseudo (vague, rebond, tangage,
néon, arc-en-ciel, or). Un effet acheté se choisit sur la page Magasin et
s'affiche sur l'accueil, le profil, dans le salon, autour de la table d'Ono et
sur l'anneau de BoomParty.

## Amis en ligne et invitations

Tant qu'un compte a une page ouverte, elle relit ses amis toutes les cinq
secondes : c'est ce qui le dit « en ligne » (50 secondes sans nouvelle, il ne
l'est plus). La bande de gauche a un menu « Amis en ligne » : depuis un salon
on y invite un ami, qui reçoit une carte « Rejoindre » pendant deux minutes ;
hors d'un salon on y rejoint celui où un ami se trouve. Présences et
invitations vivent dans la mémoire du serveur, comme les salons.

## API

- `POST /api/register` : `{name, password}`, retourne `user` et les dix `recoveryCodes` une seule fois.
  `/api/login`, `/api/logout` : `{name, password}`.
- `GET /api/me` : le compte connecté, avec son avatar, ses objectifs et sa
  série ; sans session, `{"user": null}` et les objectifs à zéro.
- `POST /api/avatar` `{avatar}` : enregistre l'avatar
  (`couleur.corps.yeux.bouche.barbe.lunettes.coiffe`).
- `GET /api/shop` : les articles du jour (`items`) et tout ce que le magasin
  vend (`catalog`) ; `POST /api/shop/buy` `{item}` en
  achète un ; `POST /api/fx` `{fx}` choisit l'effet du pseudo.
- `POST /api/tables/{code}/invite` `{name}` : invite un ami dans le salon où
  l'on se trouve.
- `GET /api/profile/{pseudo}` : le profil public, et ce qui lie le visiteur
  connecté à ce joueur (`self`, `none`, `sent`, `received`, `friends`).
- `POST /api/account/recovery-codes` `{password}` : renouvelle les dix codes ;
  retourne `user` et `recoveryCodes`. `GET /api/me` ne retourne que le compte et
  `recoveryCodesRemaining`, jamais les codes eux-mêmes.
- `POST /api/account/password` `{old, new}` : change le mot de passe.
- `POST /api/reset` `{name, code, password}` : récupère le compte sans mail.
  Les anciennes routes `/api/forgot`, `/api/confirm` et `/api/account/email*`
  ne sont plus exposées.
- `POST /api/blocks/add` et `/remove` `{name}` ; `POST /api/report`
  `{room, target, reason, text}`.
- `GET /api/rooms` : les salons publics qui attendent des joueurs, avec leur
  hôte, le nombre de joueurs présents, le minimum du jeu et le nombre de places
  (la limite de l'hôte, ou ce que le jeu permet).
- `POST /api/tables` `{game, public}` crée un salon (le jeu est facultatif) ;
  `GET /api/tables/{code}` dit s'il existe.
- `GET /api/ws?code=…` : la connexion à un salon (WebSocket). Le serveur envoie
  l'état complet à chaque changement ; la page envoie `game` (choisir le jeu),
  `start`, `lobby`, `leave`, `act` (une action de jeu), `chat`, `kick`, `host`
  (passer la main), `public`, `opt` (un réglage) et `words` (la liste de mots).
- `GET /api/friends` : amis, invitations reçues et envoyées.
- `POST /api/friends/invite`, `/accept`, `/remove` : `{name}`. `remove` refuse,
  annule ou retire selon le cas.

## Apparence

L'interface suit la direction artistique lab.bingo
(`.agents/skills/labops-art-direction`, avec `frontend-design`) : bleu mer, navy,
une touche de menthe, familles Red Hat, chat à cache-œil.

- **Kit d'interface** : les jetons (couleurs, rayons, hauteurs) et les pièces
  communes sont dans `web/app/ui.css` : boutons (`.btn`), champs et
  étiquettes, pastilles (`.pill`), cartes (`.panel`, `.veil`), lignes de
  joueurs (`.member`), dialogues, discussion. Celles qui ont un comportement
  sont des composants dans `web/components/ui.tsx` (`Dialog`, `Field`, `Bar`,
  `Ic`) et `web/components/Chat.tsx`. La page `/uikit/` les montre toutes, sur
  le papier et sur la mer ; une page ne fait que les placer. Une carte blanche
  posée sur la mer porte la classe `.light` pour rester claire en thème sombre.
- **Bande de gauche** : le logo, Jouer, Amis, le profil, le chat, puis le compte
  et la langue à son pied. Dans un salon la navigation reste, réduite à ses
  pictogrammes sur une ligne, et la bande affiche dessous le code du salon (un
  clic copie le lien d'invitation), puis, une fois la partie lancée, les
  joueurs et la discussion, qui prend la place qu'il reste ; « Quitter le
  salon » est au pied. Il n'y a pas d'en-tête.
- **Retour au salon** : quitter un salon, ou s'en éloigner en ouvrant une
  autre page, laisse dans la bande une tuile avec le code du salon et un bouton
  « Y retourner », sur toutes les pages, tant que le salon existe (un salon
  vide vit dix minutes). Sa croix l'écarte.
- **Invitations** : une invitation dans un salon ou une demande en ami
  s'ouvre en fenêtre au milieu de l'écran (dans un salon, pour ne pas couper la
  partie, c'est une carte en bas à droite). La page relit ses amis toutes les
  cinq secondes : une demande acceptée de l'autre côté apparaît sur la page
  Amis sans la recharger, et un message le dit.
- **Partie publique** : le bouton de l'accueil ouvre la liste des salons
  publics, rangés par jeu et relue toutes les trois secondes : pour chaque
  jeu, combien de joueurs attendent ; pour chaque salon, son hôte, combien y
  sont sur combien de places, et s'il manque du monde pour lancer. On en
  rejoint un, ou l'on ouvre un salon public sur le jeu de son choix en
  attendant que d'autres arrivent. Dans la salle d'attente, l'hôte règle les
  places du salon, d'un moins et d'un plus : au-delà, le salon est complet et n'est plus
  listé.
- **Bombermat** : le pion de chaque joueur est son avatar, posé sur un socle à
  sa couleur, qui penche du côté où il va et marche ; des bombes qui battent de
  plus en plus vite, des flammes en croix, des caisses qui volent en éclats,
  des bonus qui sortent des caisses et dont le nom s'envole quand on les
  ramasse. Huit bonus, comme dans Bomberman : bombe, feu, patins, coup de
  pied, bombes perçantes, gilet, plein feu, et la tête de mort qui ralentit.
  Quatre arènes sont tirées au sort à chaque nouvelle partie : Classique
  (cale du navire), Carrefour (port), Bastions (forteresse) et Anneaux (atoll).
  Les murs changent selon l'arène ; caisses et bonus sont régénérés en symétrie
  et les quatre coins gardent le même refuge de départ. Chaque arène a ses
  décors et son atlas locaux dans `web/public/games/bombermat/`. Les sources
  et prompts sont conservés dans `art/bombermat/` ; `bash art/build-bombermat.sh`
  prépare les WebP sans régénérer les illustrations.
- **Administration** : navigation dédiée, bilan des participations sur fond
  bleu, graphique des inscriptions ou signalements, classement des jeux,
  salons et modération. Les listes de joueurs, signalements et actions gardent
  leurs contrôles de sécurité. Les deux thèmes et le menu mobile couvrent
  aussi cette interface.
- **Pictogrammes** : un seul jeu, dessiné pour l'application
  (`web/lib/icons.tsx`, composant `Ic`) : grille de 24, trait aux bouts ronds
  de la couleur du texte, aplat pâle pour le volume. Leur dessin est celui que
  tout le monde connaît déjà (un avion en papier envoie, un plus crée, une
  loupe cherche, une flèche entre ou sort) : le thème marin reste aux
  illustrations et au décor. Ils accompagnent toujours un mot, ou leur bouton
  porte un nom. La page `/uikit/` les montre tous.
- **Arrêter la partie** se confirme dans une fenêtre au milieu de l'écran :
  la partie ne compterait pour personne.
- **Sons** : de petites notes fabriquées par le navigateur (`web/lib/sound.ts`,
  aucun fichier chargé) disent ce qui vient de se passer : c'est à vous, un
  message, un joueur qui arrive, une carte posée ou piochée, une bombe, une
  explosion, un bonus, la fin de la partie. « Son », au pied de la bande, les
  coupe ; le choix est gardé sur l'appareil.
- **Salle d'attente** : à droite du jeu choisi, l'équipage en vignettes (quatre
  par rangée, jusqu'à douze ; toucher une vignette ouvre ce qu'on peut faire du
  joueur), le lien d'invitation, les réglages de l'hôte sur une ligne (salon
  public, places), puis la discussion.
- **Profil** : sur le papier, le jeu préféré, la part de victoires et les
  objectifs accomplis ; la colonne de papier suit la page pendant que le
  panneau défile, comme sur Objectifs et Magasin.
- **Discussion** : les messages d'un même joueur se regroupent sous son avatar
  et son nom, avec l'heure ; les vôtres sont en blanc, à droite. Le champ et
  son bouton ne font qu'un. Si l'on relit plus haut, les nouveaux messages ne
  déplacent rien : une pastille les annonce.
- **Magasin** : sur le papier, la bourse (crédits, jauge du jour), comment
  gagner des crédits et l'effet du pseudo ; sur la mer, les quatre articles du
  jour sur leur présentoir avec le compte à rebours, puis toute la collection,
  pour voir ce qui est à soi et ce qui reviendra un autre jour.
- **Choix du jeu** : dans la salle d'attente, l'hôte décide qui choisit, « Je
  choisis » ou « Au vote ». Tout le monde peut donner sa voix à un jeu (un
  second clic la reprend) ; les voix s'affichent sur les tuiles. Au vote, le jeu
  qui en a le plus est choisi, et une égalité garde le jeu déjà choisi. Quand
  l'hôte choisit, les voix lui disent ce que les autres préfèrent.
- **Ono, le tour** : le joueur dont c'est le tour grandit, un anneau de menthe
  se vide autour de lui avec son temps, les autres s'effacent ;
  « À vous ! » s'annonce en grand et votre main
  s'éclaire. Au début, les cartes se distribuent une à une depuis la pioche,
  puis la première carte du tas se retourne.
- **Ono** : la main est en éventail au bord de la table ; une carte posée
  part de son joueur, se retourne en vol et reste de travers sur le tas ; une
  carte spéciale s'annonce en grand au milieu (« +2 », « passe », le sens qui
  tourne) et celui qui pioche encaisse. Une pioche produit une seule animation
  d'entrée dans sa propre main ; le dos en vol est réservé aux autres joueurs.
  « Ono ! » s'annonce uniquement lorsqu'il reste exactement une carte, après
  avoir joué l'avant-dernière : l'annonce reste possible hors de son tour.
  La flèche tourne dans le sens qu'elle indique, y compris après une inversion.
- **Codenoms** : les mots connus des donneurs d'indices ont des fonds colorés
  francs, accompagnés de formes ; les joueurs qui devinent ne voient aucune
  couleur secrète. Les deux équipes ont une bande de couleur, leur nom et leur
  état. Un indice accepte de 1 à 24 caractères : une lettre seule est valide,
  les accents et apostrophes typographiques sont normalisés, les mots de la
  grille restent interdits. Un nouvel indice apparaît en grand, animé pendant
  trois secondes, avec une courte sonnerie ; l'annonce ne prend ni focus ni
  clics et disparaît automatiquement. L'indice reste sur la grille et
  « Revoir l'indice » rejoue l'annonce. Le passage du tour annonce la nouvelle
  équipe. Seul l'hôte commence la grille.
- **Manches et résultats** : une annonce visible, masquable et sonore marque
  les nouvelles parties, les dessins de Skribouille et les manches de Gartik.
  Le résultat de Skribouille indique le mot, les points gagnés et le temps avant
  le prochain dessin. Le résultat final passe devant la scène : « Victoire »
  en grand et en vert ou « Défaite » en rouge, avec les
  pseudos gagnants dessous, conservés même après leur départ. Les parties nulles,
  interrompues et Gartik (sans gagnant) gardent un message neutre. La scène derrière
  le résultat ne reçoit plus le focus ni les clics. Chacun peut retrouver le vote
  avec « Retour au salon », sans quitter le salon.
  Le son suit le réglage existant et les animations respectent la réduction
  des mouvements. Maintenir Espace ou le bouton tactile Bombermat pose les
  bombes disponibles en continu ; le serveur conserve les règles et les limites.
- **Accueil** : « On joue ? », le nom, un gros bouton « Créer un salon », le
  champ pour rejoindre avec un code ; à côté, les jeux sur un panneau bleu,
  où l'on choisit le premier jeu du salon (cerclé de menthe) : un clic sur un
  jeu ne crée rien, c'est le bouton qui ouvre le salon.
  Le panneau va jusqu'au bord de la fenêtre : sur un grand écran, trois jeux
  par rangée, chacun avec son dessin en grand et son résumé ; une rose des
  vents en filigrane dans le coin. Tout tient dans la fenêtre.
- **Salon** : un seul panneau bleu, qui ne change pas de page. Avant la partie
  c'est une salle d'attente : le jeu choisi en grand sur une carte blanche
  (résumé, règles, « Lancer la partie » et, s'il ne peut pas l'être, pourquoi) ;
  à côté, qui est là, les places qu'il reste à remplir et le lien d'invitation ;
  en bas, un bandeau de petites tuiles pour changer de jeu (cerclée de menthe :
  le jeu choisi). Pendant la partie, la scène du jeu, à la taille de la
  fenêtre, sans défilement. À la fin, une carte par-dessus la scène annonce le
  gagnant et propose « Rejouer » ou « Changer de jeu ».
- **Mouvements** : à l'arrivée sur l'accueil, les jeux se posent l'un après
  l'autre. Une illustration se dandine sous le pointeur et se pose quand son
  jeu est choisi dans le salon ; un joueur qui entre glisse dans la liste ; « Lancer la partie »
  s'annonce quand il devient possible. Rien ne bouge sous
  `prefers-reduced-motion`.
- **En jeu** : une ligne en tête dit ce qui se passe ; elle passe en blanc
  cerclé de menthe, avec une courte consigne, quand c'est au joueur d'agir. Les
  règles s'ouvrent d'un bouton, « Pleine fenêtre » ne garde que la scène (Échap
  en sort). Chaque jeu a ses couleurs, qui ne servent que sur sa scène, et
  jamais sans une forme ou un mot.
- **Un profil** : le joueur et ce qu'on peut faire sur le papier ; sur le panneau
  bleu, son initiale, ses deux totaux et une ligne par jeu.
- **Amis** : un registre, des lignes séparées par un filet.

Le logo (le chat au-dessus d'une main de cartes) est de la même série que celui
de slots ; l'image source est dans `art/brand/src`. Chaque jeu a une
illustration cartoon (contour navy épais, personnage aux gros yeux, liseré
blanc d'autocollant, fond transparent), générée puis préparée par
`art/build.py` : sources dans `art/games/src`, une par identifiant de jeu,
servies depuis `web/public/games` en deux tailles. Elle présente le jeu partout
hors des scènes ; les dessins blancs de `web/lib/art.tsx` restent les pièces de
jeu (la bombe de BoomParty, celles de Bombermat). Thèmes clair et sombre.

## Organisation

- `cmd/games` : le serveur
- `internal/games` : les règles des jeux, le dictionnaire, et le format des
  dessins (`sketch.go` : des traits, envoyés par petits paquets)
- `internal/room` : les salons, en mémoire
- `internal/server` : API, sessions, WebSocket, fichiers statiques
- `internal/store` : PostgreSQL (comptes, sessions, amis, statistiques)
- `chart` : le chart Helm
- `art` : l'image source du logo et le script qui le décline
- `web/e2e` : les scénarios de bout en bout (`make e2e`, contre un serveur qui
  tourne) : inscription, retour au salon, discussion, amis et invitations,
  partie publique, un tour d'Ono, un déplacement et une bombe à Bombermat, la
  largeur sur téléphone. Ils pilotent Chromium avec `playwright-core`
  (`CHROMIUM=/chemin` si aucun n'est installé au chemin habituel).
- `web/app` : pages et feuilles de style (`ui.css` : les jetons et le kit ;
  `globals.css` : le cadre et les pages ; `stages.css` : les scènes)
- `web/components` : cadre, accueil, salon (`Table.tsx`), profil, amis, mascotte
- `web/stages` : la scène de chaque jeu, et la feuille de dessin (`Pad.tsx`)
- `web/lib/table.ts` : la connexion à un salon
- `web/lib/i18n.ts` : la langue, et la traduction des messages du serveur
- `web/games/catalog.ts` : les jeux
- `web/lib/app.ts` : état de l'interface et appels à l'API
- `web/lib/art.tsx` : les dessins des jeux
- `.agents/skills` : les skills du projet (`.claude/skills` y renvoie)
