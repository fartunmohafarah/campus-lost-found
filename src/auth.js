'use strict';
const jwt = require('jsonwebtoken');

function signToken(user, secret) {
  return jwt.sign({ sub: user.user_id, role: user.role }, secret, { expiresIn: '8h' });
}

function authMiddleware(db, secret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required.' });
    try {
      const payload = jwt.verify(token, secret);
      // Always re-read the user so role changes / disabled accounts apply immediately.
      const user = db.prepare('SELECT user_id, name, email, role, department, status FROM users WHERE user_id = ?').get(payload.sub);
      if (!user || user.status !== 'active') return res.status(401).json({ error: 'Account is not active.' });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

module.exports = { signToken, authMiddleware, requireRole };
