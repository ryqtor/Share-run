/**
 * Generate Traefik Docker labels for automatic routing.
 *
 * These labels tell Traefik to:
 *   - Expose the service on the given domain
 *   - Route traffic to the container's internal port
 *   - Enable TLS with Let's Encrypt
 *
 * @param {string} domain  — e.g. "darling-portfolio.run.dev"
 * @param {number} port    — container internal port
 * @returns {object}       — Docker labels object
 */
function generateTraefikLabels(domain, port) {
  const safeName = domain.replace(/\./g, '-');

  return {
    'traefik.enable': 'true',

    // HTTP router
    [`traefik.http.routers.${safeName}.rule`]: `Host(\`${domain}\`)`,
    [`traefik.http.routers.${safeName}.entrypoints`]: 'web',

    // HTTPS router
    [`traefik.http.routers.${safeName}-secure.rule`]: `Host(\`${domain}\`)`,
    [`traefik.http.routers.${safeName}-secure.entrypoints`]: 'websecure',
    [`traefik.http.routers.${safeName}-secure.tls`]: 'true',
    [`traefik.http.routers.${safeName}-secure.tls.certresolver`]: 'letsencrypt',

    // Service port
    [`traefik.http.services.${safeName}.loadbalancer.server.port`]: String(port),
  };
}

module.exports = { generateTraefikLabels };
