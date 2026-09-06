const express = require('express');
const path = require('path');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;

const REQUIRED_FIELDS = [
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

const TYPE_TRAINING_VALUES = ['QT', 'REC'];
const TYPE_SEANCE_VALUES = ['FFS', 'FBS'];

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function validateSession(body) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || String(body[field]).trim() === '') {
      errors.push(`Le champ "${field}" est obligatoire.`);
    }
  }
  if (body.typeTraining && !TYPE_TRAINING_VALUES.includes(body.typeTraining)) {
    errors.push('Le type de training doit être "QT" ou "REC".');
  }
  if (body.typeSeance && !TYPE_SEANCE_VALUES.includes(body.typeSeance)) {
    errors.push('Le type de séance doit être "FFS" ou "FBS".');
  }
  if (body.heureDebut && body.heureFin && body.heureFin <= body.heureDebut) {
    errors.push("L'heure de fin doit être après l'heure de début.");
  }
  return errors;
}

app.get('/api/sessions', (req, res) => {
  res.json(store.listSessions());
});

app.post('/api/sessions', (req, res) => {
  const errors = validateSession(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  const session = store.createSession(req.body);
  res.status(201).json(session);
});

app.put('/api/sessions/:id', (req, res) => {
  const errors = validateSession(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  const updated = store.updateSession(req.params.id, req.body);
  if (!updated) {
    return res.status(404).json({ errors: ['Séance introuvable.'] });
  }
  res.json(updated);
});

app.delete('/api/sessions/:id', (req, res) => {
  const deleted = store.deleteSession(req.params.id);
  if (!deleted) {
    return res.status(404).json({ errors: ['Séance introuvable.'] });
  }
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`FSTD Logbook démarré sur http://localhost:${PORT}`);
});
