const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  }
}

function readAll() {
  ensureStore();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(sessions) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

function listSessions() {
  return readAll().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (a.heureDebut || '').localeCompare(b.heureDebut || '');
  });
}

function createSession(data) {
  const sessions = readAll();
  const session = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    ...data,
  };
  sessions.push(session);
  writeAll(sessions);
  return session;
}

function updateSession(id, data) {
  const sessions = readAll();
  const index = sessions.findIndex((s) => s.id === id);
  if (index === -1) return null;
  sessions[index] = { ...sessions[index], ...data, id };
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

module.exports = { listSessions, createSession, updateSession, deleteSession };
