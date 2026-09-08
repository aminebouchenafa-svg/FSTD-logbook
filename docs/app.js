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
let adminSelectedIds = new Set();
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

// Affiche un nom avec son matricule entre parenthèses s'il est renseigné.
function crewNameHtml(nom, matricule) {
  if (!nom) return '';
  return matricule ? `${escapeHtml(nom)} <span class="matricule">(${escapeHtml(matricule)})</span>` : escapeHtml(nom);
}

// Construit la ligne d'équipage en ignorant les rôles vides (une séance peut
// n'avoir que des CPT, ou que des FO).
function crewLine(s) {
  const parts = [`TRI ${crewNameHtml(s.nomTri, s.matriculeTri)}`];
  const cpts = [
    s.nomCdb ? crewNameHtml(s.nomCdb, s.matriculeCdb) : '',
    s.nomCdb2 ? crewNameHtml(s.nomCdb2, s.matriculeCdb2) : '',
  ].filter(Boolean).join(' / ');
  if (cpts) parts.push(`CPT ${cpts}`);
  const fos = [
    s.nomFo ? crewNameHtml(s.nomFo, s.matriculeFo) : '',
    s.nomFo2 ? crewNameHtml(s.nomFo2, s.matriculeFo2) : '',
  ].filter(Boolean).join(' / ');
  if (fos) parts.push(`FO ${fos}`);
  return parts.join(' · ');
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
        ${crewLine(s)}
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
    <span class="chip chip-violet">TRI/TRE ${crewNameHtml(session.nomTri, session.matriculeTri)}</span>
    ${session.nomCdb ? `<span class="chip chip-info">CPT ${crewNameHtml(session.nomCdb, session.matriculeCdb)}</span>` : ''}
    ${session.nomCdb2 ? `<span class="chip chip-info">CPT 2 ${crewNameHtml(session.nomCdb2, session.matriculeCdb2)}</span>` : ''}
    ${session.nomFo ? `<span class="chip chip-teal">FO ${crewNameHtml(session.nomFo, session.matriculeFo)}</span>` : ''}
    ${session.nomFo2 ? `<span class="chip chip-teal">FO 2 ${crewNameHtml(session.nomFo2, session.matriculeFo2)}</span>` : ''}
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
        [
          s.nomTri, s.matriculeTri, s.nomCdb, s.matriculeCdb, s.nomCdb2, s.matriculeCdb2,
          s.nomFo, s.matriculeFo, s.nomFo2, s.matriculeFo2, s.date, s.creneau, s.typeTraining, s.typeSeance,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
    : sessions;

  const body = document.getElementById('sessions-body');

  const validIds = new Set(sessions.map((s) => s.id));
  selectedIds.forEach((id) => { if (!validIds.has(id)) selectedIds.delete(id); });

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="16" class="empty">Aucune séance enregistrée.</td></tr>';
    updateSelectionUi(filtered);
    return;
  }

  body.innerHTML = filtered
    .map((s) => `
    <tr data-id="${s.id}">
      <td><input type="checkbox" class="row-select" data-id="${s.id}" ${selectedIds.has(s.id) ? 'checked' : ''}></td>
      <td>${s.numero ?? '—'}</td>
      <td><span class="chip chip-red">${formatDate(s.date)}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.creneau)}">${s.creneau}</span></td>
      <td><span class="chip chip-navy">${s.heureDebut}</span></td>
      <td>${s.heureFin ? `<span class="chip chip-navy">${s.heureFin}</span>` : '—'}</td>
      <td><span class="chip chip-yellow">${formatDuration(s.date, s.heureDebut, s.heureFin)}</span></td>
      <td><span class="chip chip-violet">${crewNameHtml(s.nomTri, s.matriculeTri)}</span></td>
      <td>${s.nomCdb ? `<span class="chip chip-info">${crewNameHtml(s.nomCdb, s.matriculeCdb)}</span>` : '—'}</td>
      <td>${s.nomCdb2 ? `<span class="chip chip-info">${crewNameHtml(s.nomCdb2, s.matriculeCdb2)}</span>` : '—'}</td>
      <td>${s.nomFo ? `<span class="chip chip-teal">${crewNameHtml(s.nomFo, s.matriculeFo)}</span>` : '—'}</td>
      <td>${s.nomFo2 ? `<span class="chip chip-teal">${crewNameHtml(s.nomFo2, s.matriculeFo2)}</span>` : '—'}</td>
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
  document.getElementById('open-matriculeTri').value = '';
  document.getElementById('open-nomCdb').value = '';
  document.getElementById('open-matriculeCdb').value = '';
  document.getElementById('open-nomCdb2').value = '';
  document.getElementById('open-matriculeCdb2').value = '';
  document.getElementById('open-nomFo').value = '';
  document.getElementById('open-matriculeFo').value = '';
  document.getElementById('open-nomFo2').value = '';
  document.getElementById('open-matriculeFo2').value = '';
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
    typeTraining: document.getElementById('open-typeTraining').value,
    typeSeance: document.getElementById('open-typeSeance').value,
  };

  const missing = Object.values(payload).some((v) => !v);
  if (missing) {
    document.getElementById('open-error').textContent = 'Merci de remplir tous les champs.';
    return;
  }

  payload.nomCdb = document.getElementById('open-nomCdb').value.trim();
  payload.nomCdb2 = document.getElementById('open-nomCdb2').value.trim();
  payload.nomFo = document.getElementById('open-nomFo').value.trim();
  payload.nomFo2 = document.getElementById('open-nomFo2').value.trim();
  payload.matriculeTri = document.getElementById('open-matriculeTri').value.trim();
  payload.matriculeCdb = document.getElementById('open-matriculeCdb').value.trim();
  payload.matriculeCdb2 = document.getElementById('open-matriculeCdb2').value.trim();
  payload.matriculeFo = document.getElementById('open-matriculeFo').value.trim();
  payload.matriculeFo2 = document.getElementById('open-matriculeFo2').value.trim();

  if (!payload.nomCdb && !payload.nomCdb2 && !payload.nomFo && !payload.nomFo2) {
    document.getElementById('open-error').textContent = "Merci de renseigner au moins un membre d'équipage (CPT ou FO).";
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

  try {
    await putSession(session);
  } catch (err) {
    const reason = err && err.message ? err.message : 'erreur inconnue';
    document.getElementById('open-error').textContent = `Impossible d'enregistrer la séance sur cet appareil (${reason}).`;
    return;
  }
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
  const nameMat = (nom, mat) => (nom ? (mat ? `${nom} (${mat})` : nom) : '');
  const summaryParts = [formatDate(session.date), session.creneau, `TRI ${nameMat(session.nomTri, session.matriculeTri)}`];
  const cpts = [nameMat(session.nomCdb, session.matriculeCdb), nameMat(session.nomCdb2, session.matriculeCdb2)].filter(Boolean).join(' / ');
  if (cpts) summaryParts.push(`CPT ${cpts}`);
  const fos = [nameMat(session.nomFo, session.matriculeFo), nameMat(session.nomFo2, session.matriculeFo2)].filter(Boolean).join(' / ');
  if (fos) summaryParts.push(`FO ${fos}`);
  summaryParts.push(`${session.typeTraining}/${session.typeSeance}`);
  document.getElementById('close-summary').textContent = summaryParts.join(' · ');
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

// Nom + matricule entre parenthèses, pour les PDF (texte brut, pas de HTML).
function pdfNameMat(nom, matricule) {
  return matricule ? `${nom} (${matricule})` : nom;
}

// Mêmes couleurs que les badges à l'écran, pour que le PDF archivé reste
// cohérent avec l'application (QT rouge, REC bleu électrique, etc.).
const PDF_HEX = {
  QT: '#c7010d',
  REC: '#0066ff',
  FFS: '#ff6a00',
  FBS: '#1b7a3d',
  ouverte: '#ffab00',
  cloturee: '#00bcd4',
  S1: '#4f46e5',
  S2: '#84cc16',
  S3: '#00c853',
  S4: '#1d4ed8',
  S5: '#ff1493',
};

function badgeHex(type) {
  return PDF_HEX[type] || null;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function setPdfColor(doc, hex, fallback = [20, 24, 40]) {
  doc.setTextColor(...(hex ? hexToRgb(hex) : fallback));
}

// Version très éclaircie d'une couleur, pour servir de fond de badge sobre
// derrière un libellé (même logique que les "chips" à l'écran).
function lightenHex(hex, factor = 0.85) {
  const [r, g, b] = hexToRgb(hex);
  return [r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor];
}

// Dessine le libellé d'un champ dans un badge coloré (fond teinté + texte de
// la même couleur), comme les cases colorées de l'application. Les valeurs
// des champs restent en noir : seuls les titres portent la couleur.
function drawLabelBadge(doc, label, x, y, hex) {
  doc.setFontSize(9.5);
  const padX = 2.4;
  const w = doc.getTextWidth(label) + padX * 2;
  const h = 6.4;
  doc.setFillColor(...lightenHex(hex));
  doc.roundedRect(x, y - h + 2, w, h, 1.2, 1.2, 'F');
  doc.setTextColor(...hexToRgb(hex));
  doc.text(label, x + padX, y);
}

// Logos (icône de l'app + Air Algérie) chargés une fois au démarrage (voir
// preloadLogo) et réutilisés dans tous les PDF générés, pour que le rapport
// archivé porte les mêmes images que l'écran de connexion et l'en-tête.
let appIconDataUrl = null;
let logoDataUrl = null;

async function imageToDataUrl(path) {
  const res = await fetch(path);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function preloadLogo() {
  try {
    appIconDataUrl = await imageToDataUrl('icons/icon-192.png');
  } catch {
    appIconDataUrl = null;
  }
  try {
    logoDataUrl = await imageToDataUrl('branding/air-algerie-logo.png');
  } catch {
    logoDataUrl = null;
  }
}

// En-tête commun à tous les PDF : icône de l'app + logo Air Algérie + titre.
// Retourne le y à partir duquel le contenu spécifique doit continuer.
function drawPdfHeader(doc, x = 14, topY = 14) {
  let textX = x;

  if (appIconDataUrl) {
    const iconSize = 16;
    try {
      doc.addImage(appIconDataUrl, 'PNG', x, topY - iconSize / 2, iconSize, iconSize);
      textX = x + iconSize + 5;
    } catch {
      // icône illisible : on continue sans image
    }
  }

  if (logoDataUrl) {
    const logoW = 30;
    const logoH = logoW * (184 / 999);
    try {
      doc.addImage(logoDataUrl, 'PNG', textX, topY - logoH / 2, logoW, logoH);
      textX += logoW + 6;
    } catch {
      // logo illisible : on continue sans image
    }
  }

  doc.setFontSize(17);
  doc.setTextColor(20, 24, 40);
  doc.text('FSTD Logbook 737 NG', textX, topY + 2);
  doc.setFontSize(11);
  doc.setTextColor(100, 110, 130);
  doc.text('Registre des séances simulateur', textX, topY + 9);
  return topY + 22;
}

function drawSessionPdf(doc, session) {
  let y0 = drawPdfHeader(doc);
  doc.setFontSize(14);
  doc.setTextColor(20, 24, 40);
  doc.text(`Fiche de séance n° ${session.numero}`, 14, y0);
  y0 += 2;

  const rows = [
    ['Date', formatDate(session.date), '#c7010d'],
    ['Slot', session.creneau, badgeHex(session.creneau)],
    ['Heure de début', session.heureDebut, '#37495f'],
    ['Heure de fin', session.heureFin || '—', session.heureFin ? '#ffab00' : null],
    ['Durée', formatDuration(session.date, session.heureDebut, session.heureFin), '#eab308'],
    ['Qualification de Type', session.typeTraining, badgeHex(session.typeTraining)],
    ['Type de simulation', session.typeSeance, badgeHex(session.typeSeance)],
    ['Statut', session.status === 'cloturee' ? 'Clôturée' : 'Ouverte', badgeHex(session.status)],
    ['TRI/TRE', pdfNameMat(session.nomTri, session.matriculeTri), '#a020f0'],
  ];
  if (session.nomCdb) rows.push(['CPT', pdfNameMat(session.nomCdb, session.matriculeCdb), '#0091ff']);
  if (session.nomCdb2) rows.push(['CPT 2', pdfNameMat(session.nomCdb2, session.matriculeCdb2), '#0091ff']);
  if (session.nomFo) rows.push(['FO', pdfNameMat(session.nomFo, session.matriculeFo), '#0d9488']);
  if (session.nomFo2) rows.push(['FO 2', pdfNameMat(session.nomFo2, session.matriculeFo2), '#0d9488']);

  let y = y0 + 13;
  rows.forEach(([label, value, color]) => {
    if (color) {
      drawLabelBadge(doc, label, 14, y, color);
    } else {
      doc.setFontSize(9.5);
      doc.setTextColor(100, 110, 130);
      doc.text(label, 14, y);
    }
    doc.setFontSize(12.5);
    doc.setTextColor(20, 24, 40);
    doc.text(String(value ?? '—'), 78, y);
    y += 9;
  });

  y += 2;
  doc.setFontSize(9.5);
  doc.setTextColor(100, 110, 130);
  doc.text('Remarques', 14, y);
  y += 7;
  doc.setFontSize(11);
  doc.setTextColor(20, 24, 40);
  doc.text(doc.splitTextToSize(session.remarques || '—', 180), 14, y);
  y += 15;

  if (session.signature) {
    doc.setFontSize(9.5);
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
  const headerY = drawPdfHeader(doc);
  doc.setFontSize(11);
  doc.setTextColor(20, 24, 40);
  doc.text(title, 14, headerY - 5);

  const headers = ['N°', 'Date', 'Slot', 'Début', 'Fin', 'Durée', 'TRI', 'CPT', 'CPT 2', 'FO', 'FO 2', 'Training', 'Séance', 'Statut'];
  const colX = [14, 22, 38, 50, 62, 74, 84, 108, 132, 156, 178, 200, 216, 232];
  let y = headerY + 6;

  doc.setFontSize(8);
  doc.setTextColor(100, 110, 130);
  headers.forEach((h, i) => doc.text(h, colX[i], y));
  y += 2;
  doc.setDrawColor(210, 214, 222);
  doc.line(14, y, 250, y);
  y += 5;

  sessionsToPrint.forEach((s) => {
    if (y > 195) {
      doc.addPage('a4', 'landscape');
      y = 20;
    }
    const cells = [
      { v: s.numero, color: null },
      { v: formatDate(s.date), color: '#c7010d' },
      { v: s.creneau, color: badgeHex(s.creneau) },
      { v: s.heureDebut, color: '#37495f' },
      { v: s.heureFin || '—', color: s.heureFin ? '#ffab00' : null },
      { v: formatDuration(s.date, s.heureDebut, s.heureFin), color: '#eab308' },
      { v: s.nomTri, color: '#a020f0' },
      { v: s.nomCdb || '—', color: s.nomCdb ? '#0091ff' : null },
      { v: s.nomCdb2 || '—', color: s.nomCdb2 ? '#0091ff' : null },
      { v: s.nomFo || '—', color: s.nomFo ? '#0d9488' : null },
      { v: s.nomFo2 || '—', color: s.nomFo2 ? '#0d9488' : null },
      { v: s.typeTraining, color: badgeHex(s.typeTraining) },
      { v: s.typeSeance, color: badgeHex(s.typeSeance) },
      { v: s.status === 'cloturee' ? 'Clôturée' : 'Ouverte', color: badgeHex(s.status) },
    ];
    cells.forEach((cell, i) => {
      setPdfColor(doc, cell.color);
      doc.text(String(cell.v ?? '—'), colX[i], y, { maxWidth: (colX[i + 1] || 250) - colX[i] - 2 });
    });
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

// Supprime les séances sélectionnées qui ne sont pas clôturées ; celles déjà
// clôturées et signées doivent passer par l'administration (code requis).
async function handleDeleteSelection() {
  if (selectedIds.size === 0) return;
  const chosen = sessions.filter((s) => selectedIds.has(s.id));
  const deletable = chosen.filter((s) => s.status !== 'cloturee');
  const blocked = chosen.length - deletable.length;

  if (deletable.length === 0) {
    alert('Ces séances sont clôturées et signées : elles ne peuvent être supprimées que depuis l\'administration (code requis).');
    return;
  }

  const message = blocked > 0
    ? `Supprimer définitivement ${deletable.length} séance(s) ? ${blocked} séance(s) clôturée(s) de la sélection seront conservées (utilisez l'administration pour les supprimer).`
    : `Supprimer définitivement ${deletable.length} séance(s) ?`;
  if (!confirm(message)) return;

  for (const s of deletable) {
    await deleteSessionLocal(s.id);
    selectedIds.delete(s.id);
  }
  await renderAll();
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
  adminSelectedIds.clear();
}

function renderAdminTable() {
  const body = document.getElementById('admin-body');

  const validIds = new Set(sessions.map((s) => s.id));
  adminSelectedIds.forEach((id) => { if (!validIds.has(id)) adminSelectedIds.delete(id); });

  if (sessions.length === 0) {
    body.innerHTML = '<tr><td colspan="16" class="empty">Aucune séance enregistrée.</td></tr>';
    updateAdminSelectionUi();
    return;
  }
  body.innerHTML = sessions
    .map((s) => `
    <tr data-id="${s.id}">
      <td><input type="checkbox" class="admin-row-select" data-id="${s.id}" ${adminSelectedIds.has(s.id) ? 'checked' : ''}></td>
      <td>${s.numero ?? '—'}</td>
      <td><span class="chip chip-red">${formatDate(s.date)}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.creneau)}">${s.creneau}</span></td>
      <td><span class="chip chip-navy">${s.heureDebut}</span></td>
      <td>${s.heureFin ? `<span class="chip chip-navy">${s.heureFin}</span>` : '—'}</td>
      <td><span class="chip chip-yellow">${formatDuration(s.date, s.heureDebut, s.heureFin)}</span></td>
      <td><span class="chip chip-violet">${crewNameHtml(s.nomTri, s.matriculeTri)}</span></td>
      <td>${s.nomCdb ? `<span class="chip chip-info">${crewNameHtml(s.nomCdb, s.matriculeCdb)}</span>` : '—'}</td>
      <td>${s.nomCdb2 ? `<span class="chip chip-info">${crewNameHtml(s.nomCdb2, s.matriculeCdb2)}</span>` : '—'}</td>
      <td>${s.nomFo ? `<span class="chip chip-teal">${crewNameHtml(s.nomFo, s.matriculeFo)}</span>` : '—'}</td>
      <td>${s.nomFo2 ? `<span class="chip chip-teal">${crewNameHtml(s.nomFo2, s.matriculeFo2)}</span>` : '—'}</td>
      <td><span class="badge badge-lg ${badgeClass(s.typeTraining)}">${s.typeTraining}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.typeSeance)}">${s.typeSeance}</span></td>
      <td><span class="badge badge-lg ${badgeClass(s.status)}">${s.status === 'cloturee' ? 'Clôturée' : 'Ouverte'}</span></td>
      <td><button class="delete-btn" data-action="admin-delete" data-id="${s.id}">Suppr.</button></td>
    </tr>`)
    .join('');
  updateAdminSelectionUi();
}

function updateAdminSelectionUi() {
  const count = document.getElementById('admin-selection-count');
  const btn = document.getElementById('admin-delete-selection-btn');
  const selectAll = document.getElementById('admin-select-all');
  count.textContent = adminSelectedIds.size > 0 ? `${adminSelectedIds.size} séance(s) sélectionnée(s)` : '';
  btn.hidden = adminSelectedIds.size === 0;
  const ids = sessions.map((s) => s.id);
  const selectedInView = ids.filter((id) => adminSelectedIds.has(id));
  selectAll.checked = ids.length > 0 && selectedInView.length === ids.length;
  selectAll.indeterminate = selectedInView.length > 0 && selectedInView.length < ids.length;
}

async function handleAdminDelete(id) {
  const session = sessions.find((s) => s.id === id);
  const label = session ? `N° ${session.numero ?? '—'} (${formatDate(session.date)}, TRI ${session.nomTri})` : 'cette séance';
  if (!confirm(`Supprimer définitivement ${label} ? Cette action est irréversible, y compris pour une séance clôturée et signée.`)) return;
  await deleteSessionLocal(id);
  await renderAll();
  renderAdminTable();
}

async function handleAdminBulkDelete() {
  if (adminSelectedIds.size === 0) return;
  if (!confirm(`Supprimer définitivement ${adminSelectedIds.size} séance(s) ? Cette action est irréversible, y compris pour des séances clôturées et signées.`)) return;
  for (const id of adminSelectedIds) {
    await deleteSessionLocal(id);
  }
  adminSelectedIds.clear();
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
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const authScreen = document.getElementById('auth-screen');

    if (PASSWORDS.includes(pin)) {
      errorEl.textContent = '';
      submitBtn.classList.add('btn-loading');
      setTimeout(() => {
        sessionStorage.setItem(AUTH_KEY, '1');
        authScreen.classList.add('fade-out');
        setTimeout(() => {
          submitBtn.classList.remove('btn-loading');
          authScreen.classList.remove('fade-out');
          showAppScreen();
          renderAll();
        }, 350);
      }, 400);
    } else {
      errorEl.textContent = 'Mot de passe incorrect.';
      const card = document.querySelector('.auth-card');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
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
  document.getElementById('delete-selection-btn').addEventListener('click', handleDeleteSelection);
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
  document.getElementById('admin-body').addEventListener('change', (e) => {
    const checkbox = e.target.closest('.admin-row-select');
    if (!checkbox) return;
    if (checkbox.checked) adminSelectedIds.add(checkbox.dataset.id);
    else adminSelectedIds.delete(checkbox.dataset.id);
    updateAdminSelectionUi();
  });
  document.getElementById('admin-select-all').addEventListener('change', (e) => {
    const ids = sessions.map((s) => s.id);
    if (e.target.checked) ids.forEach((id) => adminSelectedIds.add(id));
    else ids.forEach((id) => adminSelectedIds.delete(id));
    renderAdminTable();
  });
  document.getElementById('admin-delete-selection-btn').addEventListener('click', handleAdminBulkDelete);

  setInterval(tickChronos, 1000);
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  setupSignaturePad();
  bindEvents();
  preloadLogo();

  if (checkAuth()) {
    showAppScreen();
    await renderAll();
  } else {
    showAuthScreen();
  }
}

init();
