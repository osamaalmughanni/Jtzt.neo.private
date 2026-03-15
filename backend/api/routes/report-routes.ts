import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { authMiddleware, requireCompanyUser } from "../../auth/middleware";
import { reportService } from "../../services/report-service";
import type { AppVariables } from "../context";

const reportSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  userIds: z.array(z.number().int().positive()).min(1).max(500),
  columns: z.array(z.string().min(1).max(120)).min(1).max(100),
  groupBy: z.array(z.string().min(1).max(120)).max(2),
  totalsOnly: z.boolean()
});

export const reportRoutes = new Hono<{ Variables: AppVariables }>();

reportRoutes.use("*", authMiddleware, requireCompanyUser);

function ensureManagerOrAdmin(session: AppVariables["session"]) {
  if (session.actorType !== "company_user" || (session.role !== "admin" && session.role !== "manager")) {
    throw new HTTPException(403, { message: "Manager access required" });
  }
}

reportRoutes.post("/preview", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  ensureManagerOrAdmin(session);
  const body = reportSchema.parse(await c.req.json());
  return c.json({ report: await reportService.generate(session.databasePath, body) });
});
