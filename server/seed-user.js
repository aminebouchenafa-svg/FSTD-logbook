// Crée ou réinitialise un compte de connexion (outil d'administration en ligne de
// commande, jamais exposé via l'API HTTP). Usage :
//   node server/seed-user.js "<identifiant>" "<mot de passe>"
const users = require('./users');

const [, , name, pin] = process.argv;

if (!name || !pin) {
  console.error('Usage : node server/seed-user.js "<identifiant>" "<mot de passe>"');
  process.exit(1);
}

try {
  const { user, created } = users.upsertForSeed(name, pin);
  console.log(created ? 'Compte créé :' : 'Mot de passe mis à jour pour :', user.name);
} catch (err) {
  console.error('Erreur :', err.message);
  process.exit(1);
}
