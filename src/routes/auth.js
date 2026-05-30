// src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { signToken } = require('../middleware/auth');

const router = express.Router();

// In-memory user store. Suitable for the pipeline demo; swap for a real DB in
// a production system.
const users = new Map(); // username -> { id, username, passwordHash }

router.post('/register', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'username and password (min 6 chars) are required' });
    }
    if (users.has(username)) {
      return res.status(409).json({ error: 'username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = { id: uuid(), username, passwordHash };
    users.set(username, user);
    return res.status(201).json({ id: user.id, username: user.username });
  } catch (e) {
    next(e);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const user = users.get(username);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = signToken({ sub: user.id, username: user.username });
    return res.json({ token });
  } catch (e) {
    next(e);
  }
});

// Export users map so tests can reset state.
router.__users = users;

module.exports = router;
