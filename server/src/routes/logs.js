const express = require('express');
const Docker = require('dockerode');
const deploymentStore = require('../services/deployment-store');
const { sanitize } = require('../utils/log-sanitizer');

const router = express.Router();
const docker = new Docker();

router.get('/:deploymentId', async (req, res) => {
  const { deploymentId } = req.params;
  const domain = `${deploymentId}.run.dev`;
  
  const deployment = deploymentStore.get(domain);
  if (!deployment || !deployment.containerId) {
    console.log(`[LOGS] 404: No deployment found for ${domain}`);
    return res.status(404).json({ error: `Deployment ${deploymentId} not found or has no container.` });
  }

  console.log(`[LOGS] CLI connected to stream: ${deploymentId} (Container: ${deployment.containerId})`);

  // Set headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (type, message) => {
    const data = JSON.stringify({ type, message });
    res.write(`data: ${data}\n\n`);
  };

  try {
    const container = docker.getContainer(deployment.containerId);
    
    // Check if container exists
    const containerInfo = await container.inspect();
    if (!containerInfo.State.Running) {
      send('info', 'Container is not currently running.');
      // It might have short-lived logs, still fetch them
    }

    // Attach to container logs
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
      tail: 100 // fetch last 100 lines + follow new ones
    });

    logStream.on('data', (chunk) => {
      // Docker logs format has an 8-byte header per line (multiplexing stdout/stderr)
      // chunk length must be > 8
      if (chunk.length > 8) {
        const payload = chunk.slice(8).toString('utf-8');
        // A single chunk might have multiple lines
        const lines = payload.split('\n');
        for (const line of lines) {
          const clean = sanitize(line);
          if (clean !== null) {
            send('log', clean);
          }
        }
      }
    });

    logStream.on('end', () => {
      send('done', 'Log stream ended.');
      res.end();
    });

    logStream.on('error', (err) => {
      console.error(`Log stream error for ${deploymentId}:`, err);
      send('error', 'Error reading logs: ' + err.message);
      res.end();
    });

    // Clean up when client disconnects
    req.on('close', () => {
      // logStream doesn't have an explicit destroy/abort method via docker-modem usually,
      // but closing the req will drop the connection.
      if (logStream.destroy) {
        logStream.destroy();
      }
    });

  } catch (err) {
    console.error(`Failed to fetch logs for ${deploymentId}:`, err);
    send('error', 'Failed to fetch container logs: ' + err.message);
    res.end();
  }
});

module.exports = router;
