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
      } else {
        // 6. Compilation FAILED → DON'T touch stable
        console.log(`[SYNC] ⨯ Compilation FAILED → STABLE untouched (ngrok link safe)`);
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

    res.json({ success: true });
  } catch (err) {
    console.error(`[SYNC ERROR] ${deploymentId}:`, err.message);
    res.status(500).json({ error: err.message });
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
 * Watch container logs for ~10s looking for compilation result.
 * Returns 'ok' if compiled successfully, 'fail' if error detected.
 */
function waitForCompilationResult(container, timeout = 10000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve('ok'); } // timeout = assume ok
    }, timeout);

    container.logs({ follow: true, stdout: true, stderr: true, tail: 0 })
      .then((stream) => {
        stream.on('data', (chunk) => {
          if (done) return;
          const text = chunk.toString().toLowerCase();

          // Success signals
          if (text.includes('compiled') || text.includes('ready') || text.includes('compiling /')) {
            done = true; clearTimeout(timer); stream.destroy(); resolve('ok');
          }
          // Failure signals
          if (text.includes('failed to compile') || text.includes('syntax error') ||
              text.includes('module not found') || text.includes('error occurred')) {
            done = true; clearTimeout(timer); stream.destroy(); resolve('fail');
          }
        });
      })
      .catch(() => { if (!done) { done = true; resolve('ok'); } });
  });
}

module.exports = router;
