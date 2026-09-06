const crypto = require('crypto');

const SECRET = process.env.AUTH_SECRET || 'fstd-logbook-dev-secret-change-me';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours (usage tablette partagée, hors-ligne)

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function createToken(user) {
  return sign({ sub: user.id, name: user.name, exp: Date.now() + TOKEN_TTL_MS });
}

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPin(pin, salt, hash) {
  const { hash: candidate } = hashPin(pin, salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ errors: ['Authentification requise.'] });
  }
  req.user = { id: payload.sub, name: payload.name };
  next();
}

module.exports = { createToken, verify, hashPin, verifyPin, requireAuth };
