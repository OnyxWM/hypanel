export declare const HYPANEL_SYSTEMD_UNIT = "hypanel";
export type SystemLogLevel = "info" | "warning" | "error";
export interface JournalEntryWire {
    cursor: string;
    timestamp: number;
    level: SystemLogLevel;
    message: string;
}
/**
 * Detect if we're running in a Docker container
 * Checks for /.dockerenv file (standard Docker indicator)
 */
export declare function isDockerEnvironment(): boolean;
export declare function readUnitJournal(input: {
    unit: string;
    limit: number;
    cursor?: string;
}): Promise<{
    entries: JournalEntryWire[];
    nextCursor?: string;
}>;
export declare function queueRestartUnit(input: {
    unit: string;
    delayMs?: number;
}): void;
//# sourceMappingURL=systemd.d.ts.map