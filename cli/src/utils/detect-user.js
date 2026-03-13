const { execSync } = require('child_process');

/**
 * Detect the developer's GitHub username.
 *
 * Strategy:
 *   1. Parse the GitHub remote URL  (`git remote get-url origin`)
 *   2. Fall back to `git config user.name`
 *   3. Fall back to "developer"
 *
 * The returned string is lowercased and sanitised to be URL-safe.
 *
 * @returns {string}
 */
function detectUser() {
  // --- try remote URL first ---------------------------------------------------
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // SSH format:  git@github.com:username/repo.git
    const sshMatch = remoteUrl.match(/github\.com[:/]([^/]+)\//);
    if (sshMatch) return sanitise(sshMatch[1]);

    // HTTPS format: https://github.com/username/repo.git
    const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\//);
    if (httpsMatch) return sanitise(httpsMatch[1]);
  } catch (_) {
    // no remote configured — fall through
  }

  // --- try git config user.name -----------------------------------------------
  try {
    const name = execSync('git config user.name', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (name) return sanitise(name);
  } catch (_) {
    // git not installed or not in a repo
  }

  return 'developer';
}

/**
 * Lowercase, replace spaces/underscores/dots with hyphens, strip non-alnum.
 */
function sanitise(raw) {
  return raw
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'developer';
}

module.exports = { detectUser };
