const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { extractArchive } = require('../services/extractor');
const { detectStack } = require('../services/detector');
const { buildAndRun } = require('../services/builder');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, '..', '..', 'uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

/**
 * POST /deploy
 *
 * Accepts a multipart upload with:
 *   - project    (file)  — zip archive of the project
 *   - username   (field) — GitHub username
 *   - projectName(field) — project directory name
 *   - stackType  (field) — detected stack type from CLI
 *
 * Responds with SSE (Server-Sent Events) stream of deployment logs.
 */
router.post('/', upload.single('project'), async (req, res) => {
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (type, message) => {
    const data = JSON.stringify({ type, message });
    res.write(`data: ${data}\n\n`);
  };

  const log = (message) => send('log', message);

  try {
    const { username, projectName, stackType } = req.body;

    if (!req.file) {
      send('error', 'No project archive uploaded');
      res.end();
      return;
    }

    if (!username || !projectName) {
      send('error', 'Missing username or projectName');
      res.end();
      return;
    }

    const deploymentId = `${username}-${projectName}`;
    const domain = `${deploymentId}.run.dev`;
    const containerName = `sharerun-${deploymentId}`;

    log(`👤 Username: ${username}`);
    log(`📁 Project: ${projectName}`);
    log(`🔗 Domain: ${domain}`);
    log('');

    // 1. Extract archive
    const projectDir = await extractArchive(req.file.path, deploymentId, log);
    log('');

    // 2. Verify stack detection on server side
    const serverStack = detectStack(projectDir);
    const finalStack = stackType || serverStack.type;
    log(`🔍 Stack verified: ${serverStack.label} (using: ${finalStack})`);
    log('');

    // 3. Build and run Docker container
    log('🐳 Starting Docker build…');
    const result = await buildAndRun({
      projectDir,
      stackType: finalStack,
      domain,
      containerName,
      log,
    });

    log('');
    log(`✅ Container running on port ${result.port}`);

    // 4. Create a public ngrok tunnel
    const { createTunnel } = require('../services/tunnel');
    let publicUrl = '';
    try {
      const tunnelResult = await createTunnel(result.port, deploymentId, log, req.body.ngrokToken);
      publicUrl = tunnelResult.url;
    } catch (tunnelErr) {
      log(`⚠️  Tunnel failed: ${tunnelErr.message}`);
      log(`   Please ensure you provided a valid ngrok Auth Token in the CLI.`);
      log(`   Falling back to local: http://localhost:${result.port}`);
      publicUrl = `http://localhost:${result.port}`;
    }

    log('');
    log(`🌍 Public URL: ${publicUrl}`);

    // 5. Send completion event
    send('done', {
      url: publicUrl,
      directUrl: `http://localhost:${result.port}`,
      port: result.port,
      containerId: result.containerId,
      domain,
    });

    // Clean up uploaded zip
    try {
      const fs = require('fs-extra');
      await fs.remove(req.file.path);
    } catch (_) {}
  } catch (err) {
    console.error('Deploy error:', err);
    send('error', `Deployment failed: ${err.message}`);
  }

  res.end();
});

module.exports = router;
