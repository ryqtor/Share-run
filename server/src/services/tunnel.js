/**
 * Tunnel service for share-run.
 *
 * Uses official ngrok to expose a local port on a real public URL.
 * Ngrok is the most reliable tunneling tool and bypasses restrictive networks.
 * Requires NGROK_AUTHTOKEN set in the server's environment.
 */

const ngrok = require('@ngrok/ngrok');

// Keep track of active listeners so they can be closed on redeploy
const activeTunnels = new Map();

/**
 * Create a public ngrok tunnel to a local port.
 *
 * @param {number}   port      — the local port the container is listening on
 * @param {string}   id        — deployment ID for tracking
 * @param {Function} log       — streaming log callback
 * @param {string}   cliToken  — optional ngrok token provided by the CLI
 * @returns {Promise<{ url: string, tunnel: object }>}
 */
async function createTunnel(port, id, log, cliToken) {
  // Close any existing tunnel for this deployed project
  if (activeTunnels.has(id)) {
    log(`🔄 Closing previous ngrok tunnel for ${id}`);
    try {
      await activeTunnels.get(id).close();
    } catch (_) {}
    activeTunnels.delete(id);
  }

  log(`🌐 Creating ngrok tunnel → localhost:${port}`);

  const token = cliToken || process.env.NGROK_AUTHTOKEN;
  if (!token) {
    throw new Error('Ngrok Auth Token is missing. Provide it via the CLI or server environment.');
  }

  // Connect via ngrok using the explicit token
  const listener = await ngrok.connect({ addr: port, authtoken: token });
  
  const publicUrl = listener.url();
  activeTunnels.set(id, listener);

  log(`🔗 ngrok established: ${publicUrl}`);
  return { url: publicUrl, tunnel: listener };
}

/**
 * Close all active tunnels (for graceful shutdown).
 */
async function closeAllTunnels() {
  for (const [id, listener] of activeTunnels) {
    try { await listener.close(); } catch (_) {}
  }
  activeTunnels.clear();
  try { await ngrok.kill(); } catch (_) {}
}

module.exports = { createTunnel, closeAllTunnels };
