'use strict';
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Smart Campus Lost & Found listening on port ${PORT}`);
});

// Graceful shutdown so Kubernetes rollouts do not drop in-flight requests.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => { app.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
