import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createCompanyDatabase } from "../db/runtime-database";
import type { SessionTokenPayload } from "./jwt";
import { verifySessionToken } from "./jwt";

function extractBearerToken(header: string | undefined): string {
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing bearer token" });
  }

  return header.slice("Bearer ".length);
}

export const authMiddleware = createMiddleware<{
  Variables: {
    session: SessionTokenPayload;
  };
}>(async (c: Context, next: Next) => {
  const token = extractBearerToken(c.req.header("Authorization"));
  try {
    c.set("session", await verifySessionToken(c.get("config"), token));
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
  if (session.actorType !== "company_user") {
    throw new HTTPException(403, { message: "Company login required" });
  }

  await next();
});

export const requireCompanyAdmin = createMiddleware(async (c: Context, next: Next) => {
  const session = c.get("session") as SessionTokenPayload;
  if (session.actorType !== "company_user" || session.accessMode !== "full" || session.role !== "admin") {
    throw new HTTPException(403, { message: "Admin access required" });
  }

  await next();
});

export const requireFullCompanyAccess = createMiddleware(async (c: Context, next: Next) => {
  const session = c.get("session") as SessionTokenPayload;
  if (session.actorType !== "company_user" || session.accessMode !== "full") {
    throw new HTTPException(403, { message: "Full company access required" });
  }

  await next();
});

export const companyDbMiddleware = createMiddleware(async (c: Context, next: Next) => {
  const session = c.get("session") as SessionTokenPayload;
  if (session.actorType !== "company_user") {
    throw new HTTPException(403, { message: "Company login required" });
  }

  c.set("db", await createCompanyDatabase(c.get("config"), session.companyId));
  await next();
});
