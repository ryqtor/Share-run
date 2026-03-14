const chalk = require('chalk');

/**
 * Vercel-style log sanitizer.
 *
 * Strips noise (timestamps, Docker step numbers, telemetry),
 * colorizes HTTP methods, and categorizes lines into [BUILD], [ROUTING], [SERVER].
 *
 * @param {string} raw — raw log line from the server/container
 * @returns {string|null} — cleaned line or null to suppress
 */
function sanitize(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let line = raw;

  // ── Strip ISO timestamps (e.g. 2026-03-13T22:00:47.689820302Z) ──
  line = line.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*/g, '');

  // ── Strip Docker step numbers (e.g. "Step 1/9 : ") ──
  line = line.replace(/^Step \d+\/\d+ : /i, '');

  // ── Suppress Next.js telemetry warnings ──
  if (
    line.includes('anonymous telemetry') ||
    line.includes('nextjs.org/telemetry') ||
    line.includes('opt-out') ||
    line.includes('This information is used to shape')
  ) {
    return null; // suppress entirely
  }

  // ── Suppress empty or whitespace-only lines ──
  if (!line.trim()) return null;

  // ── Suppress Docker cache hits (noise) ──
  if (line.includes('Using cache') || line.includes('---> ') || line.includes('Removing intermediate')) {
    return null;
  }

  // ── Categorize ──
  let prefix = '';
  const lower = line.toLowerCase();

  if (
    lower.includes('building') || lower.includes('build') ||
    lower.includes('compiling') || lower.includes('compiled') ||
    lower.includes('npm install') || lower.includes('npm run build') ||
    lower.includes('dockerfile') || lower.includes('image')
  ) {
    prefix = chalk.bgYellow.black(' BUILD ');
  } else if (
    lower.includes('get ') || lower.includes('post ') ||
    lower.includes('put ') || lower.includes('delete ') ||
    lower.includes('routing') || lower.includes('route') ||
    lower.includes('request') || lower.includes('404') ||
    lower.includes('200') || lower.includes('301')
  ) {
    prefix = chalk.bgBlue.white(' ROUTE ');
  } else if (
    lower.includes('listening') || lower.includes('started') ||
    lower.includes('ready') || lower.includes('server') ||
    lower.includes('running') || lower.includes('port')
  ) {
    prefix = chalk.bgGreen.black(' SERVER ');
  }

  // ── Colorize HTTP methods ──
  line = line.replace(/\bGET\b/g, chalk.green.bold('GET'));
  line = line.replace(/\bPOST\b/g, chalk.blue.bold('POST'));
  line = line.replace(/\bPUT\b/g, chalk.cyan.bold('PUT'));
  line = line.replace(/\bDELETE\b/g, chalk.red.bold('DELETE'));
  line = line.replace(/\bPATCH\b/g, chalk.magenta.bold('PATCH'));

  // ── Colorize errors ──
  if (lower.includes('error') || lower.includes('err') || lower.includes('failed') || lower.includes('crash')) {
    line = chalk.bold.red(line);
  }

  // ── Colorize warnings ──
  if (lower.includes('warn') || lower.includes('⚠')) {
    line = chalk.yellow(line);
  }

  return prefix ? `${prefix} ${line}` : `  ${line}`;
}

module.exports = { sanitize };
