<div align="center">
  <img src="apps/webpanel/public/newlogo.png" alt="Hypanel Logo" width="200">
</div>

# Hypanel - Self-Hosted Hytale Server Manager 

A Linux server manager tool for Hytale servers that allows you to create, install, update, and delete Hytale servers in a web GUI. Manage your servers with ease through a modern web interface.

## Features

- **Server Management**: Create, install, update, and delete Hytale servers via web GUI
- **Autostart**: Enable automatic server startup on system boot
- **Player Management**: View, kick, opp, or manage whitelist/banlist players
- **Backup Management**: Create and download server backups directly from your browser
- **Mod Management**: Upload, view, and delete mod files through the web interface
- **Real-time Monitoring**: Monitor server resource usage (CPU, memory) in real-time
- **Console Access**: Access and interact with server console logs via WebSocket

## Supported Systems

Hypanel is tested and supported on:
- **Ubuntu** 22.04, 24.04
- **Debian** 12, 13
- **Docker** 20.10+ with Docker Compose 2.0+ (linux/amd64 required; linux/arm64 optional)

> **Note**: Hypanel may work on other Linux distributions or Docker hosts, but they are not officially supported. If you choose to use Hypanel on an unsupported system, you will be responsible for testing and troubleshooting any issues that may arise.

## Disclaimer

⚠️ **This tool is currently in a test/experimental phase.** There will likely be bugs or issues. Use at your own risk and report any problems you encounter.

## Installation

Choose one of the following: Docker install script (easiest for Docker), Docker manual (clone and build), or native Linux.

### Prerequisites

- **For native Linux**: Install `curl` if needed: `sudo apt-get update && sudo apt-get install -y curl` (Ubuntu/Debian).
- **For Docker**: **Docker** 20.10+ and **Docker Compose** 2.0+. Supported architectures: **linux/amd64** (required), **linux/arm64** (optional). For building from source on macOS: **Docker buildx** (included with Docker Desktop).

### Option 1: Docker (install script)

One-command install: no clone or build. The script creates a `hypanel` directory, pulls `docker-compose.yml` and config from the repo, pulls the pre-built image, prompts for a password, and starts the stack. Run from the directory where you want the `hypanel` folder (e.g. your home directory):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/OnyxWm/hypanel/main/setup-hypanel-docker.sh)"
```

Or download and run manually:

```bash
curl -fsSL https://raw.githubusercontent.com/OnyxWm/hypanel/main/setup-hypanel-docker.sh -o setup-hypanel-docker.sh
bash setup-hypanel-docker.sh
```

Then see [After installation](#after-installation). Access the panel at `http://localhost:3000` (or your host IP).

### Option 2: Docker (manual – pull image)

Same as the install script but done step-by-step (no clone, no build). Use the pre-built image from the registry.

1. **Create a directory and download config**:
   ```bash
   mkdir -p hypanel && cd hypanel
   curl -fsSL https://raw.githubusercontent.com/OnyxWm/hypanel/main/docker-compose.yml -o docker-compose.yml
   curl -fsSL https://raw.githubusercontent.com/OnyxWm/hypanel/main/.env.example -o .env.example
   cp .env.example .env
   ```

2. **Pull the Docker image**:
   ```bash
   docker pull ghcr.io/onyxwm/hypanel:latest
   ```

3. **Set the panel password** (choose one):
   - **Secret file** (recommended): generate a hash and write it to the file Docker Compose expects:
     ```bash
     mkdir -p secrets
     docker run --rm -it --entrypoint "" -v "$(pwd)/secrets:/out" ghcr.io/onyxwm/hypanel:latest hypanel hash-password --output /out/hypanel_password_hash
     ```
   - **Or** put the hash or plaintext in `.env`: set `HYPANEL_PASSWORD_HASH` or `HYPANEL_PASSWORD` (see `.env.example` and the [Configuration](#configuration) section).

4. **Start Hypanel**:
   ```bash
   docker compose up -d
   ```

Then see [After installation](#after-installation). Access the panel at `http://localhost:3000` (or your host IP).

### Option 3: Native Linux

1. **Run the installation script**:
   ```bash
   sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/OnyxWm/hypanel/main/install.sh)"
   ```
   Or download and run manually:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/OnyxWm/hypanel/main/install.sh -o install.sh
   sudo bash install.sh
   ```

2. See [After installation](#after-installation). Access the panel at `http://[your-server-ip]:3000`.

### After installation

1. **Access the web panel**: Visit `http://[your-server-ip]:3000` (or `http://localhost:3000` for Docker on the same machine).

2. **Login**: Use the password you set during installation.

3. **Authorize the downloader**: Click the "Authorize" button at the top of the page. Once authorized, it will show "Authorized" status.

   ![Auth Downloader Button](img/auth-downloader.png)
   
   After clicking authorize, you should see:
   
   ![Downloader Authorized](img/downloader-authorised.png)

4. **Create and install a server**: From the dashboard, create a new server and install it.

5. **Authorize the server** (first start only):
   - When you start the server for the first time, it will show an "Auth Required" status
   
   ![Server Auth Required](img/auth-server.png)
   
   - Click on the "Authenticate" button in the web interface
   - Run the `/auth login device` command in the server console
   - Copy the authorization link that appears in the console
   
   ![Server Auth Link](img/server-auth-link.png)
   
   - Open the link in a new browser tab and sign in with your Hytale account
   - Once authorized, return to the console and run: `/auth persistence Encrypted save`
   - You should see confirmation that credential storage has been changed to Encrypted
   
   ![Auth Encrypted Persisted](img/auth-encrypted-persisted.png)
   
   - Your server is now ready to accept connections!

### External Connections

For external connections outside of your home network, configure port forwarding on your router: forward the server's port (e.g. `5520`) to your server's local IP. Consult your router's documentation for port forwarding instructions.

### Docker: data, configuration, and reference

The following applies after installing with **Option 1** or **Option 2** (Docker).

#### Docker Data Persistence

All persistent data is stored in Docker named volumes: `hypanel_data`, `hypanel_servers`, `hypanel_logs`, and `hypanel_backup`. Docker creates and manages them; no host directory permissions are required. You cannot browse `./data` in the project folder; use `docker volume inspect hypanel_data` or backup by mounting volumes into a helper container, for example:

```bash
docker run --rm -v hypanel_data:/data -v $(pwd):/backup alpine tar czf /backup/hypanel_data.tar.gz -C /data .
```

Repeat for `hypanel_servers`, `hypanel_logs`, and `hypanel_backup` as needed.

#### Configuration

All configuration is done through the `.env` file. The setup script creates this file automatically, or you can copy `.env.example` to `.env` and edit it manually.

**Key configuration options** (see `.env.example` for full list):

| Variable | Default | Description |
|----------|---------|-------------|
| `HYPANEL_AUTH_METHOD` | `ENV` | Authentication method: `ENV` (Docker default) or `PAM` |
| `HYPANEL_PASSWORD_HASH` | - | Bcrypt hash of password (recommended) |
| `HYPANEL_PASSWORD` | - | Plaintext password (testing only) |
| `PORT` | `3000` | HTTP API server port |
| `WS_PORT` | `3001` | WebSocket server port |

**Password Hash Generation:**

If you need to generate a password hash manually, see instructions in `.env.example` or use:
```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-password', 10).then(h => console.log(h));"
```

#### Docker Commands

```bash
# Start Hypanel
docker-compose up -d

# Stop Hypanel
docker-compose stop

# Restart Hypanel
docker-compose restart

# View logs
docker-compose logs -f

# View logs for last 100 lines
docker-compose logs --tail=100

# Stop and remove container (data volumes persist)
docker-compose down

# Rebuild container after code changes
# On macOS/Colima:
./build-docker.sh && docker-compose up -d
# On Linux:
docker-compose up -d --build

# Access container shell
docker-compose exec hypanel bash
```

**Note:** If you encounter a `KeyError: 'ContainerConfig'` error when switching to host networking mode, you need to remove the old container first:

```bash
# Stop and remove the old container
docker-compose down

# Remove the old container manually if needed
docker rm -f hypanel

# Then start fresh
docker-compose up -d
```

#### Differences from Linux Installation

- **Authentication**: Docker uses ENV mode by default (password from environment variable), while Linux installation uses PAM (system user password)
- **No systemd**: Docker handles process management, so systemd integration features are not available
- **Isolated environment**: All dependencies are contained within the Docker image
- **Easier updates**: Rebuild the container to update the application

#### Docker Networking

Hypanel uses **bridge networking mode** with explicit port mappings to allow game servers to be accessible from the network. This configuration is compatible with NAS app stores and container orchestration platforms.

**Port Mappings:**
- `3000:3000` (TCP) - Panel HTTP API
- `3001:3001` (TCP) - WebSocket server
- `5520:5520/udp` - Game server port (UDP protocol)

**Important for Game Servers:**

- Game servers **must bind to `0.0.0.0`** (not `127.0.0.1` or `localhost`) to accept connections from outside the container
  - ✅ Good: `0.0.0.0:5520` - accessible from network
  - ❌ Bad: `127.0.0.1:5520` or `localhost:5520` - only accessible from container
- Hypanel automatically configures servers to bind to `0.0.0.0` by default
- You may need to configure your firewall to allow connections to game server ports (e.g., port 5520)
  - **UFW (Ubuntu/Debian)**: `sudo ufw allow 5520/udp`
  - **firewalld (CentOS/RHEL)**: `sudo firewall-cmd --add-port=5520/udp --permanent && sudo firewall-cmd --reload`

#### Troubleshooting

**Permission issues with volumes:**
- With named volumes, host directory permissions are not used. If you see permission errors inside the container, ensure the container has started at least once (the entrypoint chowns volume mount points to the app user) or check logs: `docker-compose logs`

**Container won't start:**
- Check logs: `docker-compose logs`
- Verify that `.env` file exists and has `HYPANEL_PASSWORD_HASH` or `HYPANEL_PASSWORD` set
- Ensure ports 3000 and 3001 are not already in use
- Run `./setup-docker.sh` again to regenerate `.env` if needed

**Can't access web panel:**
- Verify the container is running: `docker-compose ps`
- Check port mappings in `docker-compose.yml`
- Ensure firewall allows connections to ports 3000 and 3001

**Can't connect to game server from network:**
- Verify the server is binding to `0.0.0.0` (not `127.0.0.1`) - Hypanel configures this automatically
- Check that the firewall allows connections to the game server port (default: 5520)
  - UFW: `sudo ufw allow 5520/tcp`
  - firewalld: `sudo firewall-cmd --add-port=5520/tcp --permanent && sudo firewall-cmd --reload`
- Verify the container is using host networking mode (`network_mode: host` in `docker-compose.yml`)
- Test connectivity: `telnet <your-server-ip> 5520` or `nc -zv <your-server-ip> 5520`

**Build fails on macOS with QEMU errors:**
- Use the helper script: `./build-docker.sh` (handles Colima automatically)
- Or use Docker buildx: `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker-compose build`
- Or build directly: `docker buildx build --platform linux/amd64 -t hypanel:latest .`
- For Colima: Set up buildx builder: `docker buildx create --name hypanel-builder --use && docker buildx inspect --bootstrap`
- Verify buildx is available: `docker buildx version`
- See [TESTING_DOCKER.md](./TESTING_DOCKER.md) for detailed macOS build instructions

## Documentation

For comprehensive documentation, guides, and detailed information about Hypanel, visit:

**https://docs.hypanel.app**

The documentation site includes detailed guides, API references, troubleshooting tips, and more.

## Uninstallation

**Native Linux:** To completely remove Hypanel, run the uninstall script:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/OnyxWm/hypanel/main/uninstall.sh)"
```

Or download and run it manually:

```bash
curl -fsSL https://raw.githubusercontent.com/OnyxWm/hypanel/main/uninstall.sh -o uninstall.sh
sudo bash uninstall.sh
```

**Docker:** Stop and remove the stack (optionally remove volumes to delete data):

```bash
cd hypanel   # or wherever you ran setup-hypanel-docker.sh
docker compose down
# Optional: remove volumes and data
docker volume rm hypanel_data hypanel_servers hypanel_logs hypanel_backup 2>/dev/null || true
```

**Warning:** Uninstalling will permanently delete all Hypanel data (server instances, configurations, databases, logs, backups) for that installation.

## Development

### Tech Stack

#### Backend
- **Node.js** 18+ with **Express 5.2.1** - REST API server
- **TypeScript 5.9.3** - Type-safe development
- **SQLite** (better-sqlite3 11.7.0) - Database
- **WebSocket** (ws 8.19.0) - Real-time communication
- **Winston 3.15.0** - Logging framework with daily rotation
- **Zod 3.23.8** - Schema validation
- **authenticate-pam 1.0.5** - PAM authentication for Linux
- **multer 2.0.2** - File upload handling
- **pidusage 4.0.1** - Process resource monitoring
- **ts-node-dev 2.0.0** - Development server with hot reload
- **tsx 4.19.2** - TypeScript execution for testing

#### Frontend
- **React 19.2.0** - UI framework
- **TypeScript 5.9.3** - Type-safe development
- **Vite 7.2.4** - Build tool and dev server
- **React Router 7.12.0** - Client-side routing
- **Tailwind CSS 4.1.9** - Utility-first CSS framework
- **Radix UI** - Accessible component primitives (various packages)
- **Recharts 2.15.4** - Data visualization
- **React Hook Form 7.60.0** - Form management
- **Zod 3.25.76** - Schema validation for forms
- **Sonner 1.7.4** - Toast notifications

### Project Structure

```
hypanel/
├── apps/
│   ├── backend/              # Node.js backend API and daemon
│   │   ├── src/
│   │   │   ├── api/          # REST API routes and middleware
│   │   │   │   ├── routes/   # API route handlers
│   │   │   │   └── middleware/# Authentication and validation
│   │   │   ├── websocket/    # WebSocket server
│   │   │   ├── server/       # Server management logic
│   │   │   ├── database/     # Database operations
│   │   │   ├── installation/ # Server installation logic
│   │   │   ├── storage/      # Configuration management
│   │   │   ├── logger/       # Logging utilities
│   │   │   ├── config/       # Configuration management
│   │   │   ├── systemd/      # Systemd integration
│   │   │   ├── types/        # TypeScript type definitions
│   │   │   ├── utils/        # Utility functions
│   │   │   └── errors/       # Error handling
│   │   ├── test/             # Test files
│   │   ├── daemon.ts         # Daemon entry point
│   │   └── README.md         # Backend-specific documentation
│   │
│   └── webpanel/             # React frontend application
│       ├── src/
│       │   ├── components/   # React components
│       │   │   └── ui/       # Reusable UI components
│       │   ├── pages/        # Page components
│       │   ├── contexts/     # React contexts
│       │   ├── lib/          # Utilities and API client
│       │   └── assets/       # Static assets
│       ├── public/           # Public assets (logo, favicon)
│       └── README.md         # Frontend-specific documentation
│
├── install.sh                # Installation script
├── uninstall.sh              # Uninstallation script
└── package.json              # Root package with dev scripts
```

### Prerequisites

- **Node.js** 18+ and npm (Node.js 24+ recommended for production)
- **Linux** operating system (for running Hytale servers)
- **SQLite3** (usually included with Node.js)
- **TypeScript** 5.9+ (installed as dev dependency)

### Development Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd hypanel
```

2. Install root dependencies:
```bash
npm install
```

3. Install backend dependencies:
```bash
cd apps/backend
npm install
cd ../..
```

4. Install frontend dependencies:
```bash
cd apps/webpanel
npm install
cd ../..
```

### Running the Project

#### Development Mode (Recommended)

Run both backend and frontend concurrently from the root directory:

```bash
npm run dev
```

This will start:
- Backend API server on `http://localhost:3000`
- Frontend dev server on `http://localhost:5173` (or next available port)

#### Individual Services

You can also run each service separately:

**Backend only:**
```bash
# From root directory (runs production build)
npm run backend

# Or from backend directory (development mode with hot reload)
cd apps/backend
npm run dev
```

**Frontend only:**
```bash
# From root directory
npm run webpanel

# Or from webpanel directory
cd apps/webpanel
npm run dev
```

**Note**: The root `npm run backend` command runs the production build (`npm start`), while `npm run dev` from the backend directory uses `ts-node-dev` for hot reload during development.

#### Production Mode

**Backend:**
```bash
cd apps/backend
npm run build
npm start
```

**Frontend:**
```bash
cd apps/webpanel
npm run build
npm run preview
```

### Configuration

#### Backend Configuration

The backend can be configured via environment variables. See [apps/backend/README.md](./apps/backend/README.md) for detailed configuration options.

Default values:
- `PORT=3000` - HTTP API server port
- `WS_PORT=3001` - WebSocket server port
- `DATABASE_PATH=./data/hypanel.db` - SQLite database path
- `SERVERS_DIR=./servers` - Directory for server configurations
- `LOGS_DIR=./logs` - Directory for log files

#### Frontend Configuration

The frontend connects to the backend API. Update the API endpoint in `apps/webpanel/src/lib/api-client.ts` if your backend runs on a different port or host.

### API Documentation

#### REST API Endpoints

- `GET /api/servers` - List all servers
- `GET /api/servers/:id` - Get server details
- `POST /api/servers` - Create new server
- `DELETE /api/servers/:id` - Delete server
- `POST /api/servers/:id/start` - Start server
- `POST /api/servers/:id/stop` - Stop server
- `POST /api/servers/:id/restart` - Restart server
- `POST /api/servers/:id/command` - Send command to server
- `GET /api/servers/:id/logs` - Get server logs
- `GET /api/servers/:id/stats` - Get server resource stats
- `GET /health` - Health check

#### WebSocket

Connect to `ws://localhost:3001` (or configured WS_PORT) for real-time updates.

For detailed API documentation, see [apps/backend/README.md](./apps/backend/README.md).

### Building

**Backend:**
```bash
cd apps/backend
npm run build
```

**Frontend:**
```bash
cd apps/webpanel
npm run build
```

### Testing

**Smoke Tests:**
```bash
cd apps/backend
npm test
# or
npm run test:dev
```

Tests are run using **tsx** (TypeScript execution) and cover core workflows including:
- SQLite database operations and server persistence
- Install state machine with locking and retry logic  
- WebSocket event emission for real-time progress updates
- Full workflow integration from server creation to installation
- Filesystem safety checks

These tests use in-memory databases and mock services to avoid external dependencies and can be run as part of CI/CD pipelines.

### Linting

**Frontend:**
```bash
cd apps/webpanel
npm run lint
```

### System Service (Linux)

The backend can be run as a systemd service. See [apps/backend/README.md](./apps/backend/README.md) for detailed instructions.

## Contributing

Contributions are welcomed and encouraged! Any help fixing bugs, improving features, or enhancing documentation is greatly appreciated.

This project is currently in a test/experimental phase, so there are plenty of opportunities to help improve it. Whether you're fixing bugs, adding features, improving documentation, or suggesting enhancements, your contributions make a difference.

### How to Contribute

1. **Report Issues**: Found a bug or have a suggestion? Please open an issue on GitHub describing the problem or feature request.

2. **Submit Pull Requests**: 
   - Fork the repository
   - Create a feature branch (`git checkout -b feature/amazing-feature`)
   - Make your changes
   - Ensure code follows existing style and passes tests
   - Submit a pull request with a clear description of your changes

3. **Improve Documentation**: Help improve this README, code comments, or other documentation to make the project more accessible.

4. **Test on Different Systems**: Since this tool targets multiple Linux distributions, testing on different systems and reporting compatibility issues is valuable.

Thank you for considering contributing to Hypanel!

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Additional Documentation

- [Backend Documentation](./apps/backend/README.md) - Detailed backend setup and API documentation
- [Frontend Documentation](./apps/webpanel/README.md) - Frontend development guide
