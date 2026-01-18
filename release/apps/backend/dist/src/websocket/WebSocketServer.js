import { WebSocketServer, WebSocket } from "ws";
import { logger } from "../logger/Logger.js";
import { getPlayerTracker } from "../server/PlayerTracker.js";
import { getSessionById, getSessionFromCookieHeader } from "../api/middleware/auth.js";
export class WebSocketServerManager {
    wss;
    clients;
    serverManager;
    constructor(port, serverManager) {
        this.wss = new WebSocketServer({ port });
        this.clients = new Set();
        this.serverManager = serverManager;
        this.setupServer();
        this.setupServerManagerListeners();
        this.setupPlayerTrackerListeners();
    }
    setupServer() {
        this.wss.on("connection", (ws, req) => {
            const sess = getSessionFromCookieHeader(req.headers.cookie);
            if (!sess) {
                ws.close(1008, "Unauthorized");
                return;
            }
            const client = { ws, serverId: null, sessionId: sess.id, username: sess.username };
            this.clients.add(client);
            logger.info(`WebSocket client connected (total: ${this.clients.size})`);
            ws.on("message", (message) => {
                // Session may have been revoked/expired after connect
                if (!getSessionById(client.sessionId)) {
                    try {
                        ws.close(1008, "Unauthorized");
                    }
                    finally {
                        this.clients.delete(client);
                    }
                    return;
                }
                try {
                    const data = JSON.parse(message.toString());
                    this.handleMessage(client, data);
                }
                catch (error) {
                    logger.error(`Failed to parse WebSocket message: ${error}`);
                    this.sendError(client, "Invalid message format");
                }
            });
            ws.on("close", () => {
                this.clients.delete(client);
                logger.info(`WebSocket client disconnected (total: ${this.clients.size})`);
            });
            ws.on("error", (error) => {
                logger.error(`WebSocket error: ${error.message}`);
                this.clients.delete(client);
            });
            // Send welcome message
            this.send(client, {
                type: "connected",
                message: "Connected to Hypanel WebSocket server",
            });
        });
        logger.info(`WebSocket server listening on port ${this.wss.options.port}`);
    }
    setupServerManagerListeners() {
        // Listen for server status changes
        this.serverManager.on("serverStatusChange", (serverId, status) => {
            this.broadcastToServer(serverId, {
                type: "server:status",
                serverId,
                status,
            });
        });
        // Listen for global notifications (server lifecycle, etc.)
        this.serverManager.on("notification", (notification) => {
            this.broadcastToAll({
                type: "notification",
                notification,
            });
        });
        // Listen for server logs
        this.serverManager.on("serverLog", (serverId, log) => {
            this.broadcastToServer(serverId, {
                type: "server:log",
                serverId,
                log,
            });
        });
        // Listen for server stats
        this.serverManager.on("serverStats", (serverId, stats) => {
            this.broadcastToServer(serverId, {
                type: "server:stats",
                serverId,
                stats,
            });
        });
        // Listen for installation progress
        this.serverManager.on("serverInstallProgress", (serverId, progress) => {
            this.broadcastToServer(serverId, {
                type: "server:install:progress",
                serverId,
                progress,
            });
        });
    }
    setupPlayerTrackerListeners() {
        const playerTracker = getPlayerTracker();
        // Listen for player join events
        playerTracker.on("player:join", (data) => {
            // Broadcast to clients subscribed to this server
            this.broadcastToServer(data.serverId, {
                type: "player:join",
                serverId: data.serverId,
                playerName: data.playerName,
                joinTime: data.joinTime.toISOString(),
            });
            // Also broadcast to all clients (for global players view)
            this.broadcastToAll({
                type: "player:join",
                serverId: data.serverId,
                playerName: data.playerName,
                joinTime: data.joinTime.toISOString(),
            });
        });
        // Listen for player leave events
        playerTracker.on("player:leave", (data) => {
            // Broadcast to clients subscribed to this server
            this.broadcastToServer(data.serverId, {
                type: "player:leave",
                serverId: data.serverId,
                playerName: data.playerName,
            });
            // Also broadcast to all clients (for global players view)
            this.broadcastToAll({
                type: "player:leave",
                serverId: data.serverId,
                playerName: data.playerName,
            });
        });
    }
    handleMessage(client, data) {
        switch (data.type) {
            case "subscribe":
                this.handleSubscribe(client, data.serverId);
                break;
            case "unsubscribe":
                this.handleUnsubscribe(client);
                break;
            case "command:send":
                this.handleCommand(client, data);
                break;
            default:
                this.sendError(client, `Unknown message type: ${data.type}`);
        }
    }
    handleSubscribe(client, serverId) {
        if (!serverId) {
            this.sendError(client, "serverId is required for subscribe");
            return;
        }
        // Verify server exists
        const server = this.serverManager.getServer(serverId);
        if (!server) {
            this.sendError(client, `Server ${serverId} not found`);
            return;
        }
        client.serverId = serverId;
        this.send(client, {
            type: "subscribed",
            serverId,
        });
        logger.info(`Client subscribed to server ${serverId}`);
    }
    handleUnsubscribe(client) {
        client.serverId = null;
        this.send(client, {
            type: "unsubscribed",
        });
        logger.info("Client unsubscribed");
    }
    handleCommand(client, data) {
        if (!client.serverId) {
            this.sendError(client, "Not subscribed to any server");
            return;
        }
        if (!data.command || typeof data.command !== "string") {
            this.sendError(client, "command is required");
            return;
        }
        try {
            this.serverManager.sendCommand(client.serverId, data.command);
            this.send(client, {
                type: "command:sent",
                serverId: client.serverId,
                command: data.command,
            });
        }
        catch (error) {
            this.sendError(client, error instanceof Error ? error.message : "Failed to send command");
        }
    }
    send(client, data) {
        if (client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify(data));
            }
            catch (error) {
                logger.error(`Failed to send message to client: ${error}`);
            }
        }
    }
    sendError(client, message) {
        this.send(client, {
            type: "error",
            message,
        });
    }
    broadcastToServer(serverId, data) {
        const message = JSON.stringify(data);
        let count = 0;
        for (const client of this.clients) {
            // Ensure revoked/expired sessions stop receiving broadcasts
            if (!getSessionById(client.sessionId)) {
                try {
                    // Close with "Policy Violation" (1008) to indicate unauthorized
                    if (client.ws.readyState !== WebSocket.CLOSED) {
                        client.ws.close(1008, "Unauthorized");
                    }
                }
                catch {
                    // ignore close errors
                }
                finally {
                    this.clients.delete(client);
                }
                continue;
            }
            if (client.serverId === serverId && client.ws.readyState === WebSocket.OPEN) {
                try {
                    client.ws.send(message);
                    count++;
                }
                catch (error) {
                    logger.error(`Failed to broadcast to client: ${error}`);
                }
            }
        }
        if (count > 0) {
            logger.debug(`Broadcasted to ${count} client(s) for server ${serverId}`);
        }
    }
    broadcastToAll(data) {
        const message = JSON.stringify(data);
        let count = 0;
        for (const client of this.clients) {
            // Ensure revoked/expired sessions stop receiving broadcasts
            if (!getSessionById(client.sessionId)) {
                try {
                    if (client.ws.readyState !== WebSocket.CLOSED) {
                        client.ws.close(1008, "Unauthorized");
                    }
                }
                catch {
                    // ignore close errors
                }
                finally {
                    this.clients.delete(client);
                }
                continue;
            }
            if (client.ws.readyState === WebSocket.OPEN) {
                try {
                    client.ws.send(message);
                    count++;
                }
                catch (error) {
                    logger.error(`Failed to broadcast to client: ${error}`);
                }
            }
        }
        if (count > 0) {
            logger.debug(`Broadcasted to ${count} client(s)`);
        }
    }
    close() {
        // Close all client connections
        for (const client of this.clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.close();
            }
        }
        this.clients.clear();
        // Close server
        this.wss.close();
        logger.info("WebSocket server closed");
    }
}
//# sourceMappingURL=WebSocketServer.js.map