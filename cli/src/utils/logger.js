const chalk = require('chalk');

const logger = {
  info: (msg) => console.log(chalk.cyan('ℹ ') + msg),
  success: (msg) => console.log(chalk.green('✔ ') + msg),
  warn: (msg) => console.log(chalk.yellow('⚠ ') + msg),
  error: (msg) => console.log(chalk.red('✖ ') + msg),
  step: (icon, msg) => console.log(`${icon} ${msg}`),
  banner: () => {
    console.log('');
    console.log(chalk.bold.magenta('  ╔═══════════════════════════════════════╗'));
    console.log(chalk.bold.magenta('  ║') + chalk.bold.white('        🚀  share-run  v1.0.0        ') + chalk.bold.magenta('║'));
    console.log(chalk.bold.magenta('  ║') + chalk.dim.white('   deploy anything from your terminal  ') + chalk.bold.magenta('║'));
    console.log(chalk.bold.magenta('  ╚═══════════════════════════════════════╝'));
    console.log('');
  },
  url: (url) => {
    console.log('');
    console.log(chalk.bold.green('  🌍 Deployment ready!'));
    console.log(chalk.bold.white(`  ${chalk.underline(url)}`));
    console.log('');
  },
  divider: () => console.log(chalk.dim('  ─────────────────────────────────────')),
};

module.exports = logger;
