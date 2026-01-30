#!/usr/bin/env node
/**
 * Bootstrap script run before the main server (e.g. via systemd ExecStartPre).
 * If we're in a production install at /opt/hypanel and node_modules is missing
 * required deps (e.g. bcryptjs), runs chown -> npm install -> chown back so
 * the main server can start. Fixes the "update from pre-fix version" case
 * where the old update code didn't run chown before npm install.
 *
 * Uses only fs, path, child_process - no app imports (e.g. no bcryptjs).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// When run as dist/src/ensure-deps.js, backend app dir is two levels up
const backendDir = path.join(__dirname, "..", "..");

const BCRYPTJS_MARKER = path.join(backendDir, "node_modules", "bcryptjs", "package.json");
const HYPANEL_INSTALL_BACKEND = "/opt/hypanel/apps/backend";

function isProductionInstall(): boolean {
  const normalized = path.resolve(backendDir);
  return normalized === HYPANEL_INSTALL_BACKEND || normalized.startsWith("/opt/hypanel");
}

function needsInstall(): boolean {
  return !fs.existsSync(BCRYPTJS_MARKER);
}

async function ensureDeps(): Promise<void> {
  if (!isProductionInstall()) {
    return;
  }
  if (!needsInstall()) {
    return;
  }

  console.error("[ensure-deps] Missing backend deps (e.g. bcryptjs), installing...");

  try {
    await execAsync(`sudo chown -R hypanel:hypanel "${backendDir}"`, { maxBuffer: 1024 * 1024 });
  } catch (e) {
    console.error("[ensure-deps] chown to hypanel failed:", e);
    process.exit(1);
  }

  try {
    await execAsync(`cd "${backendDir}" && npm install --omit=dev`, {
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PATH: process.env.PATH },
    });
  } catch (e) {
    console.error("[ensure-deps] npm install failed:", e);
    try {
      await execAsync(`sudo chown -R root:root "${backendDir}"`, { maxBuffer: 1024 * 1024 });
    } catch {
      // ignore
    }
    process.exit(1);
  }

  try {
    await execAsync(`cd "${backendDir}" && npm rebuild better-sqlite3 || true`, {
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, PATH: process.env.PATH },
    });
  } catch {
    // optional
  }
  try {
    await execAsync(`cd "${backendDir}" && npm rebuild authenticate-pam || true`, {
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, PATH: process.env.PATH },
    });
  } catch {
    // optional
  }

  try {
    await execAsync(`sudo chown -R root:root "${backendDir}"`, { maxBuffer: 1024 * 1024 });
  } catch (e) {
    console.error("[ensure-deps] chown back to root failed:", e);
    process.exit(1);
  }

  console.error("[ensure-deps] Backend deps installed successfully");
}

ensureDeps().catch((e) => {
  console.error("[ensure-deps] Error:", e);
  process.exit(1);
});
