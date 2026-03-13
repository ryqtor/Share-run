const fs = require('fs');
const path = require('path');

/**
 * Server-side stack detection (mirrors CLI logic).
 */
function detectStack(dir) {
  const exists = (f) => fs.existsSync(path.join(dir, f));

  if (exists('next.config.js') || exists('next.config.mjs') || exists('next.config.ts')) {
    return { type: 'nextjs', label: 'Next.js' };
  }

  if (exists('package.json')) {
    return { type: 'node', label: 'Node.js' };
  }

  if (exists('index.html')) {
    return { type: 'static', label: 'Static Website' };
  }

  return { type: 'unknown', label: 'Unknown' };
}

module.exports = { detectStack };
