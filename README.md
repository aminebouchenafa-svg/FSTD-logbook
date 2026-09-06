# FSTD Logbook

Registre des séances simulateur : authentification par instructeur, ouverture
de séance avec chrono, clôture avec signature électronique et remarques,
archivage PDF (par séance ou registre complet) envoyable par email.
Fonctionne hors connexion (PWA installable, ex. sur iPad).

## Cycle d'une séance

1. **Connexion** — chaque personne (TRI) crée un compte (nom + code PIN) ou se connecte.
2. **Démarrer une séance** — on saisit date, créneau, heure de début, TRI/CDB/FO,
   type de training (`QT`/`REC`) et type de séance (`FFS`/`FBS`). Un chrono démarre.
3. **Clôturer la séance** — l'instructeur renseigne l'heure de fin, des remarques,
   confirme son code PIN et **signe électroniquement** (au doigt/stylet sur l'écran).
   La séance passe au statut « Clôturée » et devient archivée dans le registre.
4. **Archivage** — depuis le registre, on peut télécharger le PDF d'une séance,
   exporter le registre complet (ou filtré par période) en PDF, ou l'envoyer par email.

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

Puis ouvrir http://localhost:3000

### Envoi d'email (optionnel)

Pour activer le bouton "Envoyer par email", configurer un compte SMTP via variables
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
- Authentification par nom + code PIN (jeton signé, valable 30 jours).
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
