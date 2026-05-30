// src/routes/tasks.js
const express = require('express');
const { v4: uuid } = require('uuid');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// In-memory task store, keyed by task id.
const tasks = new Map();

router.use(authRequired);

router.get('/', (req, res) => {
  const mine = [...tasks.values()].filter((t) => t.userId === req.user.sub);
  res.json(mine);
});

router.post('/', (req, res) => {
  const { title, description } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required' });
  }
  const task = {
    id: uuid(),
    userId: req.user.sub,
    title,
    description: description || '',
    completed: false,
    createdAt: new Date().toISOString(),
  };
  tasks.set(task.id, task);
  res.status(201).json(task);
});

router.get('/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task || task.userId !== req.user.sub) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json(task);
});

router.put('/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task || task.userId !== req.user.sub) {
    return res.status(404).json({ error: 'not found' });
  }
  const { title, description, completed } = req.body || {};
  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (completed !== undefined) task.completed = Boolean(completed);
  task.updatedAt = new Date().toISOString();
  res.json(task);
});

router.delete('/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task || task.userId !== req.user.sub) {
    return res.status(404).json({ error: 'not found' });
  }
  tasks.delete(req.params.id);
  res.status(204).end();
});

router.__tasks = tasks;

module.exports = router;
