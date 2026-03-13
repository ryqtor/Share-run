const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const chalk = require('chalk');

const CONFIG_PATH = path.join(os.homedir(), '.share-run', 'config.json');

function ensureConfigDir() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (_) {
      return {};
    }
  }
  return {};
}

function setConfig(key, value) {
  ensureConfigDir();
  const conf = getConfig();
  conf[key] = value;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(conf, null, 2));
}

async function getOrPromptNgrokToken() {
  let conf = getConfig();
  if (conf.ngrokToken) return conf.ngrokToken;
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('');
    console.log(chalk.bold.yellow('  ⚠️  ngrok requires a free Auth Token to create permanent public domains.'));
    console.log(chalk.dim('      You only need to do this once.'));
    console.log(`      Get yours instantly at: ${chalk.underline.white('https://dashboard.ngrok.com/get-started/your-authtoken')}`);
    console.log('');
    rl.question(chalk.bold.cyan('  🔑 Enter your ngrok Auth Token: '), (token) => {
      rl.close();
      const cleanToken = token.trim();
      if (cleanToken) {
        setConfig('ngrokToken', cleanToken);
        console.log(chalk.green('  ✔  Token saved successfully.'));
        console.log('');
      }
      resolve(cleanToken);
    });
  });
}

module.exports = { getConfig, setConfig, getOrPromptNgrokToken };
