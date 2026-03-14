const axios = require('axios');
const path = require('path');
const chalk = require('chalk');
const { detectUser } = require('../utils/detect-user');
const { sanitize } = require('../utils/log-sanitizer');

const SERVER_URL = process.env.SHARE_RUN_SERVER || 'http://localhost:3001';

/**
 * Handle `share-run logs` command.
 * Streams sanitized live logs from the deployed container.
 */
async function logs(opts) {
  const projectDir = process.cwd();
  const projectName = path.basename(projectDir)
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  const username = detectUser();
  const deploymentId = `${username}-${projectName}`;

  console.log(chalk.dim(`Attaching to logs for ${deploymentId}…\n`));

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
            } else if (event.type === 'info') {
              console.log(chalk.dim(event.message));
            } else if (event.type === 'error') {
              console.log(chalk.bold.red(`[ERROR] ${event.message}`));
            } else if (event.type === 'done') {
              console.log(chalk.dim('\n[Stream ended]'));
              process.exit(0);
            }
          } catch (_) {
            const cleaned = sanitize(line.slice(6));
            if (cleaned) console.log(cleaned);
          }
        }
      }
    });

    response.data.on('end', () => {
      console.log(chalk.dim('\n[Disconnected]'));
      process.exit(0);
    });

    response.data.on('error', (err) => {
      console.error(chalk.red('\n[Error connecting to logs stream]'), err.message);
      process.exit(1);
    });

  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.log(chalk.yellow(`No active deployment found for ${deploymentId}.`));
      console.log(chalk.dim('Run `share-run deploy` first.'));
    } else {
      console.error(chalk.red(`Failed to attach to logs:`), err.message);
    }
    process.exit(1);
  }
}

module.exports = logs;
