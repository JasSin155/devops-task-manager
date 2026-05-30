// src/app.js
// Express app factory. Kept separate from server.js so tests can import the app
// without starting an HTTP listener.
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { metricsMiddleware, metricsHandler } = require('./middleware/metrics');
const authRoutes = require('./routes/auth');
const tasksRoutes = require('./routes/tasks');

function createApp() {
  const app = express();

  // --- Security middleware ----------------------------------------------------
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  // Rate limit: 100 req / minute / IP. Protects against brute-force on /login.
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // --- Observability ----------------------------------------------------------
  app.use(metricsMiddleware);

  // --- Routes -----------------------------------------------------------------
  app.get('/', (_req, res) => {
    res.json({
      name: 'devops-task-manager',
      version: process.env.APP_VERSION || 'dev',
      env: process.env.NODE_ENV || 'development',
    });
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/metrics', metricsHandler);

  app.use('/api/auth', authRoutes);
  app.use('/api/tasks', tasksRoutes);

  // --- Error handler ----------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });

  return app;
}

module.exports = { createApp };
