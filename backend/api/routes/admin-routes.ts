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
  companyId: z.number()
});

const resetCompanySchema = z.object({
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

adminRoutes.post("/companies/reset", async (c) => {
  const body = resetCompanySchema.parse(await c.req.json());
  adminService.resetCompany(body);
  return c.json({ success: true });
});

adminRoutes.post("/companies/admins/create", async (c) => {
  const body = createCompanyAdminSchema.parse(await c.req.json());
  adminService.createCompanyAdmin(body);
  return c.json({ success: true });
});

adminRoutes.get("/stats", (c) => {
  return c.json({ stats: adminService.getSystemStats() });
});
