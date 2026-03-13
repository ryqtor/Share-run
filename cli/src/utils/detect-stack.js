const fs = require('fs');
const path = require('path');

/**
 * Detect the project type by scanning files in the given directory.
 *
 * Priority order:
 *   1. next.config.js  → Next.js
 *   2. next.config.mjs → Next.js
 *   3. next.config.ts  → Next.js
 *   4. package.json    → Node.js
 *   5. index.html      → Static site
 *
 * @param {string} dir — absolute path to the project directory
 * @returns {{ type: string, label: string, icon: string }}
 */
function detectStack(dir) {
  const exists = (f) => fs.existsSync(path.join(dir, f));

  if (exists('next.config.js') || exists('next.config.mjs') || exists('next.config.ts')) {
    return { type: 'nextjs', label: 'Next.js', icon: '⚡' };
  }

  if (exists('package.json')) {
    return { type: 'node', label: 'Node.js', icon: '📦' };
  }

  if (exists('index.html')) {
    return { type: 'static', label: 'Static Website', icon: '🌐' };
  }

  return { type: 'unknown', label: 'Unknown', icon: '❓' };
}

module.exports = { detectStack };
