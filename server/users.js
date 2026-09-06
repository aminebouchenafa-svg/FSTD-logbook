const fs = require('fs');
const path = require('path');
const auth = require('./auth');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readAll() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(users) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function findByName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return readAll().find((u) => u.name.toLowerCase() === normalized) || null;
}

function findById(id) {
  return readAll().find((u) => u.id === id) || null;
}

function register(name, pin) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Le nom est obligatoire.');
  if (!pin || String(pin).length < 4) throw new Error('Le code PIN doit contenir au moins 4 chiffres.');
  if (findByName(trimmed)) throw new Error('Ce nom est déjà utilisé, connectez-vous ou choisissez un autre nom.');

  const { salt, hash } = auth.hashPin(pin);
  const user = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: trimmed,
    salt,
    hash,
    createdAt: new Date().toISOString(),
  };
  const users = readAll();
  users.push(user);
  writeAll(users);
  return user;
}

function verifyLogin(name, pin) {
  const user = findByName(name);
  if (!user) return null;
  if (!auth.verifyPin(pin, user.salt, user.hash)) return null;
  return user;
}

// Réservé à l'administration en ligne de commande (server/seed-user.js) : crée le
// compte s'il n'existe pas, ou réinitialise son mot de passe s'il existe déjà.
// N'est jamais exposé via l'API HTTP.
function upsertForSeed(name, pin) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Le nom est obligatoire.');
  if (!pin || String(pin).length < 6) throw new Error('Le mot de passe doit contenir au moins 6 caractères.');

  const { salt, hash } = auth.hashPin(pin);
  const users = readAll();
  const existing = users.find((u) => u.name.toLowerCase() === trimmed.toLowerCase());

  if (existing) {
    existing.salt = salt;
    existing.hash = hash;
    writeAll(users);
    return { user: existing, created: false };
  }

  const user = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: trimmed,
    salt,
    hash,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeAll(users);
  return { user, created: true };
}

module.exports = { register, verifyLogin, findById, findByName, upsertForSeed };
