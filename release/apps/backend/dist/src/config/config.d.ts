import { z } from "zod";
declare const configSchema: z.ZodObject<{
    port: z.ZodDefault<z.ZodNumber>;
    wsPort: z.ZodDefault<z.ZodNumber>;
    databasePath: z.ZodDefault<z.ZodString>;
    serversDir: z.ZodDefault<z.ZodString>;
    logsDir: z.ZodDefault<z.ZodString>;
    backupDir: z.ZodDefault<z.ZodString>;
    nodeEnv: z.ZodDefault<z.ZodEnum<["development", "production"]>>;
    downloaderCredentialsPath: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    port: number;
    wsPort: number;
    databasePath: string;
    serversDir: string;
    logsDir: string;
    backupDir: string;
    nodeEnv: "development" | "production";
    downloaderCredentialsPath?: string | undefined;
}, {
    port?: number | undefined;
    wsPort?: number | undefined;
    databasePath?: string | undefined;
    serversDir?: string | undefined;
    logsDir?: string | undefined;
    backupDir?: string | undefined;
    nodeEnv?: "development" | "production" | undefined;
    downloaderCredentialsPath?: string | undefined;
}>;
type Config = z.infer<typeof configSchema>;
export type { Config };
export declare const config: {
    port: number;
    wsPort: number;
    databasePath: string;
    serversDir: string;
    logsDir: string;
    backupDir: string;
    nodeEnv: "development" | "production";
    downloaderCredentialsPath?: string | undefined;
};
//# sourceMappingURL=config.d.ts.map