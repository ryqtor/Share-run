const deploymentStore = require('./deployment-store');

const PORT_MIN = 5000;
const PORT_MAX = 6000;

/**
 * Allocate the next available port from the range 5000–6000.
 * Checks existing deployments to avoid collisions.
 *
 * @returns {number}
 */
function allocatePort() {
  const allDeployments = deploymentStore.getAll();
  const usedPorts = new Set(
    Object.values(allDeployments).map((d) => d.port).filter(Boolean)
  );

  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }

  throw new Error('No available ports in range 5000–6000');
}

module.exports = { allocatePort };
