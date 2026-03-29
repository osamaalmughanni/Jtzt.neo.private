import type { Context, Next } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createCompanyDatabase } from "../db/runtime-database";
import { users } from "../db/schema";
import type { SessionTokenPayload } from "./jwt";
import { verifySessionToken } from "./jwt";
import { systemService } from "../services/system-service";
import crypto from "node:crypto";

function extractBearerToken(header: string | undefined): string {
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing bearer token" });
  }

  return header.slice("Bearer ".length);
}

function hashAdminAccessToken(value: string) {
  return crypto.createHash("sha256").update(value.trim()).digest("hex");
}

export const authMiddleware = createMiddleware<{
  Variables: {
    session: SessionTokenPayload;
  };
}>(async (c: Context, next: Next) => {
  const token = extractBearerToken(c.req.header("Authorization"));
  try {
    const session = await verifySessionToken(c.get("config"), token);
    if (session.actorType === "admin") {
      if (session.adminAuthFingerprint !== hashAdminAccessToken(c.get("config").adminAccessToken)) {
        throw new Error("Stale admin session");
      }
      c.set("session", session);
      await next();
      return;
    }

    const company = await systemService.getCompanyById(c.get("systemDb"), session.companyId);
    if (!company) {
      throw new Error("Unknown company");
    }

    if (session.actorType === "workspace") {
      c.set("session", {
        ...session,
        companyName: company.name,
      });
      await next();
      return;
    }

    if (session.accessMode === "tablet" && session.tabletCodeUpdatedAt !== company.tabletCodeUpdatedAt) {
      throw new Error("Stale tablet session");
    }

    const companyDb = await createCompanyDatabase(c.get("config"), session.companyId);
    const user = await companyDb.orm.select({
      id: users.id,
      role: users.role,
      is_active: users.isActive,
      deleted_at: users.deletedAt,
    }).from(users).where(and(eq(users.id, session.userId), isNull(users.deletedAt))).get();

    if (!user || !user.is_active) {
      throw new Error("Inactive or missing company user");
    }

    c.set("session", {
      ...session,
      companyName: company.name,
      role: user.role,
    });
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired bearer token" });
  }
  await next();
});

export const requireAdmin = createMiddleware(async (c: Context, next: Next) => {
  const session = c.get("session") as SessionTokenPayload;
  if (session.actorType !== "admin") {
    throw new HTTPException(403, { message: "Admin access required" });
  }

  await next();
});

export const requireCompanyUser = createMiddleware(async (c: Context, next: Next) => {
  const session = c.get("session") as SessionTokenPayload;
  if (session.actorType !== "company_user" && session.actorType !== "workspace") {
    throw new HTTPException(403, { message: "Company login required" });
  }

  await next();
});

export const requireCompanyAdmin = createMiddleware(async (c: Context, next: Next) => {
  const session = c.get("session") as SessionTokenPayload;
  if (session.actorType !== "workspace" && (session.actorType !== "company_user" || session.accessMode !== "full" || session.role !== "admin")) {
    throw new HTTPException(403, { message: "Admin access required" });
  }

  await next();
});

export const requireFullCompanyAccess = createMiddleware(async (c: Context, next: Next) => {
  const session = c.get("session") as SessionTokenPayload;
  if (session.actorType !== "workspace" && (session.actorType !== "company_user" || session.accessMode !== "full")) {
    throw new HTTPException(403, { message: "Full company access required" });
  }

  await next();
});

export const companyDbMiddleware = createMiddleware(async (c: Context, next: Next) => {
  const session = c.get("session") as SessionTokenPayload;
  if (session.actorType !== "company_user" && session.actorType !== "workspace") {
    throw new HTTPException(403, { message: "Company login required" });
  }

  c.set("db", await createCompanyDatabase(c.get("config"), session.companyId));
  await next();
});

export function isWorkspaceSession(session: SessionTokenPayload): session is Extract<SessionTokenPayload, { actorType: "workspace" }> {
  return session.actorType === "workspace";
}

export function hasCompanyAccess(session: SessionTokenPayload): session is Extract<SessionTokenPayload, { actorType: "company_user" | "workspace" }> {
  return session.actorType === "workspace" || session.actorType === "company_user";
}

export function hasFullCompanyAccess(session: SessionTokenPayload): session is Extract<SessionTokenPayload, { actorType: "company_user" | "workspace" }> {
  return session.actorType === "workspace" || (session.actorType === "company_user" && session.accessMode === "full");
}

export function hasCompanyAdminAccess(session: SessionTokenPayload): session is Extract<SessionTokenPayload, { actorType: "company_user" | "workspace" }> {
  return session.actorType === "workspace" || (session.actorType === "company_user" && session.accessMode === "full" && session.role === "admin");
}

export function hasManagerOrAdminAccess(session: SessionTokenPayload): session is Extract<SessionTokenPayload, { actorType: "company_user" | "workspace" }> {
  return session.actorType === "workspace" || (session.actorType === "company_user" && session.accessMode === "full" && (session.role === "admin" || session.role === "manager"));
}
