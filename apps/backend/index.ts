/**
 * Entry point: load the real server. If the app fails to load due to missing
 * dependencies (e.g. ERR_MODULE_NOT_FOUND for bcryptjs after a failed in-app
 * update), start a minimal HTTP server that shows recovery instructions and
 * logs the same message to stderr (journal).
 */
import http from "http";

const RECOVERY_CMD =
  "cd /opt/hypanel/apps/backend && npm install --omit=dev && sudo systemctl restart hypanel";

const RECOVERY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Hypanel – Backend failed to start</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; background: #1a1a1a; color: #e4e4e7; }
    h1 { color: #f87171; }
    code { background: #27272a; color: #e4e4e7; padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.9em; }
    pre { background: #18181b; color: #a1a1aa; padding: 1rem; overflow-x: auto; border-radius: 6px; border: 1px solid #3f3f46; }
  </style>
</head>
<body>
  <h1>Backend failed to start</h1>
  <p>Dependencies are missing (e.g. after an in-app update). Run the following as <strong>root</strong> on the host:</p>
  <pre>${RECOVERY_CMD}</pre>
  <p>Then reload this page. See <code>journalctl -u hypanel -n 50</code> for logs.</p>
</body>
</html>`;

function isModuleNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return code === "ERR_MODULE_NOT_FOUND" || /Cannot find package/i.test(msg);
}

function startRecoveryServer(port: number): void {
  const log = `[hypanel] Backend failed to start (missing deps). Run as root on host:\n  ${RECOVERY_CMD}\n`;
  process.stderr.write(log);

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(RECOVERY_HTML);
  });

  server.listen(port, () => {
    process.stderr.write(`[hypanel] Recovery server listening on http://localhost:${port} – fix deps then restart service.\n`);
  });
}

const port = Number(process.env.PORT) || 3000;

try {
  await import("./server.js");
} catch (err) {
  if (isModuleNotFound(err)) {
    startRecoveryServer(port);
  } else {
    throw err;
  }
}
