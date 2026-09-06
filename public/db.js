// Couche de stockage local (IndexedDB) : source de vérité pour l'UI, avec une
// file d'attente ("outbox") d'actions à rejouer vers le serveur dès que la
// connexion revient. Permet de créer/clôturer des séances hors-ligne.

const DB_NAME = 'fstd-logbook';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'localId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function tx(storeName, mode) {
  return getDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllSessions() {
  const store = await tx('sessions', 'readonly');
  return reqToPromise(store.getAll());
}

export async function putSession(session) {
  const store = await tx('sessions', 'readwrite');
  return reqToPromise(store.put(session));
}

export async function putSessions(sessions) {
  const store = await tx('sessions', 'readwrite');
  await Promise.all(sessions.map((s) => reqToPromise(store.put(s))));
}

export async function deleteSessionLocal(id) {
  const store = await tx('sessions', 'readwrite');
  return reqToPromise(store.delete(id));
}

export async function getOutbox() {
  const store = await tx('outbox', 'readonly');
  const all = await reqToPromise(store.getAll());
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function queueAction(action) {
  const store = await tx('outbox', 'readwrite');
  const entry = {
    localId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...action,
  };
  await reqToPromise(store.put(entry));
  return entry;
}

export async function removeAction(localId) {
  const store = await tx('outbox', 'readwrite');
  return reqToPromise(store.delete(localId));
}

export async function hasPendingFor(sessionId) {
  const outbox = await getOutbox();
  return outbox.some((a) => a.targetId === sessionId);
}
