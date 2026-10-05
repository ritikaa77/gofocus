const jwt = require('jsonwebtoken');

const COOKIE = 'gf_token';
const isProd = () => process.env.NODE_ENV === 'production';

function signIn(res, userId) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,            // JS can't read it -> XSS can't steal it
    sameSite: 'lax',           // not sent on cross-site POSTs -> basic CSRF protection
    secure: isProd(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function requireAuth(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies[COOKIE], process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Please log in' });
  }
}

const clearAuth = (res) => res.clearCookie(COOKIE);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { signIn, requireAuth, clearAuth, wrap };
