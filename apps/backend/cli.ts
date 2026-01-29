#!/usr/bin/env node
/**
 * Hypanel CLI — e.g. hypanel hash-password (interactive or --password '...')
 * Use bcryptjs (pure JS) for hashing; output is compatible with server's bcrypt.compare().
 * Optional --output <path> writes the raw hash to a file (e.g. for Docker secrets).
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import bcrypt from "bcryptjs";

const HASH_COST = 12;
const USAGE = "Usage: hypanel hash-password [--password 'your-password'] [--output <path>]";

function getPasswordFromArgv(argv: string[]): string | null {
  const idx = argv.indexOf("--password");
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith("--")) return null;
  return value;
}

function getOutputFromArgv(argv: string[]): string | null {
  const idx = argv.indexOf("--output");
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith("--")) return null;
  return value;
}

function readPasswordInteractive(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let sttyRestored = false;
    const restoreStty = (): void => {
      if (sttyRestored) return;
      sttyRestored = true;
      try {
        execSync("stty echo", { stdio: "inherit" });
      } catch {
        // ignore
      }
    };
    try {
      execSync("stty -echo", { stdio: "inherit" });
    } catch (err) {
      rl.close();
      reject(new Error("Could not disable echo (stty). Use: hypanel hash-password --password 'your-password'"));
      return;
    }
    rl.question("Password: ", (password) => {
      restoreStty();
      process.stdout.write("\n");
      rl.close();
      resolve(password);
    });
    // Restore stty on interrupt so terminal is left in a sane state
    rl.on("close", () => restoreStty());
  });
}

async function hashPassword(): Promise<void> {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  if (subcommand !== "hash-password") {
    console.error(USAGE);
    process.exit(1);
  }

  const rest = argv.slice(1);
  const passwordArg = getPasswordFromArgv(rest);
  const outputPath = getOutputFromArgv(rest);

  let password: string;
  if (passwordArg !== null) {
    password = passwordArg;
  } else if (process.stdin.isTTY) {
    try {
      password = await readPasswordInteractive();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  } else {
    console.error("Provide --password or run with -it for interactive prompt.");
    process.exit(1);
  }

  if (!password || password.length === 0) {
    console.error("Password cannot be empty.");
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, HASH_COST);

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, hash.trim() + "\n", { mode: 0o600 });
    console.error(`Wrote hash to ${outputPath}`);
  } else {
    console.log(`HYPANEL_PASSWORD_HASH=${hash}`);
  }
}

hashPassword().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
