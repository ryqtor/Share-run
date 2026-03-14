const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

const CONFIG_PATH = path.join(os.homedir(), '.share-run', 'config.json');

/**
 * Handle `share-run logout` command.
 */
function logout() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      fs.unlinkSync(CONFIG_PATH);
      console.log(chalk.green('✔ Successfully logged out.'));
      console.log(chalk.dim('  Your saved ngrok Auth Token has been cleared.'));
      console.log(chalk.dim('  Run `share-run deploy` or `share-run dev` to log in again.'));
    } catch (err) {
      console.error(chalk.red('Failed to log out:'), err.message);
    }
  } else {
    console.log(chalk.yellow('You are not currently logged in.'));
  }
}

module.exports = logout;
