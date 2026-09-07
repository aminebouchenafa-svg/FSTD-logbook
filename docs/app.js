// Version statique (GitHub Pages) : aucun serveur. Les séances sont stockées
// uniquement dans ce navigateur (IndexedDB) — chaque appareil a son propre
// registre, non partagé avec les autres. Le mot de passe est vérifié côté
// client (pas de vraie sécurité, juste un verrou d'accès simple).

const PASSWORDS = ['SIM-boeing737'];
const ADMIN_CODE = '737800';
const AUTH_KEY = 'fstd_static_unlocked';
const COUNTER_KEY = 'fstd_static_counter';
const DB_NAME = 'fstd-logbook-static';
const DB_VERSION = 1;

let sessions = [];
let selectedIds = new Set();
let currentFilteredIds = [];
let closingSessionId = null;
let fullscreenSessionId = null;
let hasSignature = false;
let drawing = false;

// ---------- IndexedDB ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
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

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllSessions() {
  const db = await getDb();
  const store = db.transaction('sessions', 'readonly').objectStore('sessions');
  return reqToPromise(store.getAll());
}

async function putSession(session) {
  const db = await getDb();
  const store = db.transaction('sessions', 'readwrite').objectStore('sessions');
  return reqToPromise(store.put(session));
}

async function deleteSessionLocal(id) {
  const db = await getDb();
  const store = db.transaction('sessions', 'readwrite').objectStore('sessions');
  return reqToPromise(store.delete(id));
}

function nextNumero() {
  const n = Number(localStorage.getItem(COUNTER_KEY) || '0') + 1;
  localStorage.setItem(COUNTER_KEY, String(n));
  return n;
}

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

// ---------- Écrans ----------

function showAuthScreen() {
  document.getElementById('auth-screen').hidden = false;
  document.getElementById('app-screen').hidden = true;
}

function showAppScreen() {
  document.getElementById('auth-screen').hidden = true;
  document.getElementById('app-screen').hidden = false;
}

// ---------- Rendu ----------

async function renderAll() {
  sessions = await getAllSessions();
  sessions.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.heureDebut || '').localeCompare(a.heureDebut || '');
  });
  renderOpenSessions();
  renderTable();
}

function renderOpenSessions() {
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
        TRI ${escapeHtml(s.nomTri)} · CDB ${escapeHtml(s.nomCdb)} · FO ${escapeHtml(s.nomFo)}
      </div>
      <div class="badges">
        <span class="badge badge-lg ${badgeClass(s.typeTraining)}">${s.typeTraining}</span>
        <span class="badge badge-lg ${badgeClass(s.typeSeance)}">${s.typeSeance}</span>
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

function openFullscreenChrono(session) {
  fullscreenSessionId = session.id;
  document.getElementById('fullscreen-chrono-value').dataset.start = session.createdAt;
  document.getElementById('fullscreen-slot').innerHTML =
    `<span class="badge badge-lg ${badgeClass(session.creneau)}">${session.creneau}</span>`;
  document.getElementById('fullscreen-crew').innerHTML = `
    <span class="chip chip-violet">TRI/TRE ${escapeHtml(session.nomTri)}</span>
    <span class="chip chip-info">CDB ${escapeHtml(session.nomCdb)}</span>
    <span class="chip chip-teal">FO ${escapeHtml(session.nomFo)}</span>
  `;
  document.getElementById('fullscreen-chrono').hidden = false;
  tickChronos();
}

function closeFullscreenChrono() {
  document.getElementById('fullscreen-chrono').hidden = true;
  fullscreenSessionId = null;
}

function renderTable() {
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

  const validIds = new Set(sessions.map((s) => s.id));
  selectedIds.forEach((id) => { if (!validIds.has(id)) selectedIds.delete(id); });

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="14" class="empty">Aucune séance enregistrée.</td></tr>';
    updateSelectionUi(filtered);
    return;
  }

  body.innerHTML = filtered
    .map((s) => `
    <tr data-id="${s.id}">
      <td><input type="checkbox" class="row-select" data-id="${s.id}" ${selectedIds.has(s.id) ? 'checked' : ''}></td>
      <td>${s.numero ?? '—'}</td>
      <td>${formatDate(s.date)}</td>
      <td><span class="badge badge-lg ${badgeClass(s.creneau)}">${s.creneau}</span></td>
      <td><span class="chip chip-navy">${s.heureDebut}</span></td>
      <td>${s.heureFin ? `<span class="chip chip-navy">${s.heureFin}</span>` : '—'}</td>
      <td>${formatDuration(s.date, s.heureDebut, s.heureFin)}</td>
      <td><span class="chip chip-violet">${escapeHtml(s.nomTri)}</span></td>
      <td><span class="chip chip-info">${escapeHtml(s.nomCdb)}</span></td>
      <td><span class="chip chip-teal">${escapeHtml(s.nomFo)}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.typeTraining)}">${s.typeTraining}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.typeSeance)}">${s.typeSeance}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.status)}">${s.status === 'cloturee' ? 'Clôturée' : 'Ouverte'}</span></td>
      <td>
        <div class="row-actions">
          <button class="pdf-btn" data-action="pdf" data-id="${s.id}">PDF</button>
          ${s.status === 'cloturee' ? '' : `<button class="delete-btn" data-action="delete" data-id="${s.id}">Suppr.</button>`}
        </div>
      </td>
    </tr>`)
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
  document.getElementById('open-nomFo').value = '';
  document.getElementById('open-typeTraining').value = '';
  document.getElementById('open-typeSeance').value = '';
  document.getElementById('open-error').textContent = '';
  document.getElementById('open-modal').hidden = false;
}

async function handleOpenSubmit(e) {
  e.preventDefault();
  const payload = {
    date: document.getElementById('open-date').value,
    creneau: document.getElementById('open-creneau').value,
    heureDebut: document.getElementById('open-heureDebut').value,
    nomTri: document.getElementById('open-nomTri').value.trim(),
    nomCdb: document.getElementById('open-nomCdb').value.trim(),
    nomFo: document.getElementById('open-nomFo').value.trim(),
    typeTraining: document.getElementById('open-typeTraining').value,
    typeSeance: document.getElementById('open-typeSeance').value,
  };

  const missing = Object.values(payload).some((v) => !v);
  if (missing) {
    document.getElementById('open-error').textContent = 'Merci de remplir tous les champs.';
    return;
  }

  const session = {
    id: uuid(),
    numero: nextNumero(),
    ...payload,
    heureFin: null,
    status: 'ouverte',
    remarques: '',
    signature: null,
    createdAt: new Date().toISOString(),
    closedAt: null,
  };

  await putSession(session);
  document.getElementById('open-modal').hidden = true;
  await renderAll();
  openFullscreenChrono(session);
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
    canvas.addEventListener(evt, () => { drawing = false; })
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
  const remarques = document.getElementById('close-remarques').value.trim();

  if (!heureFin) {
    errorEl.textContent = "L'heure de fin est obligatoire.";
    return;
  }
  if (!hasSignature) {
    errorEl.textContent = 'Veuillez signer avant de clôturer la séance.';
    return;
  }

  const canvas = document.getElementById('signature-pad');
  const signature = canvas.toDataURL('image/png');

  const session = sessions.find((s) => s.id === closingSessionId);
  const updated = {
    ...session,
    heureFin,
    remarques,
    signature,
    status: 'cloturee',
    closedAt: new Date().toISOString(),
  };

  await putSession(updated);
  document.getElementById('close-modal').hidden = true;
  await renderAll();
}

// ---------- PDF (jsPDF, généré dans le navigateur) ----------

const { jsPDF } = window.jspdf;

function drawSessionPdf(doc, session, y0 = 20) {
  doc.setFontSize(16);
  doc.setTextColor(20, 24, 40);
  doc.text('FSTD Logbook 737 NG', 14, y0);
  doc.setFontSize(10);
  doc.setTextColor(100, 110, 130);
  doc.text('Registre des séances simulateur', 14, y0 + 6);
  doc.setFontSize(13);
  doc.setTextColor(20, 24, 40);
  doc.text(`Fiche de séance n° ${session.numero}`, 14, y0 + 16);

  const rows = [
    ['Date', formatDate(session.date)],
    ['Slot', session.creneau],
    ['Heure de début', session.heureDebut],
    ['Heure de fin', session.heureFin || '—'],
    ['Durée', formatDuration(session.date, session.heureDebut, session.heureFin)],
    ['Type de training', session.typeTraining],
    ['Type de séance', session.typeSeance],
    ['Statut', session.status === 'cloturee' ? 'Clôturée' : 'Ouverte'],
    ['TRI', session.nomTri],
    ['CDB', session.nomCdb],
    ['FO', session.nomFo],
  ];

  let y = y0 + 26;
  doc.setFontSize(10);
  rows.forEach(([label, value]) => {
    doc.setTextColor(100, 110, 130);
    doc.text(`${label}`, 14, y);
    doc.setTextColor(20, 24, 40);
    doc.text(String(value ?? '—'), 60, y);
    y += 7;
  });

  y += 2;
  doc.setTextColor(100, 110, 130);
  doc.text('Remarques', 14, y);
  y += 6;
  doc.setTextColor(20, 24, 40);
  doc.text(doc.splitTextToSize(session.remarques || '—', 180), 14, y);
  y += 14;

  if (session.signature) {
    doc.setTextColor(100, 110, 130);
    doc.text('Signature électronique', 14, y);
    y += 4;
    try {
      doc.addImage(session.signature, 'PNG', 14, y, 60, 20);
      y += 24;
    } catch {
      // ignore si l'image ne peut pas être décodée
    }
  }

  return y;
}

function sessionsTablePdf(doc, sessionsToPrint, title) {
  doc.setFontSize(16);
  doc.setTextColor(20, 24, 40);
  doc.text('FSTD Logbook 737 NG', 14, 15);
  doc.setFontSize(10);
  doc.setTextColor(100, 110, 130);
  doc.text(title, 14, 21);

  const headers = ['N°', 'Date', 'Slot', 'Début', 'Fin', 'Durée', 'TRI', 'CDB', 'FO', 'Training', 'Séance', 'Statut'];
  const colX = [14, 24, 42, 60, 74, 88, 100, 130, 160, 190, 210, 226];
  let y = 32;

  doc.setFontSize(8);
  doc.setTextColor(100, 110, 130);
  headers.forEach((h, i) => doc.text(h, colX[i], y));
  y += 2;
  doc.setDrawColor(210, 214, 222);
  doc.line(14, y, 245, y);
  y += 5;

  sessionsToPrint.forEach((s) => {
    if (y > 195) {
      doc.addPage('a4', 'landscape');
      y = 20;
    }
    const values = [
      s.numero, formatDate(s.date), s.creneau, s.heureDebut, s.heureFin || '—',
      formatDuration(s.date, s.heureDebut, s.heureFin), s.nomTri, s.nomCdb, s.nomFo,
      s.typeTraining, s.typeSeance, s.status === 'cloturee' ? 'Clôturée' : 'Ouverte',
    ];
    doc.setTextColor(20, 24, 40);
    values.forEach((v, i) => doc.text(String(v ?? '—'), colX[i], y, { maxWidth: (colX[i + 1] || 245) - colX[i] - 2 }));
    y += 6;
  });
}

async function shareOrDownloadPdfDoc(doc, filename, shareTitle) {
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: shareTitle || filename });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
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

async function downloadSessionPdf(id) {
  const session = sessions.find((s) => s.id === id);
  if (!session) return;
  const doc = new jsPDF();
  drawSessionPdf(doc, session);
  await shareOrDownloadPdfDoc(doc, `seance-${session.numero}.pdf`, 'Fiche de séance');
}

async function handleShareSelection() {
  if (selectedIds.size === 0) return;
  const chosen = sessions.filter((s) => selectedIds.has(s.id));
  const doc = new jsPDF({ orientation: 'landscape' });
  sessionsTablePdf(doc, chosen, `${chosen.length} séance(s) sélectionnée(s)`);
  await shareOrDownloadPdfDoc(doc, 'seances-selection.pdf', 'Séances sélectionnées');
}

async function handleExportPdf() {
  const from = document.getElementById('export-from').value;
  const to = document.getElementById('export-to').value;
  let filtered = sessions;
  if (from) filtered = filtered.filter((s) => s.date >= from);
  if (to) filtered = filtered.filter((s) => s.date <= to);

  const title = from || to
    ? `Registre (${from ? formatDate(from) : '…'} → ${to ? formatDate(to) : '…'})`
    : 'Registre complet';
  const doc = new jsPDF({ orientation: 'landscape' });
  sessionsTablePdf(doc, filtered, title);
  await shareOrDownloadPdfDoc(doc, 'registre-fstd.pdf', 'Registre FSTD');
}

async function deleteSession(id) {
  const session = sessions.find((s) => s.id === id);
  if (session && session.status === 'cloturee') {
    alert('Cette séance est clôturée et signée : elle ne peut plus être supprimée.');
    return;
  }
  if (!confirm('Supprimer définitivement cette séance de ce registre ?')) return;
  await deleteSessionLocal(id);
  await renderAll();
}

// ---------- Administration (accès séparé, supprime même les séances clôturées) ----------

function openAdminModal() {
  document.getElementById('admin-code').value = '';
  document.getElementById('admin-error').textContent = '';
  document.getElementById('admin-lock').hidden = false;
  document.getElementById('admin-panel').hidden = true;
  document.getElementById('admin-modal').hidden = false;
}

function renderAdminTable() {
  const body = document.getElementById('admin-body');
  if (sessions.length === 0) {
    body.innerHTML = '<tr><td colspan="13" class="empty">Aucune séance enregistrée.</td></tr>';
    return;
  }
  body.innerHTML = sessions
    .map((s) => `
    <tr data-id="${s.id}">
      <td>${s.numero ?? '—'}</td>
      <td>${formatDate(s.date)}</td>
      <td><span class="badge badge-lg ${badgeClass(s.creneau)}">${s.creneau}</span></td>
      <td><span class="chip chip-navy">${s.heureDebut}</span></td>
      <td>${s.heureFin ? `<span class="chip chip-navy">${s.heureFin}</span>` : '—'}</td>
      <td>${formatDuration(s.date, s.heureDebut, s.heureFin)}</td>
      <td><span class="chip chip-violet">${escapeHtml(s.nomTri)}</span></td>
      <td><span class="chip chip-info">${escapeHtml(s.nomCdb)}</span></td>
      <td><span class="chip chip-teal">${escapeHtml(s.nomFo)}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.typeTraining)}">${s.typeTraining}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.typeSeance)}">${s.typeSeance}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.status)}">${s.status === 'cloturee' ? 'Clôturée' : 'Ouverte'}</span></td>
      <td><button class="delete-btn" data-action="admin-delete" data-id="${s.id}">Suppr.</button></td>
    </tr>`)
    .join('');
}

async function handleAdminDelete(id) {
  const session = sessions.find((s) => s.id === id);
  const label = session ? `N° ${session.numero ?? '—'} (${formatDate(session.date)}, TRI ${session.nomTri})` : 'cette séance';
  if (!confirm(`Supprimer définitivement ${label} ? Cette action est irréversible, y compris pour une séance clôturée et signée.`)) return;
  await deleteSessionLocal(id);
  await renderAll();
  renderAdminTable();
}

// ---------- Auth ----------

function checkAuth() {
  return sessionStorage.getItem(AUTH_KEY) === '1';
}

function bindEvents() {
  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = document.getElementById('login-pin').value;
    const errorEl = document.getElementById('login-error');
    if (PASSWORDS.includes(pin)) {
      sessionStorage.setItem(AUTH_KEY, '1');
      errorEl.textContent = '';
      showAppScreen();
      renderAll();
    } else {
      errorEl.textContent = 'Mot de passe incorrect.';
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem(AUTH_KEY);
    showAuthScreen();
  });

  document.getElementById('open-session-btn').addEventListener('click', openOpenModal);
  document.getElementById('open-form').addEventListener('submit', handleOpenSubmit);
  document.getElementById('close-form').addEventListener('submit', handleCloseSubmit);

  document.querySelectorAll('[data-close-modal]').forEach((btn) =>
    btn.addEventListener('click', (e) => { e.target.closest('.modal-overlay').hidden = true; })
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
    renderTable();
  });

  document.getElementById('clear-selection-btn').addEventListener('click', () => {
    selectedIds.clear();
    renderTable();
  });

  document.getElementById('share-selection-btn').addEventListener('click', handleShareSelection);
  document.getElementById('search').addEventListener('input', () => renderAll());
  document.getElementById('export-pdf-btn').addEventListener('click', handleExportPdf);

  document.getElementById('open-admin-btn').addEventListener('click', openAdminModal);
  document.getElementById('admin-unlock-btn').addEventListener('click', () => {
    const code = document.getElementById('admin-code').value;
    if (code === ADMIN_CODE) {
      document.getElementById('admin-lock').hidden = true;
      document.getElementById('admin-panel').hidden = false;
      renderAdminTable();
    } else {
      document.getElementById('admin-error').textContent = 'Code incorrect.';
    }
  });
  document.getElementById('admin-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="admin-delete"]');
    if (btn) handleAdminDelete(btn.dataset.id);
  });

  setInterval(tickChronos, 1000);
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  setupSignaturePad();
  bindEvents();

  if (checkAuth()) {
    showAppScreen();
    await renderAll();
  } else {
    showAuthScreen();
  }
}

init();
