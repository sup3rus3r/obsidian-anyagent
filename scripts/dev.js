#!/usr/bin/env node
/**
 * Dev startup script — runs before launching concurrently.
 *
 * 1. Checks if obsidian-webdev-base:latest Docker image exists.
 *    If not, builds it automatically (takes ~2 min on first run).
 * 2. Starts frontend (next dev) + backend (uvicorn) concurrently.
 */

const { execSync, spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// ── 1. Ensure Docker sandbox image exists ─────────────────────────────────────

function imageExists(tag) {
  try {
    const out = execSync(`docker image inspect ${tag} --format "{{.Id}}"`, {
      stdio: ["pipe", "pipe", "pipe"],
    }).toString().trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

if (!imageExists("obsidian-webdev-base:latest")) {
  console.log("\n\x1b[33m[dev]\x1b[0m obsidian-webdev-base:latest not found — building sandbox image...");
  console.log("\x1b[2m      This only happens once. Grab a coffee ☕\x1b[0m\n");
  try {
    execSync("docker build -f backend/Dockerfile.base -t obsidian-webdev-base:latest backend/", {
      cwd: ROOT,
      stdio: "inherit",
    });
    console.log("\n\x1b[32m[dev]\x1b[0m Sandbox image built successfully.\n");
  } catch (err) {
    console.error("\n\x1b[31m[dev]\x1b[0m Failed to build sandbox image. Docker may not be running.");
    console.error("      Run manually: npm run docker:build");
    console.error("      Continuing without sandbox container support.\n");
  }
} else {
  console.log("\x1b[2m[dev] obsidian-webdev-base:latest ✓\x1b[0m");
}

// ── 2. Start concurrently ─────────────────────────────────────────────────────

const { concurrently } = require("concurrently");

const { result } = concurrently(
  [
    {
      command: "npm run dev",
      name: "fe",
      cwd: path.join(ROOT, "frontend"),
      prefixColor: "cyan",
    },
    {
      command: "uv run uvicorn main:app --reload",
      name: "be",
      cwd: path.join(ROOT, "backend"),
      prefixColor: "yellow",
    },
  ],
  { prefix: "name", restartTries: 0 }
);

result.then(() => process.exit(0)).catch(() => process.exit(1));
