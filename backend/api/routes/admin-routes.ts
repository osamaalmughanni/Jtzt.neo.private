import { Hono } from "hono";
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
  companyId: z.string().uuid()
});

const createCompanyAdminSchema = z.object({
  companyId: z.string().uuid(),
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

adminRoutes.get("/companies", () => {
  return new Response(JSON.stringify({ companies: systemService.listCompanies() }), {
    headers: { "Content-Type": "application/json" }
  });
});

adminRoutes.post("/companies/create", async (c) => {
  const body = createCompanySchema.parse(await c.req.json());
  return c.json({ company: adminService.createCompany(body) });
});

adminRoutes.post("/companies/create/import", async (c) => {
  const formData = await c.req.formData();
  const name = String(formData.get("name") ?? "").trim();
  const file = formData.get("file");

  if (name.length < 2) {
    return c.json({ error: "Company name is required" }, 400);
  }
  if (!(file instanceof File)) {
    return c.json({ error: "Snapshot file is required" }, 400);
  }

  const snapshot = JSON.parse(await file.text());
  return c.json({ company: adminService.createCompanyFromSnapshot({ name, snapshot }) });
});

adminRoutes.post("/companies/delete", async (c) => {
  const body = deleteCompanySchema.parse(await c.req.json());
  adminService.deleteCompany(body);
  return c.json({ success: true });
});

adminRoutes.get("/companies/:companyId/export", (c) => {
  const companyId = c.req.param("companyId");
  const company = systemService.getCompanyById(companyId);
  if (!company) {
    return c.json({ error: "Company not found" }, 404);
  }

  const fileName = `${company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "company"}.snapshot.json`;
  return c.body(JSON.stringify(adminService.exportCompanySnapshot(companyId), null, 2), 200, {
    "Content-Type": "application/json",
    "Content-Disposition": `attachment; filename="${fileName}"`
  });
});

adminRoutes.post("/companies/:companyId/import", async (c) => {
  const companyId = c.req.param("companyId");
  const company = systemService.getCompanyById(companyId);
  if (!company) {
    return c.json({ error: "Company not found" }, 404);
  }

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "Snapshot file is required" }, 400);
  }

  const snapshot = JSON.parse(await file.text());
  return c.json({ company: adminService.replaceCompanySnapshot({ companyId, snapshot }) });
});

adminRoutes.post("/companies/admins/create", async (c) => {
  const body = createCompanyAdminSchema.parse(await c.req.json());
  adminService.createCompanyAdmin(body);
  return c.json({ success: true });
});

adminRoutes.get("/stats", (c) => {
  return c.json({ stats: adminService.getSystemStats() });
});
