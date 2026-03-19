import bcrypt from "bcryptjs";
import type { AppDatabase } from "./types";
import type { RuntimeConfig } from "./types";

const initializedKeys = new Set<string>();

function getRuntimeKey(config: RuntimeConfig) {
  return `${config.runtime}:${config.nodeSqlitePath}:${config.appEnv}`;
}

export async function ensureBootstrapState(db: AppDatabase, config: RuntimeConfig) {
  const key = getRuntimeKey(config);
  if (initializedKeys.has(key)) {
    return;
  }

  const row = await db.first<{ count: number }>("SELECT COUNT(*) as count FROM admins");
  if (!row || row.count === 0) {
    await db.run("INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)", [
      config.adminBootstrapUsername,
      bcrypt.hashSync(config.adminBootstrapPassword, 10),
      new Date().toISOString()
    ]);
  }

  initializedKeys.add(key);
}
