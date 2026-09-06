# FSTD Logbook

Registre des séances simulateur : authentification par instructeur, ouverture
de séance avec chrono, clôture avec signature électronique et remarques,
archivage PDF (par séance ou registre complet) envoyable par email.
Fonctionne hors connexion (PWA installable, ex. sur iPad).

## Comptes

Pour l'instant, un **compte unique et partagé** est utilisé par tous les TRI/TRE
(pas d'auto-inscription : la création de compte est désactivée côté serveur).

Deux comptes sont créés **automatiquement au tout premier démarrage** du serveur
— un principal et un de secours (même registre partagé pour les deux, au cas où
le mot de passe principal poserait problème) :

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Principal | `instructeurs` | `FSTD-Simu-2026!` |
| Secours | `instructeurs-secours` | `FSTD-Reserve-2026!` |

Ces valeurs par défaut sont dans `server/index.js`. Pour les changer, définir les
variables d'environnement `SEED_USER_NAME`/`SEED_USER_PASSWORD` (compte principal)
et `SEED_BACKUP_USER_NAME`/`SEED_BACKUP_USER_PASSWORD` (compte de secours) avant
le tout premier démarrage, ou réinitialiser un mot de passe à tout moment :

```bash
node server/seed-user.js "<identifiant>" "<mot de passe>"
```

Si on décide plus tard d'un compte par instructeur, il suffira de réactiver la
route `/api/auth/register` (désactivée dans `server/index.js`) ou de lancer la
commande ci-dessus une fois par instructeur avec un identifiant différent.

## Cycle d'une séance

1. **Connexion** — avec l'identifiant et le mot de passe du compte du registre.
2. **Démarrer une séance** — on saisit date, créneau, heure de début, TRI/CDB/FO,
   type de training (`QT`/`REC`) et type de séance (`FFS`/`FBS`). Un chrono démarre.
   (Comme le compte est partagé, le nom du TRI doit être saisi manuellement à
   chaque séance — il n'est pas déduit automatiquement de la connexion.)
3. **Clôturer la séance** — l'instructeur renseigne l'heure de fin, des remarques,
   confirme le mot de passe et **signe électroniquement** (au doigt/stylet sur l'écran).
   La séance passe au statut « Clôturée » et devient archivée dans le registre.
4. **Archivage** — depuis le registre, on peut télécharger le PDF d'une séance,
   ou exporter le registre complet (ou filtré par période) en PDF. L'envoi par
   email est prêt côté code mais désactivé pour l'instant (voir plus bas) :
   on télécharge et on envoie le PDF manuellement.

## Fonctionnement hors-ligne

Une fois connecté(e), l'application reste utilisable sans réseau (utile en
déplacement / à l'étranger) :
- Les séances sont créées et clôturées localement (IndexedDB) puis synchronisées
  automatiquement avec le serveur dès que la connexion revient.
- Un bandeau en haut de l'écran indique l'état (hors-ligne / synchronisation en cours).
- Le PDF et l'envoi par email nécessitent une connexion (ils sont générés côté serveur).
- Sur iPad : ouvrir l'app dans Safari puis "Partager → Sur l'écran d'accueil" pour
  l'installer comme une vraie application (PWA).

## Démarrer l'application

```bash
npm install
npm start
```

Le compte partagé est créé automatiquement au premier démarrage (voir section
"Comptes" ci-dessus). Ouvrir ensuite http://localhost:3000

## Déploiement en ligne (pour tester / partager un lien, ex. sur Render)

Sur [render.com](https://render.com) : "New" → "Web Service" → connecter le
repo GitHub → choisir la branche → Render détecte Node automatiquement
(`npm install` / `npm start`) → plan "Free" → "Create Web Service". Après
quelques minutes, Render fournit une URL publique en HTTPS
(ex. `https://fstd-logbook.onrender.com`), installable sur écran d'accueil
comme n'importe quelle PWA.

⚠️ Le plan gratuit de Render met le service en veille après 15 min d'inactivité
(le premier chargement après une veille prend ~1 minute) et **son disque n'est
pas persistant** : les séances enregistrées peuvent être perdues à chaque
redéploiement ou redémarrage. Très bien pour tester/démontrer l'appli ; pour un
usage réel avec des séances à conserver dans la durée, prévoir un disque
persistant (plan payant Render, ou un autre hébergeur avec volume persistant).

### Envoi d'email (optionnel, désactivé pour l'instant)

Le téléchargement manuel du PDF est utilisé pour le moment. Pour activer plus
tard le bouton "Envoyer par email", configurer un compte SMTP via variables
d'environnement avant de lancer le serveur :

```bash
export SMTP_HOST=smtp.exemple.com
export SMTP_PORT=587
export SMTP_USER=xxx
export SMTP_PASS=xxx
export SMTP_FROM=registre@compagnie.com
npm start
```

Sans configuration, le téléchargement PDF reste disponible ; seul l'envoi
automatique par email est désactivé (message explicite affiché dans l'app).

### Sécurité des jetons de connexion

Définir `AUTH_SECRET` (chaîne aléatoire longue) en production :

```bash
export AUTH_SECRET="une-longue-chaine-secrete-aleatoire"
```

## Notes techniques

- Backend Node/Express, données persistées dans `server/data/*.json`
  (registre partagé entre tous les utilisateurs qui accèdent au serveur).
- Authentification par identifiant + mot de passe (jeton signé, valable 30 jours),
  comptes créés uniquement via `server/seed-user.js` (auto-inscription désactivée).
- PDF généré côté serveur avec `pdfkit`, email avec `nodemailer`.
- Frontend en HTML/CSS/JS natif (ES modules), sans étape de build.
- PWA : `manifest.json` + `sw.js` (cache de l'app pour usage hors-ligne),
  icônes générées via `node scripts/generate-icons.js`.
- Stockage local : IndexedDB (`public/db.js`) avec file d'attente de
  synchronisation pour les actions effectuées hors connexion.

## Prochaines évolutions possibles

- Rôles/permissions (ex. seul l'ouvreur ou un administrateur peut supprimer une séance).
- Export CSV en plus du PDF.
- Historique des modifications / audit trail plus détaillé.
