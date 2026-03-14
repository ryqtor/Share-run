const express = require('express');
const multer = require('multer');
const path = require('path');
const Docker = require('dockerode');
const { extractArchive } = require('../services/extractor');
const { detectStack } = require('../services/detector');
const { buildAndRun } = require('../services/builder');
const deploymentStore = require('../services/deployment-store');
const { sanitize } = require('../utils/log-sanitizer');

const router = express.Router();
const docker = new Docker();

const upload = multer({
  dest: path.join(__dirname, '..', '..', 'uploads'),
  limits: { fileSize: 100 * 1024 * 1024 },
});

router.post('/', upload.single('project'), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (type, message) => {
    const data = JSON.stringify({ type, message });
    res.write(`data: ${data}\n\n`);
  };
  const log = (msg) => { const c = sanitize(msg); if (c !== null) send('log', c); };

  try {
    const { username, projectName, stackType, mode } = req.body;
    if (!req.file || !username || !projectName) { send('error', 'Missing fields'); return res.end(); }

    const deploymentId = `${username}-${projectName}`;
    const domain       = `${deploymentId}.run.dev`;
    const containerName = `sharerun-${deploymentId}`;

    log(`👤 Username: ${username}`);
    log(`📁 Project: ${projectName}`);
    log(`🔗 Domain: ${domain}`);

    const projectDir = await extractArchive(req.file.path, deploymentId, log);
    const serverStack = detectStack(projectDir);
    const finalStack  = stackType || serverStack.type;
    log(`🔍 Stack verified: ${serverStack.label} (using: ${finalStack})`);

    // ── Build & start ONE container ──────────────────────────────────
    const result = await buildAndRun({
      projectDir,
      stackType: finalStack,
      domain,
      containerName,
      mode: mode || 'prod',
      log,
    });

    // ── Wait for "Ready" signal so we know the app is live ───────────
    log('⏳ Waiting for app to become ready…');
    const isReady = await waitForReady(result.containerId, log);
    if (isReady) {
      log('🎉 App is READY!');
    } else {
      log('⚠️  App has not signaled "Ready" yet — it may still be starting.');
    }

    // ── Create ngrok tunnel ──────────────────────────────────────────
    const { createTunnel } = require('../services/tunnel');
    let publicUrl = `http://localhost:${result.port}`;
    try {
      const t = await createTunnel(result.port, deploymentId, log, req.body.ngrokToken);
      publicUrl = t.url;
    } catch (e) {
      log(`⚠️  Tunnel: ${e.message}`);
    }

    log(`🌍 Public URL: ${publicUrl}`);
    send('done', { url: publicUrl, directUrl: `http://localhost:${result.port}`, domain });

  } catch (err) {
    send('error', `Deployment failed: ${err.message}`);
  } finally {
    try { const fse = require('fs-extra'); if (req.file) await fse.remove(req.file.path); } catch (_) {}
  }
  res.end();
});

/* ── wait until the container logs contain a "ready" keyword ──────── */
function waitForReady(containerId, log, timeoutMs = 120000) {
  return new Promise((resolve) => {
    if (!containerId) return resolve(false);
    const container = docker.getContainer(containerId);
    let done = false, stream = null;

    const timer = setTimeout(() => {
      if (!done) { done = true; if (stream) stream.destroy(); resolve(false); }
    }, timeoutMs);

    container.logs({ follow: true, stdout: true, stderr: true, tail: 0 })
      .then((s) => {
        stream = s;
        s.on('data', (chunk) => {
          if (done) return;
          const t = chunk.toString().toLowerCase();
          if (t.includes('ready') || t.includes('started') || t.includes('listening') || t.includes('compiled')) {
            done = true; clearTimeout(timer); s.destroy(); resolve(true);
          }
        });
      })
      .catch(() => resolve(false));
  });
}

module.exports = router;
