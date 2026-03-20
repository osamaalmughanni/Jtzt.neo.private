import { Hono } from "hono";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { authMiddleware, requireAdmin } from "../../auth/middleware";
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

function createUploadedSqlitePath() {
  return path.join(os.tmpdir(), `jtzt-upload-${crypto.randomUUID()}.sqlite`);
}

function scheduleTempFileCleanup(filePath: string) {
  const tryDelete = (attempt = 0) => {
    fs.rm(filePath, { force: true }, (error) => {
      if (!error) {
        return;
      }
      if ((error as NodeJS.ErrnoException).code === "EBUSY" && attempt < 12) {
        setTimeout(() => tryDelete(attempt + 1), 40 * (attempt + 1));
      }
    });
  };

  tryDelete();
}

async function writeUploadedFileToTemp(file: File) {
  const tempPath = createUploadedSqlitePath();
  const writable = fs.createWriteStream(tempPath);
  await pipeline(Readable.fromWeb(file.stream() as any), writable);
  return tempPath;
}

export const adminRoutes = new Hono<AppRouteConfig>();

adminRoutes.post("/auth/login", async (c) => {
  const body = adminLoginSchema.parse(await c.req.json());
  return c.json({ session: await authService.loginAdmin(c.get("db"), c.get("config"), body) });
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
  return c.json({ companies: await systemService.listCompanies(c.get("db")) });
});

adminRoutes.get("/invitation-codes", async (c) => {
  return c.json({ invitationCodes: await adminService.listInvitationCodes(c.get("db")) });
});

adminRoutes.post("/invitation-codes/create", async (c) => {
  const body = createInvitationCodeSchema.parse(await c.req.json());
  return c.json({ invitationCode: await adminService.createInvitationCode(c.get("db"), body) });
});

adminRoutes.post("/invitation-codes/delete", async (c) => {
  const body = deleteInvitationCodeSchema.parse(await c.req.json());
  await adminService.deleteInvitationCode(c.get("db"), body);
  return c.json({ success: true });
});

adminRoutes.post("/companies/create", async (c) => {
  const body = createCompanySchema.parse(await c.req.json());
  return c.json({ company: await adminService.createCompany(c.get("db"), body) });
});

adminRoutes.post("/companies/create/import", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file");
  const name = String(formData.get("name") ?? "").trim();
  if (!(file instanceof File)) {
    return c.json({ error: "SQLite company file is required" }, 400);
  }

  const tempPath = await writeUploadedFileToTemp(file);
  try {
    const { importCompanyFromSqlite } = await import("../../services/admin-sqlite-transfer");
    const imported = importCompanyFromSqlite(c.get("config"), tempPath, { companyName: name || undefined });
    return c.json({ company: await systemService.getCompanyById(c.get("db"), imported.companyId) });
  } finally {
    scheduleTempFileCleanup(tempPath);
  }
});

adminRoutes.post("/companies/delete", async (c) => {
  const body = deleteCompanySchema.parse(await c.req.json());
  await adminService.deleteCompany(c.get("db"), body);
  return c.json({ success: true });
});

adminRoutes.get("/companies/:companyId/export", async (c) => {
  const companyId = c.req.param("companyId");
  const company = await systemService.getCompanyById(c.get("db"), companyId);
  if (!company) {
    return c.json({ error: "Company not found" }, 404);
  }

  const { exportCompanyToSqlite } = await import("../../services/admin-sqlite-transfer");
  const { filePath, fileName } = exportCompanyToSqlite(c.get("config"), companyId);
  const readStream = fs.createReadStream(filePath);
  const cleanup = () => {
    scheduleTempFileCleanup(filePath);
  };
  readStream.on("close", cleanup);
  readStream.on("error", cleanup);

  return new Response(Readable.toWeb(readStream) as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
});

adminRoutes.post("/companies/:companyId/import", async (c) => {
  const companyId = c.req.param("companyId");
  const company = await systemService.getCompanyById(c.get("db"), companyId);
  if (!company) {
    return c.json({ error: "Company not found" }, 404);
  }

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "SQLite company file is required" }, 400);
  }

  const tempPath = await writeUploadedFileToTemp(file);
  try {
    const { importCompanyFromSqlite } = await import("../../services/admin-sqlite-transfer");
    const imported = importCompanyFromSqlite(c.get("config"), tempPath, { companyId, companyName: company.name });
    return c.json({ company: await systemService.getCompanyById(c.get("db"), imported.companyId) });
  } finally {
    scheduleTempFileCleanup(tempPath);
  }
});

adminRoutes.post("/companies/admins/create", async (c) => {
  const body = createCompanyAdminSchema.parse(await c.req.json());
  await adminService.createCompanyAdmin(c.get("db"), body);
  return c.json({ success: true });
});

adminRoutes.get("/stats", async (c) => {
  return c.json({ stats: await adminService.getSystemStats(c.get("db")) });
});
