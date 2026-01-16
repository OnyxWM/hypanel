# Hypanel Backend - Hytale Server Management Daemon

A Node.js daemon service for managing Hytale game servers on Linux. Provides REST API and WebSocket interfaces for server lifecycle management, command execution, and logging.

## Features

- Start, stop, restart, create, and delete Hytale servers
- Real-time console log streaming via WebSocket
- Resource monitoring (CPU, memory usage)
- Persistent server configurations and state
- REST API for server management
- WebSocket for real-time updates

## Prerequisites

- Node.js 18+ 
- Linux operating system
- SQLite3 (usually included with Node.js)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

3. Configure environment variables (optional):
```bash
cp .env.example .env
# Edit .env with your settings
```

## Configuration

Environment variables (defaults shown):
- `PORT=3000` - HTTP API server port
- `WS_PORT=3001` - WebSocket server port
- `DATABASE_PATH=./data/hypanel.db` - SQLite database path
- `SERVERS_DIR=./servers` - Directory for server configurations
- `LOGS_DIR=./logs` - Directory for log files
- `NODE_ENV=development` - Environment (development/production)

## Running

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### As a Linux Service (systemd)

1. Copy the service file:
```bash
sudo cp hypanel.service /etc/systemd/system/
```

2. Edit the service file to match your installation path:
```bash
sudo nano /etc/systemd/system/hypanel.service
```

3. Create the hypanel user (optional, recommended):
```bash
sudo useradd -r -s /bin/false hypanel
sudo chown -R hypanel:hypanel /opt/hypanel/backend
```

4. Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable hypanel
sudo systemctl start hypanel
```

5. Check status:
```bash
sudo systemctl status hypanel
```

## API Endpoints

### REST API

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

### WebSocket

Connect to `ws://localhost:3001` (or configured WS_PORT).

Message types:
- `subscribe` - Subscribe to a server's updates
- `unsubscribe` - Unsubscribe from current server
- `command:send` - Send command to server

Events:
- `server:status` - Server status change
- `server:log` - New console log entry
- `server:stats` - Resource statistics update

## Project Structure

```
src/
├── api/              # REST API routes and middleware
├── websocket/         # WebSocket server
├── server/            # Server management (ServerManager, ServerInstance)
├── database/          # SQLite database operations
├── storage/           # File system configuration management
├── logger/            # Winston logging setup
├── config/           # Configuration loading
├── types/            # TypeScript type definitions
├── index.ts          # Main application entry point
└── daemon.ts         # Daemon entry point
```

## License

Private project
