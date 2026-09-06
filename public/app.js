const form = document.getElementById('session-form');
const formTitle = document.getElementById('form-title');
const submitBtn = document.getElementById('submit-btn');
const cancelEditBtn = document.getElementById('cancel-edit');
const formError = document.getElementById('form-error');
const sessionsBody = document.getElementById('sessions-body');
const searchInput = document.getElementById('search');

const FIELDS = [
  'date',
  'creneau',
  'heureDebut',
  'heureFin',
  'nomTri',
  'nomCdb',
  'nomFo',
  'typeTraining',
  'typeSeance',
];

let sessions = [];
let editingId = null;

function readForm() {
  const data = {};
  for (const field of FIELDS) {
    data[field] = document.getElementById(field).value.trim();
  }
  return data;
}

function fillForm(session) {
  for (const field of FIELDS) {
    document.getElementById(field).value = session[field] || '';
  }
}

function resetForm() {
  form.reset();
  editingId = null;
  formTitle.textContent = 'Nouvelle séance';
  submitBtn.textContent = 'Enregistrer la séance';
  cancelEditBtn.hidden = true;
  formError.textContent = '';
}

function startEdit(session) {
  editingId = session.id;
  fillForm(session);
  formTitle.textContent = 'Modifier la séance';
  submitBtn.textContent = 'Mettre à jour';
  cancelEditBtn.hidden = false;
  formError.textContent = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function badgeClass(type) {
  return {
    QT: 'badge-qt',
    REC: 'badge-rec',
    FFS: 'badge-ffs',
    FBS: 'badge-fbs',
  }[type] || '';
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function renderSessions() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = query
    ? sessions.filter((s) =>
        [s.nomTri, s.nomCdb, s.nomFo, s.date, s.creneau, s.typeTraining, s.typeSeance]
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
    : sessions;

  if (filtered.length === 0) {
    sessionsBody.innerHTML = '<tr><td colspan="10" class="empty">Aucune séance enregistrée.</td></tr>';
    return;
  }

  sessionsBody.innerHTML = filtered
    .map(
      (s) => `
    <tr data-id="${s.id}">
      <td>${formatDate(s.date)}</td>
      <td>${s.creneau}</td>
      <td>${s.heureDebut}</td>
      <td>${s.heureFin}</td>
      <td>${escapeHtml(s.nomTri)}</td>
      <td>${escapeHtml(s.nomCdb)}</td>
      <td>${escapeHtml(s.nomFo)}</td>
      <td><span class="badge ${badgeClass(s.typeTraining)}">${s.typeTraining}</span></td>
      <td><span class="badge ${badgeClass(s.typeSeance)}">${s.typeSeance}</span></td>
      <td>
        <div class="row-actions">
          <button class="edit-btn" data-action="edit" data-id="${s.id}">Modifier</button>
          <button class="delete-btn" data-action="delete" data-id="${s.id}">Supprimer</button>
        </div>
      </td>
    </tr>`
    )
    .join('');
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function loadSessions() {
  const res = await fetch('/api/sessions');
  sessions = await res.json();
  renderSessions();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';
  const data = readForm();

  const url = editingId ? `/api/sessions/${editingId}` : '/api/sessions';
  const method = editingId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ errors: ['Erreur inconnue.'] }));
    formError.textContent = (body.errors || []).join('\n');
    return;
  }

  resetForm();
  await loadSessions();
});

cancelEditBtn.addEventListener('click', resetForm);

sessionsBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const session = sessions.find((s) => s.id === id);

  if (btn.dataset.action === 'edit') {
    startEdit(session);
  } else if (btn.dataset.action === 'delete') {
    if (!confirm('Supprimer cette séance du registre ?')) return;
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (editingId === id) resetForm();
      await loadSessions();
    }
  }
});

searchInput.addEventListener('input', renderSessions);

loadSessions();
