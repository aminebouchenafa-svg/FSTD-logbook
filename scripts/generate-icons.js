// Génère des icônes PNG (sans dépendance externe) pour la PWA : fond bleu nuit,
// cercle clair, avion en papier stylisé. Exécuté une fois via `node scripts/generate-icons.js`.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
const BG = [16, 24, 40]; // #101828
const CIRCLE = [29, 78, 216]; // #1d4ed8
const PLANE = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function generatePng(size) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;

  // Triangle "avion en papier" pointant vers le haut-droit.
  const ax = size * 0.30, ay = size * 0.68;
  const bx = size * 0.74, by = size * 0.30;
  const ccx = size * 0.46, ccy = size * 0.50;

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    let offset = y * (1 + size * 4);
    raw[offset] = 0; // filtre "none"
    offset += 1;
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      let rgb = BG;
      if (dx * dx + dy * dy <= radius * radius) {
        rgb = CIRCLE;
        if (pointInTriangle(x, y, ax, ay, bx, by, ccx, ccy)) {
          rgb = PLANE;
        }
      }
      const i = offset + x * 4;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
      raw[i + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of [180, 192, 512]) {
  const png = generatePng(size);
  fs.writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), png);
  console.log(`icon-${size}.png généré (${png.length} octets)`);
}
