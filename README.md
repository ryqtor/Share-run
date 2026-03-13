# 🚀 share-run

**Deploy local projects from your terminal with one command. Get a stable public URL.**

```
$ share-run

👤 GitHub user detected: ryqtor
📁 Project detected: portfolio
🔍 Stack detected: Node.js
📦 Packaging project
⬆  Uploading files
🚀 Building container

🌍 Deployment ready!
https://ryqtor-portfolio.run.dev
```

---

## Architecture

```
┌─────────────┐     HTTP POST      ┌──────────────────┐     Docker API     ┌─────────────────┐
│   CLI Tool   │ ─── /deploy ────▶ │  Deploy Server   │ ─── build/run ──▶ │   Container      │
│  (Node.js)   │ ◀── SSE logs ─── │  (Express)        │                    │  (your project)  │
└─────────────┘                    └──────────────────┘                    └─────────────────┘
                                           │                                        ▲
                                           │  Traefik labels                        │
                                           ▼                                        │
                                   ┌──────────────────┐                             │
                                   │  Traefik Proxy    │ ─── routes domain ─────────┘
                                   │  (reverse proxy)  │
                                   └──────────────────┘
                                           ▲
                                           │
                                   ┌──────────────────┐
                                   │  Cloudflare DNS   │
                                   │  *.run.dev        │
                                   └──────────────────┘
```

## Project Structure

```
sharerun/
├── cli/                         # CLI tool (npm package)
│   ├── bin/share-run.js         # Entry point
│   ├── src/
│   │   ├── index.js             # Commander.js setup
│   │   ├── commands/
│   │   │   ├── deploy.js        # Main deploy command
│   │   │   └── login.js         # Save API token
│   │   └── utils/
│   │       ├── detect-stack.js  # Project type detection
│   │       ├── detect-user.js   # GitHub username detection
│   │       ├── packager.js      # Zip archiver
│   │       └── logger.js        # Pretty CLI output
│   └── package.json
│
├── server/                      # Deployment API server
│   ├── src/
│   │   ├── index.js             # Express app
│   │   ├── routes/deploy.js     # POST /deploy endpoint
│   │   ├── services/
│   │   │   ├── builder.js       # Docker build + run
│   │   │   ├── extractor.js     # Unzip archives
│   │   │   ├── detector.js      # Stack detection
│   │   │   ├── port-manager.js  # Port allocation
│   │   │   ├── proxy-manager.js # Traefik labels
│   │   │   └── deployment-store.js
│   │   └── templates/           # Dockerfile templates
│   │       ├── Dockerfile.node
│   │       ├── Dockerfile.nextjs
│   │       └── Dockerfile.static
│   ├── Dockerfile
│   └── package.json
│
├── traefik/                     # Reverse proxy config
│   ├── traefik.yml
│   └── docker-compose.yml
│
├── docker-compose.yml           # Full orchestration
└── README.md
```

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Docker** running locally
- **Git** (for username detection)

### 1. Install CLI

```bash
cd cli
npm install
npm link
```

This makes the `share-run` command available globally.

### 2. Start the Server

**Option A — Run directly (development):**

```bash
cd server
npm install
npm start
```

Server starts on `http://localhost:3001`.

**Option B — Run with Docker Compose (production):**

```bash
# Create the shared network first
docker network create sharerun-network

# Start everything
docker compose up -d
```

### 3. Deploy a Project

```bash
cd /path/to/your/project
share-run
```

That's it! The CLI will:
1. Detect your project type (Node.js / Next.js / Static)
2. Detect your GitHub username from git
3. Package the project into a zip
4. Upload to the server
5. Build a Docker container
6. Return a live URL

---

## CLI Commands

| Command             | Description                          |
|---------------------|--------------------------------------|
| `share-run`         | Deploy current directory (default)   |
| `share-run deploy`  | Same as above, explicit deploy       |
| `share-run login`   | Save API token                       |
| `share-run --debug` | Enable verbose debug output          |
| `share-run --watch` | Watch for changes and auto-redeploy  |
| `share-run --help`  | Show help                            |

### Login (optional)

```bash
share-run login --token YOUR_API_TOKEN
```

Token is saved to `~/.sharerun/config.json`.

---

## Stack Detection

The system auto-detects project type by scanning files:

| File             | Detected As    |
|------------------|----------------|
| `next.config.js` | Next.js (⚡)   |
| `package.json`   | Node.js (📦)   |
| `index.html`     | Static (🌐)    |

---

## Domain Format

```
{github-username}-{project-folder}.run.dev
```

**Examples:**
- `darling-portfolio.run.dev`
- `alice-blog.run.dev`
- `bob-api-server.run.dev`

---

## Persistent Deployments

When you redeploy the same project:
- The existing container is **stopped and removed**
- A new container is built from the latest code
- The **same domain URL continues to work**

This ensures your deployment URL is always stable.

---

## Server API

### `POST /deploy`

Upload a project for deployment.

**Form fields:**
- `project` — zip file (multipart)
- `username` — GitHub username
- `projectName` — project directory name
- `stackType` — `node` / `nextjs` / `static`

**Response:** SSE stream of deployment logs.

### `GET /health`

```json
{ "status": "ok", "service": "share-run-server", "version": "1.0.0" }
```

### `GET /deployments`

Returns all active deployments.

---

## Production Setup

### DNS (Cloudflare)

1. Add a wildcard A record: `*.run.dev → your-server-ip`
2. Create a Cloudflare API token with Zone:DNS:Edit permissions
3. Set environment variables:
   ```bash
   export CF_API_EMAIL=you@example.com
   export CF_DNS_API_TOKEN=your-token
   ```

### HTTPS (Let's Encrypt)

Traefik handles TLS automatically via the Cloudflare DNS challenge.
Update `traefik/traefik.yml` with your email address.

### Deploy to Production

```bash
# On your server
git clone <repo-url>
cd sharerun
docker compose up -d
```

---

## Technology Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| CLI        | Node.js, Commander.js, Axios, Archiver |
| Server     | Node.js, Express, Multer            |
| Containers | Docker, Dockerode                   |
| Proxy      | Traefik v3                          |
| DNS        | Cloudflare (wildcard)               |
| SSL        | Let's Encrypt (ACME)                |

---

## License

MIT
