const express = require('express');
const path = require('path');
const store = require('./store');
const users = require('./users');
const auth = require('./auth');
const mailer = require('./mailer');
const pdf = require('./pdf');

const app = express();
const PORT = process.env.PORT || 3000;

const REQUIRED_OPEN_FIELDS = ['date', 'creneau', 'heureDebut', 'nomTri', 'typeTraining', 'typeSeance'];
const TYPE_TRAINING_VALUES = ['QT', 'REC'];
const TYPE_SEANCE_VALUES = ['FFS', 'FBS'];

app.use(express.json({ limit: '5mb' })); // signature en base64
app.use(express.static(path.join(__dirname, '..', 'public')));

function validateOpen(body) {
  const errors = [];
  for (const field of REQUIRED_OPEN_FIELDS) {
    if (!body[field] || String(body[field]).trim() === '') {
      errors.push(`Le champ "${field}" est obligatoire.`);
    }
  }
  // Une séance peut n'avoir que des CPT ou que des FO (deux commandants,
  // deux copilotes) : au moins un des quatre champs doit être renseigné.
  if (![body.nomCdb, body.nomCdb2, body.nomFo, body.nomFo2].some((v) => v && String(v).trim() !== '')) {
    errors.push("Merci de renseigner au moins un membre d'équipage (CPT ou FO).");
  }
  if (body.typeTraining && !TYPE_TRAINING_VALUES.includes(body.typeTraining)) {
    errors.push('Le type de training doit être "QT" ou "REC".');
  }
  if (body.typeSeance && !TYPE_SEANCE_VALUES.includes(body.typeSeance)) {
    errors.push('Le type de séance doit être "FFS" ou "FBS".');
  }
  return errors;
}

function validateClose(body) {
  const errors = [];
  if (!body.heureFin || String(body.heureFin).trim() === '') {
    errors.push('L\'heure de fin est obligatoire.');
  }
  if (!body.signature) {
    errors.push('La signature électronique est obligatoire pour clôturer la séance.');
  }
  return errors;
}

// ---- Auth ----

// L'auto-inscription est désactivée : les comptes sont créés par un administrateur
// via `node server/seed-user.js` (voir README). La logique reste dans users.register
// pour être réactivée facilement si des comptes individuels par instructeur sont décidés.
app.post('/api/auth/register', (req, res) => {
  res.status(403).json({ errors: ["La création de compte est désactivée. Contactez l'administrateur du registre."] });
});

app.post('/api/auth/login', (req, res) => {
  const { name, pin } = req.body || {};
  const user = users.verifyLogin(name, pin);
  if (!user) {
    return res.status(401).json({ errors: ['Identifiant ou mot de passe incorrect.'] });
  }
  const token = auth.createToken(user);
  res.json({ token, user: { id: user.id, name: user.name } });
});

app.post('/api/auth/verify-pin', auth.requireAuth, (req, res) => {
  const { pin } = req.body || {};
  const user = users.findById(req.user.id);
  const ok = user && auth.verifyPin(pin, user.salt, user.hash);
  res.json({ ok: Boolean(ok) });
});

app.get('/api/auth/me', auth.requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ---- Sessions ----

app.get('/api/sessions', auth.requireAuth, (req, res) => {
  res.json(store.listSessions());
});

app.post('/api/sessions', auth.requireAuth, (req, res) => {
  const errors = validateOpen(req.body);
  if (errors.length > 0) return res.status(400).json({ errors });
  const session = store.createSession(req.body, req.user);
  res.status(201).json(session);
});

app.put('/api/sessions/:id', auth.requireAuth, (req, res) => {
  const existing = store.getSession(req.params.id);
  if (!existing) return res.status(404).json({ errors: ['Séance introuvable.'] });
  if (existing.status === 'cloturee') {
    return res.status(400).json({ errors: ['Cette séance est déjà clôturée et ne peut plus être modifiée.'] });
  }
  const errors = validateOpen({ ...existing, ...req.body });
  if (errors.length > 0) return res.status(400).json({ errors });
  const updated = store.updateSession(req.params.id, req.body);
  res.json(updated);
});

app.post('/api/sessions/:id/close', auth.requireAuth, (req, res) => {
  const existing = store.getSession(req.params.id);
  if (!existing) return res.status(404).json({ errors: ['Séance introuvable.'] });
  if (existing.status === 'cloturee') {
    return res.status(400).json({ errors: ['Cette séance est déjà clôturée.'] });
  }
  const errors = validateClose(req.body);
  if (errors.length > 0) return res.status(400).json({ errors });
  const closed = store.closeSession(req.params.id, req.body, req.user);
  res.json(closed);
});

app.delete('/api/sessions/:id', auth.requireAuth, (req, res) => {
  const existing = store.getSession(req.params.id);
  if (!existing) return res.status(404).json({ errors: ['Séance introuvable.'] });
  if (existing.status === 'cloturee') {
    return res.status(403).json({ errors: ['Cette séance est clôturée et signée : elle ne peut plus être supprimée.'] });
  }
  store.deleteSession(req.params.id);
  res.status(204).end();
});

// ---- PDF export ----

app.get('/api/sessions/:id/pdf', auth.requireAuth, async (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ errors: ['Séance introuvable.'] });
  const buffer = await pdf.sessionPdfBuffer(session);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="seance-${session.numero}.pdf"`);
  res.send(buffer);
});

app.get('/api/export/pdf', auth.requireAuth, async (req, res) => {
  const { from, to, ids } = req.query;
  let sessions = store.listSessions();
  if (ids) {
    const idSet = new Set(String(ids).split(',').filter(Boolean));
    sessions = sessions.filter((s) => idSet.has(s.id));
  } else {
    if (from) sessions = sessions.filter((s) => s.date >= from);
    if (to) sessions = sessions.filter((s) => s.date <= to);
  }
  const buffer = await pdf.registryPdfBuffer(sessions, { from, to });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="registre-fstd.pdf"');
  res.send(buffer);
});

app.post('/api/export/email', auth.requireAuth, async (req, res) => {
  const { to, from, toDate, ids } = req.body || {};
  if (!to) return res.status(400).json({ errors: ['Adresse email destinataire obligatoire.'] });

  let sessions = store.listSessions();
  if (Array.isArray(ids) && ids.length > 0) {
    const idSet = new Set(ids);
    sessions = sessions.filter((s) => idSet.has(s.id));
  } else {
    if (from) sessions = sessions.filter((s) => s.date >= from);
    if (toDate) sessions = sessions.filter((s) => s.date <= toDate);
  }

  const buffer = await pdf.registryPdfBuffer(sessions, { from, to: toDate });

  try {
    await mailer.sendPdfEmail({
      to,
      subject: 'Registre des séances simulateur — FSTD Logbook',
      text: 'Veuillez trouver ci-joint le registre des séances simulateur.',
      filename: 'registre-fstd.pdf',
      buffer,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'SMTP_NOT_CONFIGURED') {
      return res.status(501).json({
        errors: [
          "L'envoi d'email n'est pas configuré sur ce serveur (variables SMTP_HOST/SMTP_USER/SMTP_PASS manquantes). Téléchargez le PDF et envoyez-le manuellement en attendant.",
        ],
      });
    }
    res.status(500).json({ errors: ["Échec de l'envoi de l'email."] });
  }
});

// Deux comptes partagés créés au premier démarrage : un principal et un de secours
// (même registre pour les deux, au cas où le mot de passe principal poserait problème).
const DEFAULT_ACCOUNTS = [
  { name: process.env.SEED_USER_NAME || 'instructeurs', pin: process.env.SEED_USER_PASSWORD || 'FSTD-Simu-2026!' },
  { name: process.env.SEED_BACKUP_USER_NAME || 'instructeurs-secours', pin: process.env.SEED_BACKUP_USER_PASSWORD || 'FSTD-Reserve-2026!' },
];
if (users.ensureDefaultUsers(DEFAULT_ACCOUNTS)) {
  console.log('Comptes par défaut créés :', DEFAULT_ACCOUNTS.map((a) => a.name).join(', '));
}

app.listen(PORT, () => {
  console.log(`FSTD Logbook démarré sur http://localhost:${PORT}`);
});
