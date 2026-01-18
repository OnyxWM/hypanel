import os from "os";
/**
 * Gets the server's primary non-loopback IPv4 address.
 * This is useful for displaying the actual server IP to users
 * when the bind address is set to "0.0.0.0".
 *
 * @returns The first non-loopback IPv4 address found, or "127.0.0.1" as fallback
 */
export function getServerIP() {
    const interfaces = os.networkInterfaces();
    // Priority order: prefer external-facing interfaces
    // 1. Non-internal, non-loopback IPv4
    // 2. Any non-loopback IPv4
    // 3. Fallback to localhost
    for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs)
            continue;
        // Skip loopback interfaces
        if (name.startsWith("lo") || name === "Loopback") {
            continue;
        }
        for (const addr of addrs) {
            // Prefer IPv4 - handle both string and number family types
            const addrInfo = addr;
            const family = addrInfo.family;
            // Check for IPv4: can be string "IPv4" or number 4 depending on Node.js version
            const isIPv4 = family === "IPv4" || family === 4;
            if (isIPv4) {
                // Skip internal/private addresses if we can find a public one
                // But for now, accept any non-loopback IPv4
                if (addr.address && addr.address !== "127.0.0.1") {
                    // Skip link-local addresses (169.254.x.x)
                    if (!addr.address.startsWith("169.254.")) {
                        return addr.address;
                    }
                }
            }
        }
    }
    // Second pass: if no preferred address found, accept any non-loopback IPv4
    for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs)
            continue;
        if (name.startsWith("lo") || name === "Loopback") {
            continue;
        }
        for (const addr of addrs) {
            // Handle both string and number family types
            const addrInfo = addr;
            const family = addrInfo.family;
            // Check for IPv4: can be string "IPv4" or number 4 depending on Node.js version
            const isIPv4 = family === "IPv4" || family === 4;
            if (isIPv4 &&
                addr.address &&
                addr.address !== "127.0.0.1") {
                return addr.address;
            }
        }
    }
    // Fallback to localhost
    return "127.0.0.1";
}
//# sourceMappingURL=network.js.map