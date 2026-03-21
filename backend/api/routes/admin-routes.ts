import { Hono } from "hono";
import { z } from "zod";
import crypto from "node:crypto";
import { authMiddleware, requireAdmin } from "../../auth/middleware";
import { createCompanyDatabase } from "../../db/runtime-database";
import { adminCsvMigrationService } from "../../services/admin-csv-migration";
import { adminService } from "../../services/admin-service";
import { authService } from "../../services/auth-service";
import { systemService } from "../../services/system-service";
import type { AppRouteConfig } from "../context";

const adminLoginSchema = z.object({
  token: z.string().min(1)
});

const createCompanySchema = z.object({
  name: z.string().min(2),
  adminUsername: z.string().min(2),
  adminPassword: z.string().min(6),
  adminFullName: z.string().min(2)
});

const deleteCompanySchema = z.object({
  companyId: z.string().uuid()
});

const createCompanyAdminSchema = z.object({
  companyId: z.string().uuid(),
  username: z.string().min(2),
  password: z.string().min(6),
  fullName: z.string().min(2)
});

const createInvitationCodeSchema = z.object({
  note: z.string().trim().max(120).optional()
});

const deleteInvitationCodeSchema = z.object({
  invitationCodeId: z.number().int().positive()
});

export const adminRoutes = new Hono<AppRouteConfig>();

adminRoutes.post("/auth/login", async (c) => {
  const body = adminLoginSchema.parse(await c.req.json());
  return c.json({ session: await authService.loginAdmin(c.get("config"), body) });
});

adminRoutes.use("*", authMiddleware, requireAdmin);

adminRoutes.get("/me", (c) => {
  const session = c.get("session");
  if (session.actorType !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }
  return c.json({ username: session.username });
});

adminRoutes.get("/companies", async (c) => {
  return c.json({ companies: await systemService.listCompanies(c.get("systemDb")) });
});

adminRoutes.get("/migration-schema", async (c) => {
  return c.json({ schema: await adminCsvMigrationService.getSchema() });
});

adminRoutes.get("/invitation-codes", async (c) => {
  return c.json({ invitationCodes: await adminService.listInvitationCodes(c.get("systemDb")) });
});

adminRoutes.post("/invitation-codes/create", async (c) => {
  const body = createInvitationCodeSchema.parse(await c.req.json());
  return c.json({ invitationCode: await adminService.createInvitationCode(c.get("systemDb"), body) });
});

adminRoutes.post("/invitation-codes/delete", async (c) => {
  const body = deleteInvitationCodeSchema.parse(await c.req.json());
  await adminService.deleteInvitationCode(c.get("systemDb"), body);
  return c.json({ success: true });
});

adminRoutes.post("/companies/create", async (c) => {
  const body = createCompanySchema.parse(await c.req.json());
  const companyId = crypto.randomUUID();
  const companyDb = await createCompanyDatabase(c.get("config"), companyId, c.env);
  return c.json({ company: await adminService.createCompany(c.get("systemDb"), companyDb, body, companyId) });
});

adminRoutes.post("/companies/create/import", async (c) => {
  const formData = await c.req.formData();
  const name = String(formData.get("name") ?? "").trim();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    return c.json({ error: "CSV migration files are required" }, 400);
  }

  const companyId = crypto.randomUUID();
  const companyDb = await createCompanyDatabase(c.get("config"), companyId, c.env);
  return c.json({
    company: await adminCsvMigrationService.createCompanyFromCsv(
      c.get("systemDb"),
      companyDb,
      { files, name: name || undefined },
      companyId,
    ),
  });
});

adminRoutes.post("/companies/delete", async (c) => {
  const body = deleteCompanySchema.parse(await c.req.json());
  const companyDb = await createCompanyDatabase(c.get("config"), body.companyId, c.env);
  await adminService.deleteCompany(c.get("systemDb"), companyDb, body, { config: c.get("config"), bindings: c.env });
  return c.json({ success: true });
});

adminRoutes.get("/companies/:companyId/export", async (c) => {
  const companyId = c.req.param("companyId");
  const company = await systemService.getCompanyById(c.get("systemDb"), companyId);
  if (!company) {
    return c.json({ error: "Company not found" }, 404);
  }

  const companyDb = await createCompanyDatabase(c.get("config"), companyId, c.env);
  const exported = await adminCsvMigrationService.exportCompany(c.get("systemDb"), companyDb, companyId);
  return c.json({
    packageName: exported.packageName,
    fileName: exported.fileName,
    contentType: exported.contentType,
    exportedAt: exported.exportedAt,
    archiveBase64: exported.archiveBase64,
  });
});

adminRoutes.post("/companies/:companyId/import", async (c) => {
  const companyId = c.req.param("companyId");
  const company = await systemService.getCompanyById(c.get("systemDb"), companyId);
  if (!company) {
    return c.json({ error: "Company not found" }, 404);
  }

  const formData = await c.req.formData();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    return c.json({ error: "CSV migration files are required" }, 400);
  }

  const companyDb = await createCompanyDatabase(c.get("config"), companyId, c.env);
  return c.json({
    company: await adminCsvMigrationService.replaceCompanyFromCsv(c.get("systemDb"), companyDb, {
      companyId,
      companyName: company.name,
      files,
    }),
  });
});

adminRoutes.post("/companies/admins/create", async (c) => {
  const body = createCompanyAdminSchema.parse(await c.req.json());
  const companyDb = await createCompanyDatabase(c.get("config"), body.companyId, c.env);
  await adminService.createCompanyAdmin(c.get("systemDb"), companyDb, body);
  return c.json({ success: true });
});

adminRoutes.get("/stats", async (c) => {
  return c.json({
    stats: await adminService.getSystemStats(c.get("systemDb"), (companyId) => createCompanyDatabase(c.get("config"), companyId, c.env)),
  });
});
