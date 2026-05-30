// src/server.js
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const app = createApp();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`devops-task-manager listening on :${PORT} (env=${process.env.NODE_ENV || 'development'})`);
});
