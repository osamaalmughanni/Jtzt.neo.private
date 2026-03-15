import bcrypt from "bcryptjs";
import { HTTPException } from "hono/http-exception";
import type { CreateUserInput } from "../../shared/types/api";
import { getCompanyDb } from "../db/company-db";
import { mapCompanyUserListItem } from "../db/mappers";

export const userService = {
  listUsers(databasePath: string) {
    const rows = getCompanyDb(databasePath)
      .prepare("SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at DESC")
      .all();
    return rows.map(mapCompanyUserListItem);
  },

  createUser(databasePath: string, input: CreateUserInput) {
    const db = getCompanyDb(databasePath);
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(input.username);
    if (existing) {
      throw new HTTPException(409, { message: "Username already exists" });
    }

    db.prepare(
      "INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES (@username, @fullName, @passwordHash, @role, @createdAt)"
    ).run({
      username: input.username.trim(),
      fullName: input.fullName.trim(),
      passwordHash: bcrypt.hashSync(input.password, 10),
      role: input.role,
      createdAt: new Date().toISOString()
    });
  }
};
