const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs-extra');
const Docker   = require('dockerode');
const unzipper = require('unzipper');
const archiver = require('archiver');
const deploymentStore = require('../services/deployment-store');

const router = express.Router();
const docker = new Docker();

const upload = multer({
  dest: path.join(__dirname, '..', '..', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * PUT /sync/:deploymentId
 *
 * Anti-Crash Hot-Reload:
 *   1. Inject changed files into DEV container (port 5000)
 *   2. Watch DEV logs for compilation result
 *   3. If "compiled successfully" → inject same files into STABLE (5001)
 *   4. If "error" → DON'T touch STABLE → ngrok link stays on last working version
 */
router.put('/:deploymentId', upload.single('patch'), async (req, res) => {
  const { deploymentId } = req.params;
  const domain = `${deploymentId}.run.dev`;

  if (!req.file) return res.status(400).json({ error: 'No patch archive' });

  try {
    const deployment = deploymentStore.get(domain);
    if (!deployment || !deployment.containerId) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    // 1. Extract zip to temp dir
    const tmp = path.join(__dirname, '..', '..', 'uploads', `sync-${Date.now()}`);
    await fs.ensureDir(tmp);
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(unzipper.Extract({ path: tmp }))
        .on('close', resolve)
        .on('error', reject);
    });

    // 2. Save to host dir (persistence for rebuilds)
    const deployDir = path.join(__dirname, '..', '..', 'deployments', deploymentId);
    await fs.copy(tmp, deployDir, { overwrite: true });

    // 3. Inject into DEV container first
    const devContainerId = deployment.devContainerId;
    const stableContainerId = deployment.containerId;

    if (devContainerId) {
      // ── ANTI-CRASH MODE ────────────────────────────────────────────
      const devContainer = docker.getContainer(devContainerId);
      await injectTar(devContainer, tmp);
      console.log(`[SYNC] 📦 Injected into DEV — waiting for compilation…`);

      // 4. Watch DEV logs for result
      const result = await waitForCompilationResult(devContainer);

      if (result === 'ok') {
        // 5. Compilation OK → promote to STABLE
        const stableContainer = docker.getContainer(stableContainerId);
        await injectTar(stableContainer, tmp);
        console.log(`[SYNC] ✅ Compiled OK → promoted to STABLE (port 5001)`);

        await fs.remove(req.file.path);
        await fs.remove(tmp);
        return res.json({ accepted: true, message: 'Change accepted — live on stable link' });
      } else {
        // 6. Compilation FAILED → DON'T touch stable
        console.log(`[SYNC] ⨯ Compilation FAILED → STABLE untouched (ngrok link safe)`);

        await fs.remove(req.file.path);
        await fs.remove(tmp);
        return res.json({ accepted: false, message: 'Syntax error detected — stable link protected' });
      }
    } else {
      // ── SINGLE CONTAINER (fallback) ────────────────────────────────
      const container = docker.getContainer(stableContainerId);
      await injectTar(container, tmp);
      console.log(`[SYNC] ✅ Injected into container — hot-reload triggered`);
    }

    // Cleanup
    await fs.remove(req.file.path);
    await fs.remove(tmp);

    res.json({ accepted: true, message: 'Hot-reloaded' });
  } catch (err) {
    console.error(`[SYNC ERROR] ${deploymentId}:`, err.message);
    res.status(500).json({ accepted: false, error: err.message });
  }

});

/** Inject a directory as a tar into a container at /app */
function injectTar(container, sourceDir) {
  return new Promise((resolve, reject) => {
    const tar = archiver('tar', { gzip: false });
    tar.directory(sourceDir, false);
    tar.finalize();
    container.putArchive(tar, { path: '/app' }).then(resolve).catch(reject);
  });
}

/**
 * Watch container logs looking for compilation result.
 * SAFE DEFAULT: if unsure, returns 'fail' to protect stable link.
 */
function waitForCompilationResult(container, timeout = 15000) {
  return new Promise((resolve) => {
    let done = false;

    // SAFE DEFAULT: timeout = REJECT (don't promote if unsure)
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        console.log('[SYNC] ⏱️  Timeout — no clear success signal → rejecting to be safe');
        resolve('fail');
      }
    }, timeout);

    container.logs({ follow: true, stdout: true, stderr: true, tail: 0 })
      .then((stream) => {
        stream.on('data', (chunk) => {
          if (done) return;
          const text = chunk.toString().toLowerCase();

          // ── CHECK ERRORS FIRST (before success) ──────────────────────
          const errorPatterns = [
            'failed to compile',
            'syntax error',
            'parsing ecmascript source code failed',
            'parsing failed',
            'expression expected',
            'unexpected token',
            'unexpected end',
            'module not found',
            'error occurred',
            'build error',
            'type error',
            'reference error',
            'cannot find module',
          ];

          for (const pattern of errorPatterns) {
            if (text.includes(pattern)) {
              done = true; clearTimeout(timer); stream.destroy();
              console.log(`[SYNC] 🔍 Detected error pattern: "${pattern}"`);
              resolve('fail');
              return;
            }
          }

          // ── SUCCESS SIGNALS (only explicit positive ones) ────────────
          const successPatterns = [
            'compiled client',       // Next.js Turbopack
            'compiled server',       // Next.js Turbopack
            'compiled successfully',
            'ready in',              // "Ready in 2.3s"
            'compiled /',            // "Compiling /page..."  then "Compiled /"
          ];

          for (const pattern of successPatterns) {
            if (text.includes(pattern)) {
              done = true; clearTimeout(timer); stream.destroy();
              resolve('ok');
              return;
            }
          }
        });
      })
      .catch(() => {
        if (!done) { done = true; resolve('fail'); }
      });
  });
}

module.exports = router;
