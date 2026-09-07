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

// Mêmes couleurs que les badges de l'application, pour que le PDF archivé
// reste cohérent avec l'écran (QT rouge, REC bleu électrique, etc.).
const BADGE_HEX = {
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
  return BADGE_HEX[type] || '#101828';
}

// Version très éclaircie d'une couleur, pour servir de fond de badge sobre
// derrière un libellé (même logique que les "chips" à l'écran).
function lightenHex(hex, factor = 0.85) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const round = (c) => Math.round(c + (255 - c) * factor);
  return `#${[round(r), round(g), round(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// Dessine un champ : le libellé dans un badge coloré (fond teinté, texte de
// la même couleur) et la valeur en noir juste en dessous, dans une police
// plus grande. Retourne le y de départ de la ligne suivante.
function drawField(doc, x, y, label, value, color) {
  doc.fontSize(9.5);
  if (color) {
    const padX = 4;
    const w = doc.widthOfString(label) + padX * 2;
    doc.roundedRect(x, y, w, 14, 3).fill(lightenHex(color));
    doc.fillColor(color).text(label, x + padX, y + 3, { lineBreak: false });
  } else {
    doc.fillColor('#667085').text(label, x, y, { lineBreak: false });
  }
  doc.fontSize(13).fillColor('#101828').text(value || '—', x, y + 17, { lineBreak: false });
  return y + 42;
}

async function sessionPdfBuffer(session) {
  const doc = new PDFDocument({ margin: 50 });
  const bufferPromise = bufferFromDoc(doc);

  drawHeader(doc, `Fiche de séance n° ${session.numero}`);

  const col1 = doc.page.margins.left;
  const col2 = doc.page.width / 2;
  const topY = doc.y;

  let y1 = topY;
  y1 = drawField(doc, col1, y1, 'Date de la séance', formatDate(session.date), null);
  y1 = drawField(doc, col1, y1, 'Slot', session.creneau, badgeHex(session.creneau));
  y1 = drawField(doc, col1, y1, 'Heure de début', session.heureDebut, '#37495f');
  y1 = drawField(doc, col1, y1, 'Heure de fin', session.heureFin, session.heureFin ? '#ffab00' : null);
  y1 = drawField(doc, col1, y1, 'Durée', formatDuration(session.date, session.heureDebut, session.heureFin), null);

  let y2 = topY;
  y2 = drawField(doc, col2, y2, 'Qualification de Type', session.typeTraining, badgeHex(session.typeTraining));
  y2 = drawField(doc, col2, y2, 'Type de simulation', session.typeSeance, badgeHex(session.typeSeance));
  y2 = drawField(doc, col2, y2, 'Statut', session.status === 'cloturee' ? 'Clôturée' : 'Ouverte', badgeHex(session.status));

  let y3 = Math.max(y1, y2) + 10;
  y3 = drawField(doc, col1, y3, 'TRI/TRE (instructeur)', session.nomTri, '#a020f0');
  y3 = drawField(doc, col1, y3, 'CPT', session.nomCdb, '#0091ff');
  y3 = drawField(doc, col1, y3, 'FO', session.nomFo, '#00c2a8');

  doc.x = col1;
  doc.y = y3 + 6;
  doc.fontSize(9.5).fillColor('#667085').text('Remarques');
  doc.fontSize(11).fillColor('#101828').text(session.remarques || '—', { width: doc.page.width - 100 });
  doc.moveDown(1);

  doc.fontSize(9.5).fillColor('#667085').text(
    `Ouverte par ${session.openedByName || '—'}` +
    (session.closedByName ? ` · Clôturée par ${session.closedByName}` : '')
  );

  if (session.signature) {
    doc.moveDown(1);
    doc.fontSize(9.5).fillColor('#667085').text('Signature électronique');
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

  const headers = ['N°', 'Date', 'Slot', 'Début', 'Fin', 'Durée', 'TRI', 'CPT', 'FO', 'Training', 'Séance', 'Statut'];
  const widths = [30, 60, 45, 40, 40, 45, 85, 85, 85, 55, 50, 60];
  let y = doc.y;
  const startX = doc.page.margins.left;

  function drawRow(values, opts = {}) {
    let x = startX;
    const colors = opts.colors || [];
    values.forEach((v, i) => {
      doc.fontSize(9).fillColor(opts.header ? '#667085' : (colors[i] || '#101828'));
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
    drawRow(
      [
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
      ],
      {
        colors: [
          null,
          null,
          badgeHex(s.creneau),
          '#37495f',
          s.heureFin ? '#ffab00' : null,
          null,
          '#a020f0',
          '#0091ff',
          '#00c2a8',
          badgeHex(s.typeTraining),
          badgeHex(s.typeSeance),
          badgeHex(s.status),
        ],
      }
    );
  });

  doc.end();
  return bufferPromise;
}

module.exports = { sessionPdfBuffer, registryPdfBuffer };
