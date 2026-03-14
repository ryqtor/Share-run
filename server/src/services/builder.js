const Docker = require('dockerode');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const deploymentStore = require('./deployment-store');
const { generateTraefikLabels } = require('./proxy-manager');

const docker = new Docker();
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

/**
 * Dev mode creates TWO containers (no bind mounts, putArchive only):
 *   - Stable (port 5001): always has last WORKING code. Ngrok points here.
 *   - Dev    (port 5000): receives hot-reloaded files first. Test ground.
 *
 * On sync → files injected into Dev → if compiles OK → inject into Stable.
 * If syntax error → Stable untouched → ngrok link stays on working version.
 */
async function buildAndRun({ projectDir, stackType, domain, containerName, mode, log }) {
  const isDev = mode === 'dev';
  const dockerfile = isDev ? 'Dockerfile.dev' : `Dockerfile.${stackType}`;
  const templatePath = path.join(TEMPLATES_DIR, dockerfile);

  if (!await fs.pathExists(templatePath)) {
    throw new Error(`Dockerfile template not found: ${dockerfile}`);
  }
  await fs.copy(templatePath, path.join(projectDir, 'Dockerfile'));
  log(`📄 Using ${dockerfile}`);

  // Build the base image (deps only for dev, full for prod)
  const imageName = `${containerName}:latest`;
  log('🔨 Building Docker image…');
  const filesToSend = isDev
    ? (await fs.readdir(projectDir)).filter(f => ['package.json', 'package-lock.json', 'Dockerfile'].includes(f))
    : await getAllFiles(projectDir);

  const buildStream = await docker.buildImage({ context: projectDir, src: filesToSend }, {
    t: imageName,
    buildargs: { PORT: '5001' },
  });
  await followBuild(buildStream, log);
  log('✅ Image built');

  await ensureNetwork('sharerun-network');

  if (isDev) {
    // ── DEV: Start TWO containers ──────────────────────────────────
    const stableName = `${containerName}-stable`;
    const devName    = `${containerName}-dev`;

    // Start Stable (5001)
    await stopContainer(stableName);
    log('🚀 Starting STABLE container (port 5001)…');
    const stableContainer = await createAndStart(imageName, stableName, 5001);
    log('  [OK] Stable started');

    // Start Dev (5000)
    await stopContainer(devName);
    log('🚀 Starting DEV container (port 5000)…');
    const devContainer = await createAndStart(imageName, devName, 5000);
    log('  [OK] Dev started');

    // Inject source code into BOTH
    log('📂 Injecting source code into both containers…');
    await injectSourceFiles(stableContainer, projectDir);
    await injectSourceFiles(devContainer, projectDir);
    log('✅ Source code injected');

    deploymentStore.set(domain, {
      containerId: stableContainer.id,
      containerName: stableName,
      port: 5001,
      devContainerId: devContainer.id,
      devContainerName: devName,
      devPort: 5000,
      stack: stackType,
      mode: 'dev',
      createdAt: new Date().toISOString(),
    });

    return { containerId: stableContainer.id, port: 5001 };
  } else {
    // ── PROD: Single container ─────────────────────────────────────
    await stopContainer(containerName);
    const container = await createAndStart(imageName, containerName, 5001);
    deploymentStore.set(domain, {
      containerId: container.id,
      containerName,
      port: 5001,
      stack: stackType,
      mode: 'prod',
      createdAt: new Date().toISOString(),
    });
    return { containerId: container.id, port: 5001 };
  }
}

async function createAndStart(image, name, port) {
  const container = await docker.createContainer({
    Image: image,
    name: name,
    Env: [
      `PORT=${port}`,
      'NODE_ENV=development',
      'WATCHPACK_POLLING=true',
      'CHOKIDAR_USEPOLLING=true',
    ],
    ExposedPorts: { [`${port}/tcp`]: {} },
    HostConfig: {
      PortBindings: { [`${port}/tcp`]: [{ HostPort: String(port) }] },
      NetworkMode: 'sharerun-network',
    },
  });
  await container.start();
  return container;
}

async function injectSourceFiles(container, sourceDir) {
  return new Promise((resolve, reject) => {
    const tar = archiver('tar', { gzip: false });
    tar.glob('**/*', {
      cwd: sourceDir,
      ignore: ['node_modules/**', '.next/**', '.git/**', 'Dockerfile'],
      dot: true,
    });
    tar.finalize();
    container.putArchive(tar, { path: '/app' }).then(resolve).catch(reject);
  });
}

function followBuild(stream, log) {
  return new Promise((resolve, reject) => {
    docker.modem.followProgress(stream,
      (err, output) => {
        if (err) return reject(err);
        if (output && output.some(o => o.error)) return reject(new Error('Docker build failed'));
        resolve(output);
      },
      (ev) => { if (ev.stream && ev.stream.trim()) log(`  ${ev.stream.trim()}`); }
    );
  });
}

async function stopContainer(name) {
  try {
    const c = docker.getContainer(name);
    const info = await c.inspect();
    if (info.State.Running) await c.stop();
    await c.remove();
  } catch (_) {}
}

async function ensureNetwork(net) {
  try { await docker.getNetwork(net).inspect(); }
  catch (_) { await docker.createNetwork({ Name: net }); }
}

async function getAllFiles(dir) {
  const out = [];
  const walk = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(path.join(d, e.name));
      else out.push(path.relative(dir, path.join(d, e.name)).replace(/\\/g, '/'));
    }
  };
  await walk(dir);
  return out;
}

module.exports = { buildAndRun };
