import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireCompanyUser } from "../../auth/middleware";
import { authService } from "../../services/auth-service";
import type { AppRouteConfig } from "../context";

const companyLoginSchema = z.object({
  companyName: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  encryptionKeyProof: z.string().optional()
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
    encryptionEnabled: z.boolean(),
    encryptionKdfAlgorithm: z.enum(["pbkdf2-sha256"]).optional(),
    encryptionKdfIterations: z.number().int().positive().optional(),
    encryptionKdfSalt: z.string().optional(),
    encryptionKeyVerifier: z.string().optional()
  })
  .superRefine((value, context) => {
    if (!value.encryptionEnabled) {
      return;
    }

    if (!value.encryptionKdfSalt) {
      context.addIssue({ code: "custom", message: "Secure mode requires a KDF salt", path: ["encryptionKdfSalt"] });
    }
    if (!value.encryptionKdfIterations) {
      context.addIssue({ code: "custom", message: "Secure mode requires KDF iterations", path: ["encryptionKdfIterations"] });
    }
    if (!value.encryptionKeyVerifier) {
      context.addIssue({ code: "custom", message: "Secure mode requires an encryption verifier", path: ["encryptionKeyVerifier"] });
    }
});

export const authRoutes = new Hono<AppRouteConfig>();

authRoutes.post("/login", async (c) => {
  const body = companyLoginSchema.parse(await c.req.json());
  return c.json({ session: await authService.loginCompanyUser(c.get("db"), c.get("config"), body) });
});

authRoutes.post("/register-company", async (c) => {
  const body = companyRegistrationSchema.parse(await c.req.json());
  return c.json({ session: await authService.registerCompany(c.get("db"), c.get("config"), body) });
});

authRoutes.post("/tablet/access", async (c) => {
  const body = tabletAccessSchema.parse(await c.req.json());
  return c.json(await authService.getTabletAccess(c.get("db"), body));
});

authRoutes.post("/tablet/login", async (c) => {
  const body = tabletLoginSchema.parse(await c.req.json());
  return c.json({ session: await authService.loginTabletUser(c.get("db"), c.get("config"), body) });
});

authRoutes.get("/company-security", async (c) => {
  const companyName = c.req.query("companyName");
  if (!companyName) {
    return c.json({ error: "Company name is required" }, 400);
  }

  return c.json(await authService.getCompanySecurity(c.get("db"), companyName));
});

authRoutes.get("/me", authMiddleware, requireCompanyUser, async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  return c.json(
    await authService.getCompanySessionDetails(c.get("db"), {
      companyId: session.companyId,
      userId: session.userId,
      accessMode: session.accessMode
    })
  );
});
