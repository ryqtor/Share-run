#!/usr/bin/env node

const { program } = require('commander');
const deploy = require('../src/commands/deploy');
const logs = require('../src/commands/logs');
const pkg = require('../package.json');

program
  .name('share-run')
  .description('Deploy anything from your terminal')
  .version(pkg.version);

program
  .command('deploy')
  .description('Deploy the current directory')
  .option('-d, --debug', 'output extra debugging')
  .action(deploy);

const dev = require('../src/commands/dev');
const logout = require('../src/commands/logout');

program
  .command('logs')
  .description('View live connection logs for the current project')
  .action(logs);

program
  .command('dev')
  .description('Start a live-reloading watch mode deployment')
  .option('-d, --debug', 'output extra debugging')
  .action(dev);

program
  .command('logout')
  .description('Clear your saved ngrok Auth Token')
  .action(logout);

// If no arguments provided, default to 'deploy'
if (process.argv.length === 2) {
  process.argv.push('deploy');
}

program.parse(process.argv);
