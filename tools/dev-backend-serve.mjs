import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const serverPath = path.join(process.cwd(), "dist", "backend", "server.js");
const watchedPaths = [
  serverPath,
  path.join(process.cwd(), "dist", "backend", "schema.js"),
];

let child = null;
let restartTimer = null;
let stopping = false;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function startServer() {
  if (!fs.existsSync(serverPath)) {
    log("[dev:backend:serve] waiting for dist/backend/server.js...");
    return;
  }

  child = spawn(process.execPath, [serverPath], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (stopping) {
      return;
    }
    if (code !== 0 && signal !== null) {
      log(`[dev:backend:serve] backend exited with signal ${signal}, restarting...`);
    }
  });
}

function stopServer() {
  if (!child) {
    return;
  }
  child.kill();
  child = null;
}

function restartServer() {
  if (stopping) {
    return;
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  restartTimer = setTimeout(() => {
    restartTimer = null;
    stopServer();
    startServer();
  }, 250);
}

for (const filePath of watchedPaths) {
  fs.watchFile(filePath, { interval: 500 }, (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
      restartServer();
    }
  });
}

process.on("SIGINT", () => {
  stopping = true;
  for (const filePath of watchedPaths) {
    fs.unwatchFile(filePath);
  }
  stopServer();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopping = true;
  for (const filePath of watchedPaths) {
    fs.unwatchFile(filePath);
  }
  stopServer();
  process.exit(0);
});

startServer();
