const path = require('path');
const axios = require('axios');
const fs = require('fs');
const ora = require('ora');
const chalk = require('chalk');
const chokidar = require('chokidar');
const archiver = require('archiver');
const os = require('os');
const logger = require('../utils/logger');
const { sanitize } = require('../utils/log-sanitizer');
const { detectStack } = require('../utils/detect-stack');
const { detectUser } = require('../utils/detect-user');
const { packageProject } = require('../utils/packager');

const SERVER_URL = process.env.SHARE_RUN_SERVER || 'http://localhost:3001';

/**
 * Main dev command handler (Vercel-like Watch Mode).
 */
async function dev(opts) {
  const debug = opts.debug || false;

  logger.banner();
  console.log(chalk.bold.magenta('  🛠️  DEVELOPMENT MODE'));
  console.log(chalk.dim('  Green-Blue deployment with crash protection\n'));

  const projectDir = process.cwd();
  const projectName = path.basename(projectDir)
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  const username = detectUser();
  const stack = detectStack(projectDir);
  const domain = `${username}-${projectName}.run.dev`;
  const deploymentId = `${username}-${projectName}`;

  if (stack.type === 'unknown') {
    logger.error('No package.json, next.config.js, or index.html found.');
    process.exit(1);
  }

  const { getOrPromptNgrokToken } = require('../utils/config');
  const ngrokToken = await getOrPromptNgrokToken();

  // 1. Package initial project
  logger.divider();
  const spinner3 = ora({ text: 'Packaging project…', color: 'yellow' }).start();
  let zipPath;
  try {
    zipPath = await packageProject(projectDir, () => {});
    spinner3.succeed('Packaged');
  } catch (err) {
    spinner3.fail('Failed to package');
    process.exit(1);
  }

  // 2. Upload with mode=dev
  const spinner4 = ora({ text: 'Starting Green-Blue deployment…', color: 'magenta' }).start();
  try {
    const formBoundary = '----ShareRunBoundary' + Date.now();
    const zipStream = fs.readFileSync(zipPath);

    const bodyParts = [];
    bodyParts.push(`--${formBoundary}\r\nContent-Disposition: form-data; name="username"\r\n\r\n${username}\r\n`);
    bodyParts.push(`--${formBoundary}\r\nContent-Disposition: form-data; name="projectName"\r\n\r\n${projectName}\r\n`);
    bodyParts.push(`--${formBoundary}\r\nContent-Disposition: form-data; name="stackType"\r\n\r\n${stack.type}\r\n`);
    bodyParts.push(`--${formBoundary}\r\nContent-Disposition: form-data; name="ngrokToken"\r\n\r\n${ngrokToken}\r\n`);
    bodyParts.push(`--${formBoundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\ndev\r\n`);
    bodyParts.push(`--${formBoundary}\r\nContent-Disposition: form-data; name="project"; filename="project.zip"\r\nContent-Type: application/zip\r\n\r\n`);

    const header = Buffer.from(bodyParts.join(''));
    const footer = Buffer.from(`\r\n--${formBoundary}--\r\n`);
    const body = Buffer.concat([header, zipStream, footer]);

    const response = await axios({
      method: 'POST',
      url: `${SERVER_URL}/deploy`,
      data: body,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${formBoundary}`,
        'Content-Length': body.length,
      },
      timeout: 600000, // 10 minutes — Docker builds can be slow
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      responseType: 'stream',
    });

    spinner4.succeed('Green-Blue deployment started');
    logger.divider();

    // 3. Wait for deployment to finish, with sanitized logs
    await new Promise((resolve, reject) => {
      let result = null;
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'log') {
                const cleaned = sanitize(event.message);
                if (cleaned) console.log(cleaned);
              }
              if (event.type === 'error') logger.error(event.message);
              if (event.type === 'done') result = event;
            } catch (_) {}
          }
        }
      });
      response.data.on('end', () => {
        if (result && result.message) {
          const ngrokUrl = result.message.url || '';
          const crashProtected = result.message.crashProtected || false;

          console.log('');
          console.log(chalk.bold('  ┌─────────────────────────────────────────┐'));

          if (crashProtected) {
            console.log(chalk.bold.yellow('  │  🛡️  CRASH PROTECTED                     │'));
            console.log(chalk.bold('  │  Stable link still active               │'));
          } else {
            console.log(chalk.bold.green('  │  🌍 Live Deployment                      │'));
          }

          if (ngrokUrl) {
            console.log(chalk.bold(`  │  ${chalk.underline.cyan(ngrokUrl)}`));
          }
          
          console.log(chalk.bold('  └─────────────────────────────────────────┘'));
          console.log('');
        }
        resolve();
      });
      response.data.on('error', reject);
    });

  } catch (err) {
    spinner4.fail('Dev mode start failed: ' + err.message);
    process.exit(1);
  } finally {
    try { fs.unlinkSync(zipPath); } catch (_) {}
  }

  // 4. Start File Watcher & Sanitized Live Logs
  console.log(chalk.dim('  👀 Watching for file changes…'));
  console.log(chalk.dim('  Press Ctrl+C to stop\n'));
  
  startFileWatcher({ projectDir, deploymentId });
  startSanitizedLogs({ deploymentId, debug });
}

/**
 * Streams sanitized live logs from the container.
 */
async function startSanitizedLogs({ deploymentId, debug }) {
  try {
    const response = await axios({
      method: 'GET',
      url: `${SERVER_URL}/logs/${deploymentId}`,
      responseType: 'stream',
    });

    response.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'log') {
              const cleaned = sanitize(event.message);
              if (cleaned) console.log(cleaned);
            } else if (event.type === 'error') {
              console.log(chalk.bold.red(`[ERROR] ${event.message}`));
            }
          } catch (_) {
            // raw fallback
            const cleaned = sanitize(line.slice(6));
            if (cleaned) console.log(cleaned);
          }
        }
      }
    });

    response.data.on('end', () => {
      console.log(chalk.dim('\n[Log stream ended]'));
    });
  } catch (err) {
    if (debug) console.log(chalk.dim(`  Log stream unavailable: ${err.message}`));
  }
}

/**
 * Watches the local directory and syncs changed files to the server.
 */
function startFileWatcher({ projectDir, deploymentId }) {
  let changedFiles = new Set();
  let syncTimeout = null;
  let syncing = false;          // ← lock to prevent overlapping syncs

  const FormData = require('form-data');

  const watcher = chokidar.watch('.', {
    cwd: projectDir,
    ignored: [
      /node_modules/,
      /\.git/,
      /\.env.*/,
      /dist/,
      /build/,
      /\.next/,
      /\.zip$/
    ],
    persistent: true,
    ignoreInitial: true,
  });

  const triggerSync = async () => {
    if (changedFiles.size === 0) return;
    if (syncing) {
      // Another sync is running — reschedule
      syncTimeout = setTimeout(triggerSync, 500);
      return;
    }

    syncing = true;
    const filesToSync = Array.from(changedFiles);
    changedFiles.clear();

    const timestamp = new Date().toLocaleTimeString();
    console.log(chalk.magenta(`\n[${timestamp}] 🔄 Syncing ${filesToSync.length} file(s)…`));

    let tmpDir = null;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-run-sync-'));
      const zipPath = path.join(tmpDir, 'patch.zip');

      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 1 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);

        for (const file of filesToSync) {
          const absPath = path.join(projectDir, file);
          if (fs.existsSync(absPath)) {
            archive.file(absPath, { name: file.replace(/\\/g, '/') });
          }
        }
        archive.finalize();
      });

      const formData = new FormData();
      formData.append('patch', fs.createReadStream(zipPath));

      await axios.put(`${SERVER_URL}/sync/${deploymentId}`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000,
      });

      console.log(chalk.green(`[${timestamp}] ✅ Hot-reloaded!`));
    } catch (err) {
      console.log(chalk.red(`[${timestamp}] ❌ Sync failed: ${err.message}`));
    } finally {
      syncing = false;
      // Clean up the entire temp dir
      if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  };

  const queueFile = (filePath) => {
    changedFiles.add(filePath);
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(triggerSync, 300);
  };

  watcher
    .on('add', queueFile)
    .on('change', queueFile)
    .on('unlink', queueFile)
    .on('error', (err) => {
      console.log(chalk.dim(`  [watcher] error: ${err.message}`));
    });
}

module.exports = dev;
