import { ServerManager } from "../server/ServerManager.js";
export declare class WebSocketServerManager {
    private wss;
    private clients;
    private serverManager;
    constructor(port: number, serverManager: ServerManager);
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