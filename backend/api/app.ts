import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import fs from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { adminRoutes } from "./routes/admin-routes";
import { authRoutes } from "./routes/auth-routes";
import { externalRoutes } from "./routes/external-routes";
import { calculationRoutes } from "./routes/calculation-routes";
import { projectRoutes } from "./routes/project-routes";
import { reportRoutes } from "./routes/report-routes";
import { settingsRoutes } from "./routes/settings-routes";
import { timeRoutes } from "./routes/time-routes";
import { userRoutes } from "./routes/user-routes";
import { createSystemDatabase } from "../db/runtime-database";
import type { RuntimeConfig } from "../runtime/types";
import type { AppRouteConfig } from "./context";

const FRONTEND_ROOT = path.resolve(process.cwd(), "dist/frontend");
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function getFrontendPath(requestPath: string) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const cleanPath = safePath.split("?")[0].split("#")[0];
  const normalized = path.posix.normalize(cleanPath).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(FRONTEND_ROOT, normalized);
}

async function readFrontendResponse(requestPath: string) {
  const assetPath = getFrontendPath(requestPath);
  try {
    const stat = await fs.stat(assetPath);
    if (stat.isDirectory()) {
      return await fs.readFile(path.join(assetPath, "index.html"));
    }
    return await fs.readFile(assetPath);
  } catch {
    return await fs.readFile(path.join(FRONTEND_ROOT, "index.html"));
  }
}

export function createApp(config: RuntimeConfig) {
  const app = new Hono<AppRouteConfig>();

  app.use("*", async (c, next) => {
    c.set("config", config);
    await next();
  });

  app.use("/api/*", async (c, next) => {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    c.header("X-Request-Id", requestId);
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    c.header("Access-Control-Expose-Headers", "X-Request-Id");

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  });

  app.use("/api/*", async (c, next) => {
    const systemDb = await createSystemDatabase(config);
    c.set("systemDb", systemDb);
    c.set("db", systemDb);
    await next();
  });

  app.route("/api/auth", authRoutes);
  app.route("/api/external", externalRoutes);
  app.route("/api/time", timeRoutes);
  app.route("/api/users", userRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/reports", reportRoutes);
  app.route("/api/projects", projectRoutes);
  app.route("/api/calculations", calculationRoutes);
  app.route("/api/admin", adminRoutes);

  app.get("/api/health", (c) => {
    const config = c.get("config");
    return c.json({
      ok: true,
      env: config.appEnv,
      version: config.appVersion
    });
  });

  app.get("/", async (c) => {
    const body = await readFrontendResponse("/");
    const contentType = MIME_TYPES[".html"];
    return c.body(body, 200, { "Content-Type": contentType });
  });

  app.get("/*", async (c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json(
        {
          error: "API route not found",
          method: c.req.method,
          path: c.req.path,
        },
        404,
      );
    }

    const requestPath = c.req.path === "/" ? "/index.html" : c.req.path;
    const requestedFile = getFrontendPath(requestPath);
    try {
      const stat = await fs.stat(requestedFile);
      if (stat.isFile()) {
        const ext = path.extname(requestedFile).toLowerCase();
        const body = await fs.readFile(requestedFile);
        return c.body(body, 200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
      }
    } catch {
      // fall through to SPA shell
    }

    const body = await readFrontendResponse("/index.html");
    return c.body(body, 200, { "Content-Type": MIME_TYPES[".html"] });
  });

  app.notFound((c) => {
    return c.json(
      {
        error: "API route not found",
        method: c.req.method,
        path: c.req.path,
      },
      404,
    );
  });

  app.onError((error, c) => {
    const config = (() => {
      try {
        return c.get("config") as { appEnv?: string } | undefined;
      } catch {
        return undefined;
      }
    })();
    const requestId = c.res.headers.get("X-Request-Id") ?? null;
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const basePayload = {
      requestId,
      method: c.req.method,
      path: c.req.path,
      env: config?.appEnv ?? "unknown",
      errorName,
    };

    if (error instanceof HTTPException) {
      const cause = error.cause;
      const details =
        cause instanceof ZodError
          ? cause.flatten()
          : cause instanceof Error
            ? cause.message
            : cause ?? null;
      return c.json(
        {
          error: error.message,
          ...basePayload,
          details,
          ...(config?.appEnv !== "production" && cause instanceof Error ? { debugMessage: cause.message, stack: cause.stack } : {}),
        },
        error.status
      );
    }

    console.error(`[${requestId ?? "no-request-id"}] ${c.req.method} ${c.req.path}`, error);
    return c.json(
      {
        error: "Internal server error",
        ...basePayload,
        debugMessage: error instanceof Error ? error.message : String(error),
        ...(config?.appEnv !== "production" && error instanceof Error ? { stack: error.stack } : {}),
      },
      500
    );
  });

  return app;
}
