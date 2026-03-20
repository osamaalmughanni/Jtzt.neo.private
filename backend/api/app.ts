import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { adminRoutes } from "./routes/admin-routes";
import { authRoutes } from "./routes/auth-routes";
import { externalRoutes } from "./routes/external-routes";
import { projectRoutes } from "./routes/project-routes";
import { reportRoutes } from "./routes/report-routes";
import { settingsRoutes } from "./routes/settings-routes";
import { timeRoutes } from "./routes/time-routes";
import { userRoutes } from "./routes/user-routes";
import { createSystemDatabase } from "../db/runtime-database";
import { resolveRuntimeConfig } from "../runtime/env";
import type { AppRouteConfig } from "./context";

export function createApp() {
  const app = new Hono<AppRouteConfig>();

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

  app.use("*", async (c, next) => {
    const config = await resolveRuntimeConfig(c.env);
    c.set("config", config);
    const systemDb = await createSystemDatabase(config, c.env);
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
  app.route("/api/admin", adminRoutes);

  app.get("/api/health", (c) => {
    const config = c.get("config");
    return c.json({
      ok: true,
      runtime: config.runtime,
      env: config.appEnv,
      version: config.appVersion
    });
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
        return c.get("config") as { runtime?: string; appEnv?: string } | undefined;
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
      runtime: config?.runtime ?? "unknown",
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

export const app = createApp();
