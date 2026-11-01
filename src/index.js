'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

const proxyRouter = require('./routes/proxy');
const metricsRouter = require('./routes/metrics');

const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// OpenAI-compatible proxy endpoints: /v1/chat/completions, /v1/completions
app.use('/v1', proxyRouter);

// Internal stats API: /api/stats
app.use('/api', metricsRouter);

// Frontend
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});
app.get('/docs', (req, res) => {
  res.sendFile(path.join(publicDir, 'developers.html'));
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'fidel-token-proxy', version: '1.0.0' });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`Fidel Token Proxy listening on http://${config.host}:${config.port}`);
  console.log(`OpenAI-compatible base URL: http://localhost:${config.port}/v1`);
  console.log(`Dashboard: http://localhost:${config.port}/`);
});

module.exports = { app, server };
