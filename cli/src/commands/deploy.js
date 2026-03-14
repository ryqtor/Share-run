const path = require('path');
const axios = require('axios');
const fs = require('fs');
const ora = require('ora');
const chalk = require('chalk');
const logger = require('../utils/logger');
const { sanitize } = require('../utils/log-sanitizer');
const { detectStack } = require('../utils/detect-stack');
const { detectUser } = require('../utils/detect-user');
const { packageProject } = require('../utils/packager');

const SERVER_URL = process.env.SHARE_RUN_SERVER || 'http://localhost:3001';

/**
 * Main deploy command handler.
 *
 * @param {object} opts — commander options (debug, watch)
 */
async function deploy(opts) {
  const debug = opts.debug || false;

  logger.banner();

  const projectDir = process.cwd();
  const projectName = path.basename(projectDir)
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  // 1. Detect GitHub username
  const spinner1 = ora({ text: 'Detecting GitHub user…', color: 'cyan' }).start();
  const username = detectUser();
  spinner1.succeed(`GitHub user detected: ${username}`);
  logger.step('👤', `GitHub user: ${username}`);

  // 2. Detect project type
  const spinner2 = ora({ text: 'Detecting project stack…', color: 'cyan' }).start();
  const stack = detectStack(projectDir);
  if (stack.type === 'unknown') {
    spinner2.fail('Could not detect project type');
    logger.error('No package.json, next.config.js, or index.html found.');
    logger.error('Make sure you run share-run inside a project directory.');
    process.exit(1);
  }
  spinner2.succeed(`Stack detected: ${stack.label}`);
  logger.step(stack.icon, `Stack: ${stack.label}`);

  // 3. Generate domain
  const domain = `${username}-${projectName}.run.dev`;
  logger.step('📁', `Project: ${projectName}`);
  logger.step('🔗', `Domain: ${domain}`);

  if (debug) {
    logger.divider();
    logger.info(`Server URL: ${SERVER_URL}`);
    logger.info(`Project dir: ${projectDir}`);
  }
  const { getOrPromptNgrokToken } = require('../utils/config');
  const ngrokToken = await getOrPromptNgrokToken();
  if (!ngrokToken) {
    logger.error('Deployment cancelled: Ngrok Auth Token is required to generate a public URL.');
    process.exit(1);
  }



  // 4. Package project
  logger.divider();
  const spinner3 = ora({ text: 'Packaging project…', color: 'yellow' }).start();
  let zipPath;
  try {
    zipPath = await packageProject(projectDir, (bytes) => {
      spinner3.text = `Packaging project… ${(bytes / 1024).toFixed(0)} KB`;
    });
    const stats = fs.statSync(zipPath);
    spinner3.succeed(`Packaged: ${(stats.size / 1024).toFixed(1)} KB`);
  } catch (err) {
    spinner3.fail('Failed to package project');
    logger.error(err.message);
    process.exit(1);
  }

  // 5. Upload to server
  const spinner4 = ora({ text: 'Uploading to deployment server…', color: 'magenta' }).start();
  try {
    const FormData = (await import('axios')).default; // axios supports stream upload
    const formData = new (require('url').URLSearchParams)();

    // Build multipart form data manually
    const formBoundary = '----ShareRunBoundary' + Date.now();
    const zipStream = fs.readFileSync(zipPath);

    const bodyParts = [];
    // username field
    bodyParts.push(
      `--${formBoundary}\r\n` +
      `Content-Disposition: form-data; name="username"\r\n\r\n${username}\r\n`
    );
    // projectName field
    bodyParts.push(
      `--${formBoundary}\r\n` +
      `Content-Disposition: form-data; name="projectName"\r\n\r\n${projectName}\r\n`
    );
    // stackType field
    bodyParts.push(
      `--${formBoundary}\r\n` +
      `Content-Disposition: form-data; name="stackType"\r\n\r\n${stack.type}\r\n`
    );
    // ngrokToken field
    bodyParts.push(
      `--${formBoundary}\r\n` +
      `Content-Disposition: form-data; name="ngrokToken"\r\n\r\n${ngrokToken}\r\n`
    );
    // file field
    bodyParts.push(
      `--${formBoundary}\r\n` +
      `Content-Disposition: form-data; name="project"; filename="project.zip"\r\n` +
      `Content-Type: application/zip\r\n\r\n`
    );

    const header = Buffer.from(bodyParts.join(''));
    const footer = Buffer.from(`\r\n--${formBoundary}--\r\n`);
    const body = Buffer.concat([header, zipStream, footer]);

    spinner4.text = 'Uploading…';

    const response = await axios({
      method: 'POST',
      url: `${SERVER_URL}/deploy`,
      data: body,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${formBoundary}`,
        'Content-Length': body.length,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      responseType: 'stream',
    });

    spinner4.succeed('Upload complete');

    // 6. Stream deployment logs
    logger.divider();
    logger.step('🚀', 'Building & deploying…');
    console.log('');

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
              } else if (event.type === 'error') {
                logger.error(event.message);
              } else if (event.type === 'done') {
                result = event;
              }
            } catch (_) {
              const cleaned = sanitize(line.slice(6));
              if (cleaned) console.log(cleaned);
            }
          }
        }
      });

      response.data.on('end', () => {
        if (result) {
          logger.divider();
          const msg = result.message || {};
          const ngrokUrl = msg.url || '';
          console.log('');
          console.log(chalk.bold('  ┌─────────────────────────────────────────┐'));
          console.log(chalk.bold.green('  │  🌍 Deployment Ready                    │'));
          if (ngrokUrl) {
            console.log(chalk.bold(`  │  ${chalk.underline.cyan(ngrokUrl)}`));
          }
          console.log(chalk.bold('  └─────────────────────────────────────────┘'));
          console.log('');
        } else {
          logger.divider();
          logger.url(`Deployment finished, check server logs if URL is missing.`);
        }
        resolve();
      });

      response.data.on('error', reject);
    });
  } catch (err) {
    spinner4.fail('Deployment failed');
    if (err.response) {
      logger.error(`Server responded with ${err.response.status}`);
      if (debug && err.response.data) {
        console.error(err.response.data);
      }
    } else {
      logger.error(err.message);
      if (err.code === 'ECONNREFUSED') {
        logger.warn(`Is the share-run server running at ${SERVER_URL}?`);
      }
    }
    process.exit(1);
  } finally {
    // Clean up temp zip
    try { fs.unlinkSync(zipPath); } catch (_) {}
  }
}

module.exports = deploy;
