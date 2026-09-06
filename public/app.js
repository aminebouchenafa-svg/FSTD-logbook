import * as db from './db.js';

const AUTH_KEY = 'fstd_auth';

let auth = null; // { token, user: {id, name}, pinVerifier }
let sessions = [];
let outbox = [];
let closingSessionId = null;
let hasSignature = false;
let drawing = false;

// ---------- Utilitaires ----------

function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowHm(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function sha256Hex(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Repli si contexte non sécurisé (pas de Web Crypto) : simple hash non cryptographique.
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    }
    return `fallback-${h}`;
  }
}

function badgeClass(type) {
  return (
    {
      QT: 'badge-qt',
      REC: 'badge-rec',
      FFS: 'badge-ffs',
      FBS: 'badge-fbs',
      ouverte: 'badge-ouverte',
      cloturee: 'badge-cloturee',
    }[type] || ''
  );
}

// ---------- Auth ----------

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveAuth(value) {
  auth = value;
  localStorage.setItem(AUTH_KEY, JSON.stringify(value));
}

function clearAuth() {
  auth = null;
  localStorage.removeItem(AUTH_KEY);
}

async function apiFetch(path, options = {}, token = auth?.token) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  return res;
}

// ---------- Écrans ----------

function showAuthScreen() {
  document.getElementById('auth-screen').hidden = false;
  document.getElementById('app-screen').hidden = true;
}

function showAppScreen() {
  document.getElementById('auth-screen').hidden = true;
  document.getElementById('app-screen').hidden = false;
  document.getElementById('user-badge').textContent = `Connecté(e) en tant que ${auth.user.name}`;
}

// ---------- Synchronisation ----------

function updateSyncUi() {
  const statusEl = document.getElementById('sync-status');
  const bannerEl = document.getElementById('sync-banner');
  const online = navigator.onLine;

  statusEl.classList.toggle('offline', !online);
  statusEl.title = online ? 'En ligne' : 'Hors connexion';

  if (!online) {
    bannerEl.hidden = false;
    bannerEl.textContent = 'Hors connexion — les séances sont enregistrées sur cet appareil et seront synchronisées automatiquement dès le retour du réseau.';
  } else if (outbox.length > 0) {
    bannerEl.hidden = false;
    bannerEl.textContent = `Synchronisation en cours… (${outbox.length} élément(s) en attente)`;
  } else {
    bannerEl.hidden = true;
  }
}

async function refreshOutbox() {
  outbox = await db.getOutbox();
}

async function pullFromServer() {
  if (!navigator.onLine || !auth) return;
  try {
    const res = await apiFetch('/api/sessions');
    if (!res.ok) return;
    const serverSessions = await res.json();
    await refreshOutbox();
    const pendingIds = new Set(outbox.map((a) => a.targetId));
    await db.putSessions(serverSessions.filter((s) => !pendingIds.has(s.id)));
  } catch {
    // Réseau indisponible malgré navigator.onLine : on continue en local.
  }
}

async function pushOutbox() {
  if (!navigator.onLine) return;
  await refreshOutbox();

  for (const action of outbox) {
    try {
      let res;
      if (action.type === 'create') {
        res = await apiFetch('/api/sessions', { method: 'POST', body: JSON.stringify(action.payload) }, action.token);
      } else if (action.type === 'update') {
        res = await apiFetch(`/api/sessions/${action.targetId}`, { method: 'PUT', body: JSON.stringify(action.payload) }, action.token);
      } else if (action.type === 'close') {
        res = await apiFetch(`/api/sessions/${action.targetId}/close`, { method: 'POST', body: JSON.stringify(action.payload) }, action.token);
      }

      if (!res) continue;

      if (res.status === 401) {
        break; // jeton expiré : on garde la file, l'utilisateur devra se reconnecter
      }

      if (!res.ok) {
        // Donnée rejetée par le serveur : on l'abandonne pour ne pas bloquer la file indéfiniment.
        console.error('Action de synchronisation rejetée', action, await res.json().catch(() => null));
        await db.removeAction(action.localId);
        continue;
      }

      const updated = await res.json();
      await db.putSession(updated);
      await db.removeAction(action.localId);
    } catch {
      break; // panne réseau : on réessaiera plus tard
    }
  }

  await refreshOutbox();
}

async function syncAndRender() {
  await pullFromServer();
  await pushOutbox();
  await renderAll();
}

// ---------- Rendu ----------

async function renderAll() {
  sessions = await db.getAllSessions();
  await refreshOutbox();
  const pendingIds = new Set(outbox.map((a) => a.targetId));

  sessions.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.heureDebut || '').localeCompare(a.heureDebut || '');
  });

  renderOpenSessions(pendingIds);
  renderTable(pendingIds);
  updateSyncUi();
}

function renderOpenSessions(pendingIds) {
  const container = document.getElementById('open-sessions');
  const open = sessions.filter((s) => s.status === 'ouverte');

  if (open.length === 0) {
    container.innerHTML = '<p class="empty">Aucune séance en cours.</p>';
    return;
  }

  container.innerHTML = open
    .map(
      (s) => `
    <div class="open-session-card" data-id="${s.id}">
      <div class="chrono" data-start="${s.date}T${s.heureDebut}:00">00:00:00</div>
      <div><strong>${formatDate(s.date)} — ${s.creneau}</strong></div>
      <div class="crew">
        TRI ${escapeHtml(s.nomTri)} · CDB ${escapeHtml(s.nomCdb)} · FO ${escapeHtml(s.nomFo)}
      </div>
      <div class="badges">
        <span class="badge ${badgeClass(s.typeTraining)}">${s.typeTraining}</span>
        <span class="badge ${badgeClass(s.typeSeance)}">${s.typeSeance}</span>
        ${pendingIds.has(s.id) ? '<span class="badge badge-pending">en attente de sync</span>' : ''}
      </div>
      <button type="button" data-action="close-session" data-id="${s.id}">Clôturer</button>
    </div>`
    )
    .join('');
}

function tickChronos() {
  document.querySelectorAll('.chrono').forEach((el) => {
    const start = new Date(el.dataset.start);
    let elapsed = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  });
}

function renderTable(pendingIds) {
  const query = document.getElementById('search').value.trim().toLowerCase();
  const filtered = query
    ? sessions.filter((s) =>
        [s.nomTri, s.nomCdb, s.nomFo, s.date, s.creneau, s.typeTraining, s.typeSeance]
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
    : sessions;

  const body = document.getElementById('sessions-body');

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="12" class="empty">Aucune séance enregistrée.</td></tr>';
    return;
  }

  body.innerHTML = filtered
    .map((s) => {
      const pending = pendingIds.has(s.id);
      return `
    <tr data-id="${s.id}">
      <td>${s.numero ?? '—'}</td>
      <td>${formatDate(s.date)}</td>
      <td>${s.creneau}</td>
      <td>${s.heureDebut}</td>
      <td>${s.heureFin || '—'}</td>
      <td>${escapeHtml(s.nomTri)}</td>
      <td>${escapeHtml(s.nomCdb)}</td>
      <td>${escapeHtml(s.nomFo)}</td>
      <td><span class="badge ${badgeClass(s.typeTraining)}">${s.typeTraining}</span></td>
      <td><span class="badge ${badgeClass(s.typeSeance)}">${s.typeSeance}</span></td>
      <td>
        <span class="badge ${badgeClass(s.status)}">${s.status === 'cloturee' ? 'Clôturée' : 'Ouverte'}</span>
        ${pending ? '<span class="badge badge-pending">sync…</span>' : ''}
      </td>
      <td>
        <div class="row-actions">
          <button class="pdf-btn" data-action="pdf" data-id="${s.id}" ${pending ? 'disabled title="Disponible après synchronisation"' : ''}>PDF</button>
          <button class="delete-btn" data-action="delete" data-id="${s.id}">Suppr.</button>
        </div>
      </td>
    </tr>`;
    })
    .join('');
}

// ---------- Modale : démarrer une séance ----------

function openOpenModal() {
  document.getElementById('open-date').value = todayIso();
  document.getElementById('open-creneau').value = '';
  document.getElementById('open-heureDebut').value = nowHm();
  document.getElementById('open-nomTri').value = '';
  document.getElementById('open-nomCdb').value = '';
  document.getElementById('open-nomFo').value = '';
  document.getElementById('open-typeTraining').value = '';
  document.getElementById('open-typeSeance').value = '';
  document.getElementById('open-error').textContent = '';
  document.getElementById('open-modal').hidden = false;
}

async function handleOpenSubmit(e) {
  e.preventDefault();
  const payload = {
    id: uuid(),
    date: document.getElementById('open-date').value,
    creneau: document.getElementById('open-creneau').value,
    heureDebut: document.getElementById('open-heureDebut').value,
    nomTri: document.getElementById('open-nomTri').value.trim(),
    nomCdb: document.getElementById('open-nomCdb').value.trim(),
    nomFo: document.getElementById('open-nomFo').value.trim(),
    typeTraining: document.getElementById('open-typeTraining').value,
    typeSeance: document.getElementById('open-typeSeance').value,
  };

  const missing = Object.entries(payload).filter(([k, v]) => k !== 'id' && !v);
  if (missing.length > 0) {
    document.getElementById('open-error').textContent = 'Merci de remplir tous les champs.';
    return;
  }

  const localSession = {
    ...payload,
    numero: null,
    heureFin: null,
    status: 'ouverte',
    remarques: '',
    signature: null,
    openedByName: auth.user.name,
    closedByName: null,
    createdAt: new Date().toISOString(),
  };

  await db.putSession(localSession);
  await db.queueAction({ type: 'create', targetId: payload.id, payload, token: auth.token });
  document.getElementById('open-modal').hidden = true;
  await syncAndRender();
}

// ---------- Modale : clôturer une séance ----------

function setupSignaturePad() {
  const canvas = document.getElementById('signature-pad');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#101828';

  function posFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    hasSignature = true;
    const { x, y } = posFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const { x, y } = posFromEvent(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) =>
    canvas.addEventListener(evt, () => {
      drawing = false;
    })
  );

  document.getElementById('clear-signature').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSignature = false;
  });
}

function clearSignatureCanvas() {
  const canvas = document.getElementById('signature-pad');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  hasSignature = false;
}

function openCloseModal(session) {
  closingSessionId = session.id;
  document.getElementById('close-summary').textContent =
    `N° ${session.numero ?? '—'} · ${formatDate(session.date)} · ${session.creneau} · TRI ${session.nomTri} · CDB ${session.nomCdb} · FO ${session.nomFo} · ${session.typeTraining}/${session.typeSeance}`;
  document.getElementById('close-heureFin').value = nowHm();
  document.getElementById('close-pin').value = '';
  document.getElementById('close-remarques').value = '';
  document.getElementById('close-error').textContent = '';
  clearSignatureCanvas();
  document.getElementById('close-modal').hidden = false;
}

async function handleCloseSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('close-error');
  errorEl.textContent = '';

  const heureFin = document.getElementById('close-heureFin').value;
  const pin = document.getElementById('close-pin').value;
  const remarques = document.getElementById('close-remarques').value.trim();

  if (!heureFin) {
    errorEl.textContent = "L'heure de fin est obligatoire.";
    return;
  }
  if (!hasSignature) {
    errorEl.textContent = 'Veuillez signer avant de clôturer la séance.';
    return;
  }

  const candidate = await sha256Hex(`${pin}:${auth.user.id}`);
  if (candidate !== auth.pinVerifier) {
    errorEl.textContent = 'Mot de passe incorrect.';
    return;
  }

  const canvas = document.getElementById('signature-pad');
  const signature = canvas.toDataURL('image/png');
  const payload = { heureFin, remarques, signature };

  const session = sessions.find((s) => s.id === closingSessionId);
  const updated = {
    ...session,
    ...payload,
    status: 'cloturee',
    closedByName: auth.user.name,
    closedAt: new Date().toISOString(),
  };

  await db.putSession(updated);
  await db.queueAction({ type: 'close', targetId: closingSessionId, payload, token: auth.token });
  document.getElementById('close-modal').hidden = true;
  await syncAndRender();
}

// ---------- Export PDF / email ----------

async function downloadBlobResponse(res, filename) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ errors: ['Erreur lors du téléchargement.'] }));
    throw new Error((body.errors || []).join('\n') || 'Erreur lors du téléchargement.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function handleExportPdf() {
  const from = document.getElementById('export-from').value;
  const to = document.getElementById('export-to').value;
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const msg = document.getElementById('export-message');
  msg.textContent = '';
  try {
    const res = await apiFetch(`/api/export/pdf?${params.toString()}`);
    await downloadBlobResponse(res, 'registre-fstd.pdf');
  } catch (err) {
    msg.textContent = err.message;
  }
}

async function handleExportEmail() {
  const to = document.getElementById('export-email').value.trim();
  const from = document.getElementById('export-from').value;
  const toDate = document.getElementById('export-to').value;
  const msg = document.getElementById('export-message');
  msg.textContent = '';

  if (!to) {
    msg.textContent = 'Merci de renseigner une adresse email.';
    return;
  }
  if (!navigator.onLine) {
    msg.textContent = "L'envoi par email nécessite une connexion réseau.";
    return;
  }

  try {
    const res = await apiFetch('/api/export/email', { method: 'POST', body: JSON.stringify({ to, from, toDate }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      msg.textContent = (body.errors || []).join('\n') || "Échec de l'envoi.";
      return;
    }
    msg.textContent = `Registre envoyé par email à ${to}.`;
  } catch {
    msg.textContent = "Échec de l'envoi (réseau indisponible).";
  }
}

async function downloadSessionPdf(id) {
  const res = await apiFetch(`/api/sessions/${id}/pdf`);
  try {
    await downloadBlobResponse(res, `seance-${id}.pdf`);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteSession(id) {
  if (!confirm('Supprimer définitivement cette séance du registre ?')) return;
  if (!navigator.onLine) {
    alert('Suppression impossible hors connexion.');
    return;
  }
  const res = await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (res.ok || res.status === 404) {
    await db.deleteSessionLocal(id);
    await renderAll();
  } else {
    alert('Échec de la suppression.');
  }
}

// ---------- Init ----------

function bindEvents() {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('login-name').value.trim();
    const pin = document.getElementById('login-pin').value;
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    try {
      const res = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ name, pin }) }, null);
      const body = await res.json();
      if (!res.ok) {
        errorEl.textContent = (body.errors || []).join('\n') || 'Connexion impossible.';
        return;
      }
      const pinVerifier = await sha256Hex(`${pin}:${body.user.id}`);
      saveAuth({ token: body.token, user: body.user, pinVerifier });
      showAppScreen();
      await syncAndRender();
    } catch {
      errorEl.textContent = 'Connexion impossible (réseau indisponible). Réessayez une fois en ligne pour votre première connexion.';
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    clearAuth();
    showAuthScreen();
  });

  document.getElementById('open-session-btn').addEventListener('click', openOpenModal);
  document.getElementById('open-form').addEventListener('submit', handleOpenSubmit);
  document.getElementById('close-form').addEventListener('submit', handleCloseSubmit);

  document.querySelectorAll('[data-close-modal]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.target.closest('.modal-overlay').hidden = true;
    })
  );

  document.getElementById('open-sessions').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="close-session"]');
    if (!btn) return;
    const session = sessions.find((s) => s.id === btn.dataset.id);
    if (session) openCloseModal(session);
  });

  document.getElementById('sessions-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'pdf') downloadSessionPdf(btn.dataset.id);
    if (btn.dataset.action === 'delete') deleteSession(btn.dataset.id);
  });

  document.getElementById('search').addEventListener('input', () => renderAll());

  document.getElementById('export-pdf-btn').addEventListener('click', handleExportPdf);
  document.getElementById('export-email-btn').addEventListener('click', handleExportEmail);

  window.addEventListener('online', () => {
    updateSyncUi();
    syncAndRender();
  });
  window.addEventListener('offline', updateSyncUi);

  setInterval(tickChronos, 1000);
  setInterval(() => {
    if (navigator.onLine) syncAndRender();
  }, 20000);
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  setupSignaturePad();
  bindEvents();

  auth = loadAuth();
  if (auth) {
    showAppScreen();
    await renderAll(); // affichage immédiat depuis le cache local (hors-ligne compatible)
    await syncAndRender();
  } else {
    showAuthScreen();
  }
}

init();
