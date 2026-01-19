import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Get the current version from package.json
 */
export function getCurrentVersion() {
    try {
        // In development: __dirname is src/utils, so go up 2 levels to backend/
        // In production: __dirname is dist/src/utils, so go up 3 levels to backend/
        // Try both paths to handle both scenarios
        const pathsToTry = [
            path.resolve(__dirname, "..", "..", "package.json"), // Development: src/utils -> backend/package.json
            path.resolve(__dirname, "..", "..", "..", "package.json"), // Production: dist/src/utils -> backend/package.json
            path.resolve(process.cwd(), "package.json"), // Fallback: current working directory
        ];
        for (const packageJsonPath of pathsToTry) {
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
                return packageJson.version || "1.0.0";
            }
        }
        throw new Error("package.json not found in any expected location");
    }
    catch (error) {
        console.warn("Failed to read version from package.json:", error);
        return "1.0.0";
    }
}
/**
 * Compare two version strings (simple comparison, assumes semantic versioning)
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1, v2) {
    // Remove 'v' prefix if present
    const cleanV1 = v1.replace(/^v/, "");
    const cleanV2 = v2.replace(/^v/, "");
    const parts1 = cleanV1.split(".").map(Number);
    const parts2 = cleanV2.split(".").map(Number);
    // Pad shorter version with zeros
    const maxLength = Math.max(parts1.length, parts2.length);
    while (parts1.length < maxLength)
        parts1.push(0);
    while (parts2.length < maxLength)
        parts2.push(0);
    for (let i = 0; i < maxLength; i++) {
        if (parts1[i] > parts2[i])
            return 1;
        if (parts1[i] < parts2[i])
            return -1;
    }
    return 0;
}
//# sourceMappingURL=version.js.map