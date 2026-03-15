import { Hono } from "hono";
import fs from "node:fs";
import { z } from "zod";
import { authMiddleware, requireAdmin } from "../../auth/middleware";
import { adminService } from "../../services/admin-service";
import { authService } from "../../services/auth-service";
import { systemService } from "../../services/system-service";
import type { AppVariables } from "../context";

const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const createCompanySchema = z.object({
  name: z.string().min(2),
  adminUsername: z.string().min(2),
  adminPassword: z.string().min(6),
  adminFullName: z.string().min(2)
});

const deleteCompanySchema = z.object({
  companyId: z.number()
});

const createCompanyAdminSchema = z.object({
  companyId: z.number(),
  username: z.string().min(2),
  password: z.string().min(6),
  fullName: z.string().min(2)
});

export const adminRoutes = new Hono<{ Variables: AppVariables }>();

adminRoutes.post("/auth/login", async (c) => {
  const body = adminLoginSchema.parse(await c.req.json());
  return c.json({ session: authService.loginAdmin(body) });
});

adminRoutes.use("*", authMiddleware, requireAdmin);

adminRoutes.get("/me", (c) => {
  const session = c.get("session");
  if (session.actorType !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }
  return c.json({ username: session.username });
});

adminRoutes.get("/companies", (c) => {
  return c.json({ companies: systemService.listCompanies() });
});

adminRoutes.post("/companies/create", async (c) => {
  const body = createCompanySchema.parse(await c.req.json());
  return c.json({ company: adminService.createCompany(body) });
});

adminRoutes.post("/companies/delete", async (c) => {
  const body = deleteCompanySchema.parse(await c.req.json());
  adminService.deleteCompany(body);
  return c.json({ success: true });
});

adminRoutes.get("/companies/:companyId/download", async (c) => {
  const companyId = Number(c.req.param("companyId"));
  if (!Number.isFinite(companyId)) {
    return c.json({ error: "Invalid company id" }, 400);
  }

  const { company, filePath } = adminService.getCompanyDatabaseDownload(companyId);
  const fileName = `${company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "company"}.sqlite`;

  return c.body(fs.readFileSync(filePath), 200, {
    "Content-Type": "application/x-sqlite3",
    "Content-Disposition": `attachment; filename="${fileName}"`
  });
});

adminRoutes.post("/companies/admins/create", async (c) => {
  const body = createCompanyAdminSchema.parse(await c.req.json());
  adminService.createCompanyAdmin(body);
  return c.json({ success: true });
});

adminRoutes.get("/stats", (c) => {
  return c.json({ stats: adminService.getSystemStats() });
});
