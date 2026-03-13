const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const os = require('os');

/**
 * Package the project directory into a zip file, excluding heavy/sensitive dirs.
 *
 * @param {string}   dir      — absolute path to the project root
 * @param {Function} onProgress — optional callback receiving bytes written
 * @returns {Promise<string>} — path to the created zip file
 */
async function packageProject(dir, onProgress) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-run-'));
  const zipPath = path.join(tmpDir, 'project.zip');

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', (err) => reject(err));
    archive.on('progress', (p) => {
      if (onProgress) onProgress(p.fs.processedBytes);
    });

    archive.pipe(output);

    // Add all files except excluded patterns
    archive.glob('**/*', {
      cwd: dir,
      dot: false,
      ignore: [
        'node_modules/**',
        '.git/**',
        '.env',
        '.env.*',
        'dist/**',
        'build/**',
        '.next/**',
        '*.zip',
      ],
    });

    archive.finalize();
  });
}

module.exports = { packageProject };
