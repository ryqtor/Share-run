const deploymentStore = require('./deployment-store');

const PORT_MIN = 5000;
const PORT_MAX = 6000;

/**
 * Allocate the next available port from the range 5000–6000.
 * Checks existing deployments to avoid collisions.
 *
 * @returns {number}
 */
const net = require('net');

/**
 * Check if a port is actually available to bind.
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Allocate the next available port from the range 5000–6000.
 */
async function allocatePort() {
  const allDeployments = deploymentStore.getAll();
  const usedPorts = new Set(
    Object.values(allDeployments).map((d) => d.port).filter(Boolean)
  );

  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    if (!usedPorts.has(port)) {
      if (await isPortAvailable(port)) {
        return port;
      }
    }
  }

  throw new Error('No available ports in range 5000–6000');
}

module.exports = { allocatePort };
