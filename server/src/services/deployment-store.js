const fs = require('fs-extra');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', '..', 'deployments.json');

/**
 * Simple JSON-file store for tracking active deployments.
 *
 * Schema:  { [domain]: { containerId, containerName, port, stack, createdAt } }
 */
class DeploymentStore {
  constructor() {
    this._ensureFile();
  }

  _ensureFile() {
    if (!fs.existsSync(STORE_PATH)) {
      fs.writeJsonSync(STORE_PATH, {});
    }
  }

  _read() {
    return fs.readJsonSync(STORE_PATH);
  }

  _write(data) {
    fs.writeJsonSync(STORE_PATH, data, { spaces: 2 });
  }

  get(domain) {
    const data = this._read();
    return data[domain] || null;
  }

  set(domain, info) {
    const data = this._read();
    data[domain] = { ...info, updatedAt: new Date().toISOString() };
    this._write(data);
  }

  delete(domain) {
    const data = this._read();
    delete data[domain];
    this._write(data);
  }

  getAll() {
    return this._read();
  }

  findByPort(port) {
    const data = this._read();
    for (const [domain, info] of Object.entries(data)) {
      if (info.port === port) return { domain, ...info };
    }
    return null;
  }
}

module.exports = new DeploymentStore();
