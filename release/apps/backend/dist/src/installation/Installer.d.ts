import { EventEmitter } from "events";
export type InstallProgress = {
    stage: "queued" | "downloading" | "extracting" | "verifying" | "ready" | "failed";
    progress: number;
    message: string;
    details?: any;
};
export declare class Installer extends EventEmitter {
    private activeInstallations;
    constructor();
    installServer(serverId: string): Promise<void>;
    private mockInstallation;
    private findDownloader;
    private verifyAndFixPermissions;
    private executeDownloader;
    private extractDownloadedZip;
    private parseProgressFromOutput;
    private findFileRecursively;
    private verifyInstallation;
    private updateInstallState;
    private emitProgress;
    isInstalling(serverId: string): boolean;
    getActiveInstallations(): string[];
    recoverInterruptedInstallations(): Promise<void>;
    private cleanupInstallation;
}
//# sourceMappingURL=Installer.d.ts.map