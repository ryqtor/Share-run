const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');

const DEPLOYMENTS_DIR = path.join(__dirname, '..', '..', 'deployments');

/**
 * Extract a zip archive into deployments/<deploymentId>/.
 *
 * @param {string} zipPath       — path to the uploaded zip file
 * @param {string} deploymentId  — unique deployment identifier
 * @param {Function} log         — callback for streaming log messages
 * @returns {Promise<string>}    — path to the extracted directory
 */
async function extractArchive(zipPath, deploymentId, log) {
  const extractDir = path.join(DEPLOYMENTS_DIR, deploymentId);

  // Clean up if previous extraction exists
  await fs.remove(extractDir);
  await fs.ensureDir(extractDir);

  log('📂 Extracting project archive…');

  await new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractDir }))
      .on('close', resolve)
      .on('error', reject);
  });

  // Count extracted files
  const files = await listFilesRecursive(extractDir);
  log(`📂 Extracted ${files.length} files`);

  return extractDir;
}

async function listFilesRecursive(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  let files = [];
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files = files.concat(await listFilesRecursive(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

module.exports = { extractArchive };
