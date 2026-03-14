/**
 * Tunnel service for share-run.
 *
 * RESTORED: Uses a persistent Local Proxy Router to bypass ngrok's 1-tunnel limit.
 * Switching deployments instantly updates the proxy target without killing the tunnel.
 */

const ngrok = require('@ngrok/ngrok');
const httpProxy = require('http-proxy');
const http = require('http');
const { allocatePort } = require('./port-manager');

// Fixed Proxy Port to avoid collisions with container ports (5000+)
const PROXY_PORT = 7005;

// Global state
let proxyServer = null;
let proxyNodeServer = null;
let currentTargetPort = null;
let currentPublicUrl = null;
let ngrokListener = null;

/**
 * Initializes the persistent local proxy on Port 7005.
 */
async function ensureProxyServer(log) {
  if (proxyServer) return;

  log(`🔄 Starting Local traffic router on port ${PROXY_PORT}...`);
  
  proxyServer = httpProxy.createProxyServer({ 
    ws: true,
    xfwd: true // preserve headers
  });

  proxyServer.on('error', (err, req, res) => {
    if (res && !res.headersSent && res.writeHead) {
      res.writeHead(502);
      res.end('share-run: Deployment is starting or crashed. Please wait...');
    }
  });

  proxyNodeServer = http.createServer((req, res) => {
    if (currentTargetPort) {
      proxyServer.web(req, res, { target: `http://localhost:${currentTargetPort}` });
    } else {
      res.writeHead(503);
      res.end('share-run: No active deployment routed yet.');
    }
  });

  proxyNodeServer.on('upgrade', (req, socket, head) => {
    if (currentTargetPort) {
      proxyServer.ws(req, socket, head, { target: `http://localhost:${currentTargetPort}` });
    } else {
      socket.destroy();
    }
  });

  await new Promise((resolve) => {
    proxyNodeServer.listen(PROXY_PORT, resolve);
  });
}

/**
 * Create or reuse the public ngrok tunnel.
 */
async function createTunnel(port, id, log, cliToken) {
  const token = cliToken || process.env.NGROK_AUTHTOKEN;
  if (!token) throw new Error('Ngrok Auth Token missing.');

  await ensureProxyServer(log);
  currentTargetPort = port;

  if (currentPublicUrl) {
    log(`🔗 Reusing existing ngrok tunnel: ${currentPublicUrl}`);
    return { url: currentPublicUrl };
  }

  log(`🌐 Initializing ngrok connection to router...`);
  
  try {
    ngrokListener = await ngrok.connect({
      addr: PROXY_PORT,
      authtoken: token,
    });
    
    currentPublicUrl = ngrokListener.url();
    log(`✨ Ngrok LIVE: ${currentPublicUrl}`);
    return { url: currentPublicUrl };
  } catch (err) {
    log(`❌ Ngrok connection failed: ${err.message}`);
    throw err;
  }
}

/**
 * Instantly switch traffic to a new port by updating the Proxy Router.
 */
async function switchTunnel(newPort, id, log, token) {
  log(`🔀 Instantly switching traffic to port ${newPort} via proxy`);
  currentTargetPort = newPort;
  
  if (!currentPublicUrl) {
    return createTunnel(newPort, id, log, token);
  }
  
  return { url: currentPublicUrl };
}

/**
 * Close all active tunnels and the proxy server.
 */
async function closeAllTunnels() {
  if (ngrokListener) {
    await ngrokListener.close();
    ngrokListener = null;
  }
  if (proxyNodeServer) {
    proxyNodeServer.close();
    proxyNodeServer = null;
  }
  currentPublicUrl = null;
  currentTargetPort = null;
}

module.exports = { createTunnel, switchTunnel, closeAllTunnels };
