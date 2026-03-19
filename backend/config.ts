import path from "node:path";

export const appConfig = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: path.resolve(process.cwd(), "data"),
  appDbPath: path.resolve(process.cwd(), "data", "app.db"),
  jwtSecret: process.env.JWT_SECRET ?? "jtzt-dev-secret",
  sessionTtlHours: 12
};
