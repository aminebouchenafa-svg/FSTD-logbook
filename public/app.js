import * as db from './db.js';

const AUTH_KEY = 'fstd_auth';

let auth = null; // { token, user: {id, name}, pinVerifier }
let sessions = [];
let outbox = [];
let closingSessionId = null;
let fullscreenSessionId = null;
let hasSignature = false;
let drawing = false;
let selectedIds = new Set();
let currentFilteredIds = [];

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

// Calcule la durée entre heureDebut et heureFin, en gérant les séances qui
// passent minuit (ex. créneau S5 : 23h00 -> 03h00).
function formatDuration(date, heureDebut, heureFin) {
  if (!heureFin) return '—';
  const start = new Date(`${date}T${heureDebut}:00`);
  let end = new Date(`${date}T${heureFin}:00`);
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  const minutes = Math.round((end - start) / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
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

// Construit la ligne d'équipage en ignorant les rôles vides (une séance peut
// n'avoir que des CPT, ou que des FO).
function crewLine(s) {
  const parts = [`TRI ${escapeHtml(s.nomTri)}`];
  const cpts = [s.nomCdb, s.nomCdb2].filter(Boolean).map(escapeHtml).join(' / ');
  if (cpts) parts.push(`CPT ${cpts}`);
  const fos = [s.nomFo, s.nomFo2].filter(Boolean).map(escapeHtml).join(' / ');
  if (fos) parts.push(`FO ${fos}`);
  return parts.join(' · ');
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
      S1: 'badge-s1',
      S2: 'badge-s2',
      S3: 'badge-s3',
      S4: 'badge-s4',
      S5: 'badge-s5',
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
      <div class="chrono" data-start="${s.createdAt}" data-action="expand-chrono" data-id="${s.id}">00:00:00</div>
      <div><strong>${formatDate(s.date)}</strong> <span class="badge badge-lg ${badgeClass(s.creneau)}">${s.creneau}</span></div>
      <div class="crew">
        ${crewLine(s)}
      </div>
      <div class="badges">
        <span class="badge badge-lg ${badgeClass(s.typeTraining)}">${s.typeTraining}</span>
        <span class="badge badge-lg ${badgeClass(s.typeSeance)}">${s.typeSeance}</span>
        ${pendingIds.has(s.id) ? '<span class="badge badge-pending">en attente de sync</span>' : ''}
      </div>
      <button type="button" data-action="close-session" data-id="${s.id}">Clôturer</button>
    </div>`
    )
    .join('');
}

function openFullscreenChrono(session) {
  fullscreenSessionId = session.id;
  document.getElementById('fullscreen-chrono-value').dataset.start = session.createdAt;
  document.getElementById('fullscreen-slot').innerHTML =
    `<span class="badge badge-lg ${badgeClass(session.creneau)}">${session.creneau}</span>`;
  document.getElementById('fullscreen-crew').innerHTML = `
    <span class="chip chip-violet">TRI/TRE ${escapeHtml(session.nomTri)}</span>
    ${session.nomCdb ? `<span class="chip chip-info">CPT ${escapeHtml(session.nomCdb)}</span>` : ''}
    ${session.nomCdb2 ? `<span class="chip chip-info">CPT 2 ${escapeHtml(session.nomCdb2)}</span>` : ''}
    ${session.nomFo ? `<span class="chip chip-teal">FO ${escapeHtml(session.nomFo)}</span>` : ''}
    ${session.nomFo2 ? `<span class="chip chip-teal">FO 2 ${escapeHtml(session.nomFo2)}</span>` : ''}
  `;
  document.getElementById('fullscreen-chrono').hidden = false;
  tickChronos();
}

function closeFullscreenChrono() {
  document.getElementById('fullscreen-chrono').hidden = true;
  fullscreenSessionId = null;
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
        [s.nomTri, s.nomCdb, s.nomCdb2, s.nomFo, s.nomFo2, s.date, s.creneau, s.typeTraining, s.typeSeance]
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
    : sessions;

  const body = document.getElementById('sessions-body');

  // On ne garde en sélection que des séances toujours présentes.
  const validIds = new Set(sessions.map((s) => s.id));
  selectedIds.forEach((id) => { if (!validIds.has(id)) selectedIds.delete(id); });

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="16" class="empty">Aucune séance enregistrée.</td></tr>';
    updateSelectionUi(filtered);
    return;
  }

  body.innerHTML = filtered
    .map((s) => {
      const pending = pendingIds.has(s.id);
      return `
    <tr data-id="${s.id}">
      <td><input type="checkbox" class="row-select" data-id="${s.id}" ${selectedIds.has(s.id) ? 'checked' : ''}></td>
      <td>${s.numero ?? '—'}</td>
      <td><span class="chip chip-red">${formatDate(s.date)}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.creneau)}">${s.creneau}</span></td>
      <td><span class="chip chip-navy">${s.heureDebut}</span></td>
      <td>${s.heureFin ? `<span class="chip chip-navy">${s.heureFin}</span>` : '—'}</td>
      <td><span class="chip chip-yellow">${formatDuration(s.date, s.heureDebut, s.heureFin)}</span></td>
      <td><span class="chip chip-violet">${escapeHtml(s.nomTri)}</span></td>
      <td>${s.nomCdb ? `<span class="chip chip-info">${escapeHtml(s.nomCdb)}</span>` : '—'}</td>
      <td>${s.nomCdb2 ? `<span class="chip chip-info">${escapeHtml(s.nomCdb2)}</span>` : '—'}</td>
      <td>${s.nomFo ? `<span class="chip chip-teal">${escapeHtml(s.nomFo)}</span>` : '—'}</td>
      <td>${s.nomFo2 ? `<span class="chip chip-teal">${escapeHtml(s.nomFo2)}</span>` : '—'}</td>
      <td><span class="badge badge-lg ${badgeClass(s.typeTraining)}">${s.typeTraining}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.typeSeance)}">${s.typeSeance}</span></td>
      <td>
        <span class="badge badge-lg ${badgeClass(s.status)}">${s.status === 'cloturee' ? 'Clôturée' : 'Ouverte'}</span>
        ${pending ? '<span class="badge badge-pending">sync…</span>' : ''}
      </td>
      <td>
        <div class="row-actions">
          <button class="pdf-btn" data-action="pdf" data-id="${s.id}" ${pending ? 'disabled title="Disponible après synchronisation"' : ''}>PDF</button>
          ${s.status === 'cloturee' ? '' : `<button class="delete-btn" data-action="delete" data-id="${s.id}">Suppr.</button>`}
        </div>
      </td>
    </tr>`;
    })
    .join('');

  updateSelectionUi(filtered);
}

function updateSelectionUi(filtered) {
  const bar = document.getElementById('selection-bar');
  const count = document.getElementById('selection-count');
  const selectAll = document.getElementById('select-all');

  bar.hidden = selectedIds.size === 0;
  count.textContent = `${selectedIds.size} séance(s) sélectionnée(s)`;

  currentFilteredIds = filtered.map((s) => s.id);
  const selectedInView = currentFilteredIds.filter((id) => selectedIds.has(id));
  selectAll.checked = currentFilteredIds.length > 0 && selectedInView.length === currentFilteredIds.length;
  selectAll.indeterminate = selectedInView.length > 0 && selectedInView.length < currentFilteredIds.length;
}

// ---------- Modale : démarrer une séance ----------

function openOpenModal() {
  document.getElementById('open-date').value = todayIso();
  document.getElementById('open-creneau').value = '';
  document.getElementById('open-heureDebut').value = nowHm();
  document.getElementById('open-nomTri').value = '';
  document.getElementById('open-nomCdb').value = '';
  document.getElementById('open-nomCdb2').value = '';
  document.getElementById('open-nomFo').value = '';
  document.getElementById('open-nomFo2').value = '';
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
    typeTraining: document.getElementById('open-typeTraining').value,
    typeSeance: document.getElementById('open-typeSeance').value,
  };

  const missing = Object.entries(payload).filter(([k, v]) => k !== 'id' && !v);
  if (missing.length > 0) {
    document.getElementById('open-error').textContent = 'Merci de remplir tous les champs.';
    return;
  }

  payload.nomCdb = document.getElementById('open-nomCdb').value.trim();
  payload.nomCdb2 = document.getElementById('open-nomCdb2').value.trim();
  payload.nomFo = document.getElementById('open-nomFo').value.trim();
  payload.nomFo2 = document.getElementById('open-nomFo2').value.trim();

  if (!payload.nomCdb && !payload.nomCdb2 && !payload.nomFo && !payload.nomFo2) {
    document.getElementById('open-error').textContent = "Merci de renseigner au moins un membre d'équipage (CPT ou FO).";
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

  try {
    await db.putSession(localSession);
    await db.queueAction({ type: 'create', targetId: payload.id, payload, token: auth.token });
  } catch (err) {
    const reason = err && err.message ? err.message : 'erreur inconnue';
    document.getElementById('open-error').textContent = `Impossible d'enregistrer la séance sur cet appareil (${reason}).`;
    return;
  }
  document.getElementById('open-modal').hidden = true;
  await syncAndRender();
  openFullscreenChrono(localSession);
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
  const summaryParts = [formatDate(session.date), session.creneau, `TRI ${session.nomTri}`];
  const cpts = [session.nomCdb, session.nomCdb2].filter(Boolean).join(' / ');
  if (cpts) summaryParts.push(`CPT ${cpts}`);
  const fos = [session.nomFo, session.nomFo2].filter(Boolean).join(' / ');
  if (fos) summaryParts.push(`FO ${fos}`);
  summaryParts.push(`${session.typeTraining}/${session.typeSeance}`);
  document.getElementById('close-summary').textContent = summaryParts.join(' · ');
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

// Sur iPad/iPhone, propose la feuille de partage native (AirDrop, Mail, Messages…)
// quand elle est disponible ; sinon, retombe sur un téléchargement classique.
async function shareOrDownloadResponse(res, filename, shareTitle) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ errors: ['Erreur lors du téléchargement.'] }));
    throw new Error((body.errors || []).join('\n') || 'Erreur lors du téléchargement.');
  }
  const blob = await res.blob();
  const file = new File([blob], filename, { type: 'application/pdf' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: shareTitle || filename });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // l'utilisateur a annulé le partage
      // Sinon on retombe sur le téléchargement classique ci-dessous.
    }
  }

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
    await shareOrDownloadResponse(res, 'registre-fstd.pdf', 'Registre FSTD');
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
    await shareOrDownloadResponse(res, `seance-${id}.pdf`, 'Fiche de séance');
  } catch (err) {
    alert(err.message);
  }
}

async function handleShareSelection() {
  const msg = document.getElementById('export-message');
  if (selectedIds.size === 0) return;
  try {
    const params = new URLSearchParams({ ids: Array.from(selectedIds).join(',') });
    const res = await apiFetch(`/api/export/pdf?${params.toString()}`);
    await shareOrDownloadResponse(res, 'seances-selection.pdf', 'Séances sélectionnées');
  } catch (err) {
    if (msg) msg.textContent = err.message;
    else alert(err.message);
  }
}

async function deleteSession(id) {
  const session = sessions.find((s) => s.id === id);
  if (session && session.status === 'cloturee') {
    alert('Cette séance est clôturée et signée : elle ne peut plus être supprimée.');
    return;
  }
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

// Supprime les séances sélectionnées qui ne sont pas clôturées ; celles déjà
// clôturées et signées ne peuvent pas être supprimées.
async function handleDeleteSelection() {
  if (selectedIds.size === 0) return;
  const chosen = sessions.filter((s) => selectedIds.has(s.id));
  const deletable = chosen.filter((s) => s.status !== 'cloturee');
  const blocked = chosen.length - deletable.length;

  if (deletable.length === 0) {
    alert('Ces séances sont clôturées et signées : elles ne peuvent plus être supprimées.');
    return;
  }
  if (!navigator.onLine) {
    alert('Suppression impossible hors connexion.');
    return;
  }

  const message = blocked > 0
    ? `Supprimer définitivement ${deletable.length} séance(s) ? ${blocked} séance(s) clôturée(s) de la sélection ne peuvent pas être supprimées.`
    : `Supprimer définitivement ${deletable.length} séance(s) ?`;
  if (!confirm(message)) return;

  for (const s of deletable) {
    const res = await apiFetch(`/api/sessions/${s.id}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) {
      await db.deleteSessionLocal(s.id);
      selectedIds.delete(s.id);
    }
  }
  await renderAll();
}

// ---------- Init ----------

function bindEvents() {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('login-name').value.trim();
    const pin = document.getElementById('login-pin').value;
    const errorEl = document.getElementById('login-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const authScreen = document.getElementById('auth-screen');
    errorEl.textContent = '';
    submitBtn.classList.add('btn-loading');
    try {
      const res = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ name, pin }) }, null);
      const body = await res.json();
      if (!res.ok) {
        submitBtn.classList.remove('btn-loading');
        errorEl.textContent = (body.errors || []).join('\n') || 'Connexion impossible.';
        const card = document.querySelector('.auth-card');
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        return;
      }
      const pinVerifier = await sha256Hex(`${pin}:${body.user.id}`);
      saveAuth({ token: body.token, user: body.user, pinVerifier });
      authScreen.classList.add('fade-out');
      setTimeout(async () => {
        submitBtn.classList.remove('btn-loading');
        authScreen.classList.remove('fade-out');
        showAppScreen();
        await syncAndRender();
      }, 350);
    } catch {
      submitBtn.classList.remove('btn-loading');
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
    const closeBtn = e.target.closest('button[data-action="close-session"]');
    if (closeBtn) {
      const session = sessions.find((s) => s.id === closeBtn.dataset.id);
      if (session) openCloseModal(session);
      return;
    }
    const chrono = e.target.closest('[data-action="expand-chrono"]');
    if (chrono) {
      const session = sessions.find((s) => s.id === chrono.dataset.id);
      if (session) openFullscreenChrono(session);
    }
  });

  document.getElementById('fullscreen-close-btn').addEventListener('click', closeFullscreenChrono);
  document.getElementById('fullscreen-close-session-btn').addEventListener('click', () => {
    const session = sessions.find((s) => s.id === fullscreenSessionId);
    closeFullscreenChrono();
    if (session) openCloseModal(session);
  });

  document.getElementById('sessions-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'pdf') downloadSessionPdf(btn.dataset.id);
    if (btn.dataset.action === 'delete') deleteSession(btn.dataset.id);
  });

  document.getElementById('sessions-body').addEventListener('change', (e) => {
    const checkbox = e.target.closest('.row-select');
    if (!checkbox) return;
    if (checkbox.checked) selectedIds.add(checkbox.dataset.id);
    else selectedIds.delete(checkbox.dataset.id);
    updateSelectionUi(sessions.filter((s) => currentFilteredIds.includes(s.id)));
  });

  document.getElementById('select-all').addEventListener('change', (e) => {
    if (e.target.checked) currentFilteredIds.forEach((id) => selectedIds.add(id));
    else currentFilteredIds.forEach((id) => selectedIds.delete(id));
    renderTable(new Set(outbox.map((a) => a.targetId)));
  });

  document.getElementById('clear-selection-btn').addEventListener('click', () => {
    selectedIds.clear();
    renderTable(new Set(outbox.map((a) => a.targetId)));
  });

  document.getElementById('share-selection-btn').addEventListener('click', handleShareSelection);
  document.getElementById('delete-selection-btn').addEventListener('click', handleDeleteSelection);

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
