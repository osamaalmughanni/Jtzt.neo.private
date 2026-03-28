import { Hono } from "hono";
import crypto from "node:crypto";
import { z } from "zod";
import { authMiddleware, companyDbMiddleware } from "../../auth/middleware";
import { createCompanyDatabase } from "../../db/runtime-database";
import { verifyWorkspaceKeyToken } from "../../auth/jwt";
import { authService } from "../../services/auth-service";
import { systemService } from "../../services/system-service";
import type { AppRouteConfig } from "../context";

const companyLoginSchema = z.object({
  companyName: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

const developerLoginSchema = z.object({
  token: z.string().min(1)
});

const tabletAccessSchema = z.object({
  code: z.string().min(1).max(64)
});

const tabletLoginSchema = z.object({
  code: z.string().min(1).max(64),
  pinCode: z.string().min(1).max(12)
});

const companyRegistrationSchema = z
  .object({
    name: z.string().min(2),
    adminUsername: z.string().min(2),
    adminPassword: z.string().min(6),
    adminFullName: z.string().optional(),
    invitationCode: z.string().min(4),
  });

export const authRoutes = new Hono<AppRouteConfig>();

authRoutes.post("/login", async (c) => {
  const body = companyLoginSchema.parse(await c.req.json());
  const systemDb = c.get("systemDb");
  const company = await systemService.getCompanyByName(systemDb, body.companyName);
  if (!company) {
    return c.json({ error: "Invalid company credentials" }, 401);
  }
  const companyDb = await createCompanyDatabase(c.get("config"), company.id);
  return c.json({ session: await authService.loginCompanyUser(systemDb, companyDb, c.get("config"), body) });
});

authRoutes.post("/workspace-login", async (c) => {
  const body = developerLoginSchema.parse(await c.req.json());
  const systemDb = c.get("systemDb");
  const payload = await verifyWorkspaceKeyToken(c.get("config"), body.token.trim()).catch(() => null);
  if (!payload) {
    return c.json({ error: "Invalid workspace key" }, 401);
  }

  const company = await systemService.getCompanyById(systemDb, payload.companyId);
  if (!company) {
    return c.json({ error: "Invalid workspace key" }, 401);
  }

  return c.json({ session: await authService.loginWorkspaceKey(systemDb, c.get("config"), body) });
});

authRoutes.post("/register-company", async (c) => {
  const body = companyRegistrationSchema.parse(await c.req.json());
  const systemDb = c.get("systemDb");
  const companyId = crypto.randomUUID();
  const companyDb = await createCompanyDatabase(c.get("config"), companyId);
  return c.json({ session: await authService.registerCompany(systemDb, companyDb, c.get("config"), body, companyId) });
});

authRoutes.post("/tablet/access", async (c) => {
  const body = tabletAccessSchema.parse(await c.req.json());
  return c.json(await authService.getTabletAccess(c.get("systemDb"), body));
});

authRoutes.post("/tablet/login", async (c) => {
  const body = tabletLoginSchema.parse(await c.req.json());
  const systemDb = c.get("systemDb");
  const company = await systemService.getCompanyByTabletCode(systemDb, body.code);
  if (!company) {
    return c.json({ error: "Invalid tablet code" }, 401);
  }
  const companyDb = await createCompanyDatabase(c.get("config"), company.id);
  return c.json({ session: await authService.loginTabletUser(systemDb, companyDb, c.get("config"), body) });
});

authRoutes.get("/me", authMiddleware, companyDbMiddleware, async (c) => {
  const session = c.get("session");
  if (session.actorType === "workspace") {
    const company = await systemService.getCompanyById(c.get("systemDb"), session.companyId);
    if (!company) {
      return c.json({ error: "Company not found" }, 404);
    }
    return c.json({
      company,
      user: {
        id: 0,
        username: "workspace",
        fullName: session.companyName,
        role: "admin"
      },
      accessMode: session.accessMode
    });
  }
  const companySession = session as Extract<typeof session, { actorType: "company_user" }>;
  return c.json(
    await authService.getCompanySessionDetails(c.get("systemDb"), c.get("db"), {
      companyId: companySession.companyId,
      userId: companySession.userId,
      accessMode: companySession.accessMode
    })
  );
});
