const Docker = require('dockerode');
const fs = require('fs-extra');
const path = require('path');
const deploymentStore = require('./deployment-store');
const { allocatePort } = require('./port-manager');
const { generateTraefikLabels } = require('./proxy-manager');

const docker = new Docker();

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

/**
 * Build and run a Docker container for the given project.
 *
 * If a container with the same name already exists, it is stopped and removed
 * to ensure the same domain points to the freshly deployed version.
 *
 * @param {object}   opts
 * @param {string}   opts.projectDir   — absolute path to extracted project
 * @param {string}   opts.stackType    — 'node' | 'nextjs' | 'static'
 * @param {string}   opts.domain       — the deployment domain
 * @param {string}   opts.containerName — unique container name
 * @param {Function} opts.log          — streaming log callback
 * @returns {Promise<{ containerId: string, port: number }>}
 */
async function buildAndRun({ projectDir, stackType, domain, containerName, log }) {
  // 1. Copy the right Dockerfile template into the project directory
  const dockerfileTemplate = `Dockerfile.${stackType}`;
  const templatePath = path.join(TEMPLATES_DIR, dockerfileTemplate);
  const destDockerfile = path.join(projectDir, 'Dockerfile');

  if (!await fs.pathExists(templatePath)) {
    throw new Error(`No Dockerfile template found for stack type: ${stackType}`);
  }

  await fs.copy(templatePath, destDockerfile);
  log(`📄 Using Dockerfile template: ${dockerfileTemplate}`);

  // 2. Stop and remove existing container (persistent deployment)
  await stopExistingContainer(containerName, log);

  // 3. Allocate a port
  const port = allocatePort();
  log(`🔌 Allocated port: ${port}`);

  // 4. Build the Docker image
  // Use containerName directly — it already has the "sharerun-" prefix
  const imageName = `${containerName}:latest`;
  log(`🔨 Building Docker image: ${imageName}`);

  const buildStream = await docker.buildImage(
    {
      context: projectDir,
      src: await getContextFiles(projectDir),
    },
    {
      t: imageName,
      buildargs: { PORT: String(port) },
    }
  );

  // Stream build output — track errors so we can abort before createContainer
  let buildError = null;
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(
      buildStream,
      (err, output) => {
        if (err) return reject(err);
        if (buildError) return reject(new Error(`Docker build failed: ${buildError}`));
        resolve(output);
      },
      (event) => {
        if (event.stream) {
          const line = event.stream.trim();
          if (line) log(`  ${line}`);
        }
        if (event.error) {
          buildError = event.error;
          log(`❌ Build error: ${event.error}`);
        }
      }
    );
  });

  log('✅ Docker image built successfully');

  // 5. Generate Traefik labels
  const labels = generateTraefikLabels(domain, port);

  // 6. Ensure the Docker network exists
  await ensureNetwork('sharerun-network', log);

  // 7. Run the container
  log(`🚀 Starting container: ${containerName}`);

  const container = await docker.createContainer({
    Image: imageName,
    name: containerName,
    Env: [`PORT=${port}`],
    ExposedPorts: { [`${port}/tcp`]: {} },
    HostConfig: {
      PortBindings: {
        [`${port}/tcp`]: [{ HostPort: String(port) }],
      },
      Memory: 512 * 1024 * 1024,  // 512 MB
      NanoCpus: 500000000,         // 0.5 CPU
      RestartPolicy: { Name: 'unless-stopped' },
      NetworkMode: 'sharerun-network',
    },
    Labels: labels,
  });

  await container.start();
  log('✅ Container started');

  // 7. Save deployment info
  deploymentStore.set(domain, {
    containerId: container.id,
    containerName,
    port,
    stack: stackType,
    imageName,
    createdAt: new Date().toISOString(),
  });

  return { containerId: container.id, port };
}

/**
 * Stop and remove an existing container by name (for redeployment).
 */
async function stopExistingContainer(containerName, log) {
  try {
    const existing = docker.getContainer(containerName);
    const info = await existing.inspect();

    if (info.State.Running) {
      log(`⏹  Stopping existing container: ${containerName}`);
      await existing.stop();
    }

    log(`🗑️  Removing existing container: ${containerName}`);
    await existing.remove();
  } catch (err) {
    if (err.statusCode === 404) {
      // Container doesn't exist — that's fine
    } else {
      log(`⚠️  Warning: ${err.message}`);
    }
  }
}

/**
 * Ensure a Docker network exists, creating it if necessary.
 */
async function ensureNetwork(networkName, log) {
  try {
    const network = docker.getNetwork(networkName);
    await network.inspect();
  } catch (err) {
    if (err.statusCode === 404) {
      log(`🌐 Creating Docker network: ${networkName}`);
      await docker.createNetwork({ Name: networkName, Driver: 'bridge' });
    } else {
      log(`⚠️  Network check warning: ${err.message}`);
    }
  }
}

/**
 * Get the list of files in the project directory for Docker build context.
 */
async function getContextFiles(dir) {
  const files = [];
  const walk = async (d) => {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const rel = path.relative(dir, path.join(d, entry.name));
      if (entry.isDirectory()) {
        await walk(path.join(d, entry.name));
      } else {
        files.push(rel.replace(/\\/g, '/'));
      }
    }
  };
  await walk(dir);
  return files;
}

module.exports = { buildAndRun };
