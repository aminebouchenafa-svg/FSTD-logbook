const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');
const COUNTER_FILE = path.join(DATA_DIR, 'counter.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  if (!fs.existsSync(COUNTER_FILE)) fs.writeFileSync(COUNTER_FILE, JSON.stringify({ next: 1 }), 'utf8');
}

function readAll() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(sessions) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

function nextNumero() {
  ensureStore();
  const counter = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
  const numero = counter.next;
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ next: numero + 1 }), 'utf8');
  return numero;
}

function listSessions() {
  return readAll().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.heureDebut || '').localeCompare(a.heureDebut || '');
  });
}

function getSession(id) {
  return readAll().find((s) => s.id === id) || null;
}

function createSession(data, user) {
  const sessions = readAll();

  // Autorise un id fourni par le client (créé hors-ligne) pour éviter les doublons à la resynchronisation.
  const id = data.id && !sessions.some((s) => s.id === data.id)
    ? data.id
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const session = {
    id,
    numero: nextNumero(),
    date: data.date,
    creneau: data.creneau,
    heureDebut: data.heureDebut,
    heureFin: null,
    nomTri: data.nomTri,
    nomCdb: data.nomCdb || '',
    nomCdb2: data.nomCdb2 || '',
    nomFo: data.nomFo || '',
    nomFo2: data.nomFo2 || '',
    matriculeTri: data.matriculeTri || '',
    matriculeCdb: data.matriculeCdb || '',
    matriculeCdb2: data.matriculeCdb2 || '',
    matriculeFo: data.matriculeFo || '',
    matriculeFo2: data.matriculeFo2 || '',
    typeTraining: data.typeTraining,
    typeSeance: data.typeSeance,
    status: 'ouverte',
    remarques: '',
    signature: null,
    openedBy: user.id,
    openedByName: user.name,
    closedBy: null,
    closedByName: null,
    createdAt: new Date().toISOString(),
    closedAt: null,
  };
  sessions.push(session);
  writeAll(sessions);
  return session;
}

function updateSession(id, data) {
  const sessions = readAll();
  const index = sessions.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const editable = (({
    date, creneau, heureDebut, nomTri, nomCdb, nomCdb2, nomFo, nomFo2,
    matriculeTri, matriculeCdb, matriculeCdb2, matriculeFo, matriculeFo2,
    typeTraining, typeSeance,
  }) => ({
    date, creneau, heureDebut, nomTri, nomCdb, nomCdb2, nomFo, nomFo2,
    matriculeTri, matriculeCdb, matriculeCdb2, matriculeFo, matriculeFo2,
    typeTraining, typeSeance,
  }))(data);
  Object.keys(editable).forEach((k) => editable[k] === undefined && delete editable[k]);
  sessions[index] = { ...sessions[index], ...editable };
  writeAll(sessions);
  return sessions[index];
}

function closeSession(id, { heureFin, remarques, signature }, user) {
  const sessions = readAll();
  const index = sessions.findIndex((s) => s.id === id);
  if (index === -1) return null;
  sessions[index] = {
    ...sessions[index],
    heureFin,
    remarques: remarques || '',
    signature: signature || null,
    status: 'cloturee',
    closedBy: user.id,
    closedByName: user.name,
    closedAt: new Date().toISOString(),
  };
  writeAll(sessions);
  return sessions[index];
}

function deleteSession(id) {
  const sessions = readAll();
  const index = sessions.findIndex((s) => s.id === id);
  if (index === -1) return false;
  sessions.splice(index, 1);
  writeAll(sessions);
  return true;
}

module.exports = {
  listSessions,
  getSession,
  createSession,
  updateSession,
  closeSession,
  deleteSession,
};
