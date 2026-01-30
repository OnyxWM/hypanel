import { ServerManager } from "../server/ServerManager.js";
import type { Server as HttpServer } from "http";
export declare class WebSocketServerManager {
    private wss;
    private clients;
    private serverManager;
    private attachedPath;
    constructor(port: number, serverManager: ServerManager);
    constructor(httpServer: HttpServer, path: string, serverManager: ServerManager);
    private setupServer;
    private setupServerManagerListeners;
    private setupPlayerTrackerListeners;
    private handleMessage;
    private handleSubscribe;
    private handleUnsubscribe;
    private handleCommand;
    private send;
    private sendError;
    private broadcastToServer;
    private broadcastToAll;
    close(): void;
}
//# sourceMappingURL=WebSocketServer.d.ts.map