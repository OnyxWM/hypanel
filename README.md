# Hypanel

A comprehensive server management panel for Hytale game servers. Hypanel provides a modern web interface and robust backend API for managing multiple Hytale server instances, monitoring resources, and executing commands in real-time.

## Features

- 🎮 **Server Management**: Create, start, stop, restart, and delete Hytale servers
- 📊 **Real-time Monitoring**: Live resource usage tracking (CPU, memory)
- 💬 **Console Access**: Real-time console log streaming via WebSocket
- 🎨 **Modern UI**: Beautiful, responsive web interface built with React and Tailwind CSS
- 🔌 **REST API**: Comprehensive RESTful API for server operations
- 🔄 **WebSocket Support**: Real-time updates and bidirectional communication
- 💾 **Persistent Storage**: SQLite database for server configurations and state
- 📝 **Logging**: Comprehensive logging with Winston and daily log rotation

## Tech Stack

### Backend
- **Node.js** with **Express** - REST API server
- **TypeScript** - Type-safe development
- **SQLite** (better-sqlite3) - Database
- **WebSocket** (ws) - Real-time communication
- **Winston** - Logging framework
- **Zod** - Schema validation

### Frontend
- **React 19** - UI framework
- **TypeScript** - Type-safe development
- **Vite** - Build tool and dev server
- **React Router** - Client-side routing
- **Tailwind CSS** - Styling
- **Radix UI** - Accessible component primitives
- **Recharts** - Data visualization
- **React Hook Form** - Form management

## Project Structure

```
hypanel/
├── apps/
│   ├── backend/          # Node.js backend API and daemon
│   │   ├── src/
│   │   │   ├── api/      # REST API routes and middleware
│   │   │   ├── websocket/# WebSocket server
│   │   │   ├── server/   # Server management logic
│   │   │   ├── database/ # Database operations
│   │   │   └── ...
│   │   └── README.md     # Backend-specific documentation
│   │
│   └── webpanel/         # React frontend application
│       ├── src/
│       │   ├── components/# React components
│       │   ├── pages/    # Page components
│       │   ├── lib/      # Utilities and API client
│       │   └── ...
│       └── README.md     # Frontend-specific documentation
│
└── package.json          # Root package with dev scripts
```

## Prerequisites

- **Node.js** 18+ and npm
- **Linux** operating system (for running Hytale servers)
- **SQLite3** (usually included with Node.js)

## Installation

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

## Running the Project

### Development Mode (Recommended)

Run both backend and frontend concurrently from the root directory:

```bash
npm run dev
```

This will start:
- Backend API server on `http://localhost:3000`
- Frontend dev server on `http://localhost:5173` (or next available port)

### Individual Services

You can also run each service separately:

**Backend only:**
```bash
npm run backend
# or
cd apps/backend && npm run dev
```

**Frontend only:**
```bash
npm run webpanel
# or
cd apps/webpanel && npm run dev
```

### Production Mode

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

## Configuration

### Backend Configuration

The backend can be configured via environment variables. See [apps/backend/README.md](./apps/backend/README.md) for detailed configuration options.

Default values:
- `PORT=3000` - HTTP API server port
- `WS_PORT=3001` - WebSocket server port
- `DATABASE_PATH=./data/hypanel.db` - SQLite database path
- `SERVERS_DIR=./servers` - Directory for server configurations
- `LOGS_DIR=./logs` - Directory for log files

### Frontend Configuration

The frontend connects to the backend API. Update the API endpoint in `apps/webpanel/src/lib/api-client.ts` if your backend runs on a different port or host.

## API Documentation

### REST API Endpoints

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

Connect to `ws://localhost:3001` (or configured WS_PORT) for real-time updates.

For detailed API documentation, see [apps/backend/README.md](./apps/backend/README.md).

## Development

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

### Linting

**Frontend:**
```bash
cd apps/webpanel
npm run lint
```

## System Service (Linux)

The backend can be run as a systemd service. See [apps/backend/README.md](./apps/backend/README.md) for detailed instructions.

## License

MIT

## Additional Documentation

- [Backend Documentation](./apps/backend/README.md) - Detailed backend setup and API documentation
- [Frontend Documentation](./apps/webpanel/README.md) - Frontend development guide
