const PDFDocument = require('pdfkit');

function bufferFromDoc(doc) {
  return new Promise((resolve) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
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

function drawHeader(doc, title) {
  doc.fontSize(18).fillColor('#101828').text('FSTD Logbook', { continued: false });
  doc.fontSize(11).fillColor('#667085').text('Registre des séances simulateur');
  doc.moveDown(0.5);
  doc.fontSize(14).fillColor('#101828').text(title);
  doc.moveDown(1);
}

function labelValue(doc, label, value, opts = {}) {
  doc.fontSize(9).fillColor('#667085').text(label, opts);
  doc.fontSize(12).fillColor('#101828').text(value || '—');
  doc.moveDown(0.6);
}

async function sessionPdfBuffer(session) {
  const doc = new PDFDocument({ margin: 50 });
  const bufferPromise = bufferFromDoc(doc);

  drawHeader(doc, `Fiche de séance n° ${session.numero}`);

  const col1 = doc.page.margins.left;
  const col2 = doc.page.width / 2;
  const topY = doc.y;

  doc.x = col1;
  doc.y = topY;
  labelValue(doc, 'Date de la séance', formatDate(session.date));
  labelValue(doc, 'Créneau', session.creneau);
  labelValue(doc, 'Heure de début', session.heureDebut);
  labelValue(doc, 'Heure de fin', session.heureFin);
  labelValue(doc, 'Durée', formatDuration(session.date, session.heureDebut, session.heureFin));

  doc.x = col2;
  doc.y = topY;
  labelValue(doc, 'Type de training', session.typeTraining);
  labelValue(doc, 'Type de séance', session.typeSeance);
  labelValue(doc, 'Statut', session.status === 'cloturee' ? 'Clôturée' : 'Ouverte');

  doc.x = col1;
  doc.y = Math.max(doc.y, topY + 5 * 40) + 10;

  labelValue(doc, 'TRI (instructeur)', session.nomTri);
  labelValue(doc, 'CDB', session.nomCdb);
  labelValue(doc, 'FO', session.nomFo);

  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#667085').text('Remarques');
  doc.fontSize(11).fillColor('#101828').text(session.remarques || '—', { width: doc.page.width - 100 });
  doc.moveDown(1);

  doc.fontSize(9).fillColor('#667085').text(
    `Ouverte par ${session.openedByName || '—'}` +
    (session.closedByName ? ` · Clôturée par ${session.closedByName}` : '')
  );

  if (session.signature) {
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#667085').text('Signature électronique');
    try {
      const base64 = session.signature.split(',')[1];
      const imgBuffer = Buffer.from(base64, 'base64');
      doc.image(imgBuffer, { width: 180 });
    } catch {
      doc.fontSize(10).fillColor('#101828').text('(signature illisible)');
    }
  }

  doc.end();
  return bufferPromise;
}

async function registryPdfBuffer(sessions, { from, to } = {}) {
  const doc = new PDFDocument({ margin: 40, layout: 'landscape' });
  const bufferPromise = bufferFromDoc(doc);

  const title = from || to
    ? `Registre des séances (${from ? formatDate(from) : '…'} → ${to ? formatDate(to) : '…'})`
    : 'Registre complet des séances';
  drawHeader(doc, title);

  const headers = ['N°', 'Date', 'Créneau', 'Début', 'Fin', 'Durée', 'TRI', 'CDB', 'FO', 'Training', 'Séance', 'Statut'];
  const widths = [30, 60, 45, 40, 40, 45, 85, 85, 85, 55, 50, 60];
  let y = doc.y;
  const startX = doc.page.margins.left;

  function drawRow(values, opts = {}) {
    let x = startX;
    doc.fontSize(9).fillColor(opts.header ? '#667085' : '#101828');
    values.forEach((v, i) => {
      doc.text(String(v ?? ''), x, y, { width: widths[i], ellipsis: true });
      x += widths[i];
    });
    y += 18;
  }

  drawRow(headers, { header: true });
  doc.moveTo(startX, y - 4).lineTo(startX + widths.reduce((a, b) => a + b, 0), y - 4).strokeColor('#dde1e6').stroke();

  sessions.forEach((s) => {
    if (y > doc.page.height - doc.page.margins.bottom) {
      doc.addPage({ margin: 40, layout: 'landscape' });
      y = doc.page.margins.top;
    }
    drawRow([
      s.numero,
      formatDate(s.date),
      s.creneau,
      s.heureDebut,
      s.heureFin || '—',
      formatDuration(s.date, s.heureDebut, s.heureFin),
      s.nomTri,
      s.nomCdb,
      s.nomFo,
      s.typeTraining,
      s.typeSeance,
      s.status === 'cloturee' ? 'Clôturée' : 'Ouverte',
    ]);
  });

  doc.end();
  return bufferPromise;
}

module.exports = { sessionPdfBuffer, registryPdfBuffer };
