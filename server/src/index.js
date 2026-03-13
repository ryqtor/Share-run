/**
 * share-run deployment API server.
 *
 * Also acts as a reverse proxy: requests to
 *   http://<deploymentId>.localhost:3001
 * are proxied to the correct container port.
 */

const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const path = require('path');
const fs = require('fs-extra');
const deployRoute = require('./routes/deploy');
const deploymentStore = require('./services/deployment-store');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure directories exist
fs.ensureDirSync(path.join(__dirname, '..', 'uploads'));
fs.ensureDirSync(path.join(__dirname, '..', 'deployments'));

// ── Reverse proxy for deployed apps ──────────────────────────────────
const proxy = httpProxy.createProxyServer({ ws: true });

proxy.on('error', (err, req, res) => {
  console.error(`[proxy] ${err.message}`);
  if (res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('share-run: container is not reachable. It may still be starting.');
  }
});

// ── Express middleware ───────────────────────────────────────────────
app.use(express.json());

// ── Health check ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'share-run-server',
    version: '1.0.0',
    uptime: process.uptime(),
  });
});

// ── List deployments ─────────────────────────────────────────────────
app.get('/deployments', (req, res) => {
  res.json(deploymentStore.getAll());
});

// ── Deploy route ─────────────────────────────────────────────────────
app.use('/deploy', deployRoute);

// ── Error handler ────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message });
});

// ── HTTP server with subdomain routing ───────────────────────────────
const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0]; // strip port

  // Check if this is a subdomain request like "naseer-010-randoseru.localhost"
  const subdomainMatch = host.match(/^(.+)\.localhost$/);

  if (subdomainMatch) {
    const deploymentId = subdomainMatch[1];
    const domain = `${deploymentId}.run.dev`;
    const deployment = deploymentStore.get(domain);

    if (deployment && deployment.port) {
      // Proxy to the container
      return proxy.web(req, res, {
        target: `http://127.0.0.1:${deployment.port}`,
        changeOrigin: true,
      });
    }

    // Deployment not found
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html>
        <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa">
          <div style="text-align:center">
            <h1>🔍 Deployment not found</h1>
            <p style="color:#888">No deployment for <code>${deploymentId}</code></p>
            <p style="color:#555;font-size:14px">Use <code>share-run deploy</code> to deploy a project</p>
          </div>
        </body>
      </html>
    `);
    return;
  }

  // Regular API request → hand off to Express
  app(req, res);
});

// Handle WebSocket upgrades for proxied apps
server.on('upgrade', (req, socket, head) => {
  const host = (req.headers.host || '').split(':')[0];
  const subdomainMatch = host.match(/^(.+)\.localhost$/);

  if (subdomainMatch) {
    const deploymentId = subdomainMatch[1];
    const domain = `${deploymentId}.run.dev`;
    const deployment = deploymentStore.get(domain);

    if (deployment && deployment.port) {
      return proxy.ws(req, socket, head, {
        target: `http://127.0.0.1:${deployment.port}`,
      });
    }
  }
  socket.destroy();
});

// ── Start ────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║    🚀  share-run server  v1.0.0       ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log(`  Health:      http://localhost:${PORT}/health`);
  console.log(`  Deployments: http://localhost:${PORT}/deployments`);
  console.log('');
  console.log('  Deployed apps are accessible at:');
  console.log(`  http://<deploymentId>.localhost:${PORT}`);
  console.log('');
});

module.exports = app;
