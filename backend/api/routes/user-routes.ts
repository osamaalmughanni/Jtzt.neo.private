import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { authMiddleware, requireCompanyUser } from "../../auth/middleware";
import { settingsService } from "../../services/settings-service";
import { userService } from "../../services/user-service";
import type { AppRouteConfig, AppVariables } from "../context";

const contractSchema = z.object({
  id: z.number().int().positive().optional(),
  hoursPerWeek: z.number().min(0),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  paymentPerHour: z.number().min(0),
  schedule: z.array(
    z.object({
      weekday: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
        z.literal(7)
      ]),
      isWorkingDay: z.boolean(),
      startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
      endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
      minutes: z.number().int().min(0)
    })
  ).length(7)
});

const createUserSchema = z.object({
  username: z.string().min(2),
  fullName: z.string().min(2),
  password: z.string().min(6),
  role: z.enum(["employee", "manager", "admin"]),
  isActive: z.boolean(),
  pinCode: z.string().regex(/^\d{4}$/),
  email: z.string().email().nullable(),
  contracts: z.array(contractSchema).max(100)
});

const updateUserSchema = createUserSchema.extend({
  userId: z.number().int().positive(),
  password: z.string().min(6).optional()
});

const deleteUserSchema = z.object({
  userId: z.number().int().positive()
});

const userIdParamsSchema = z.object({
  userId: z.coerce.number().int().positive()
});

export const userRoutes = new Hono<AppRouteConfig>();

userRoutes.use("*", authMiddleware, requireCompanyUser);

function ensureAdmin(session: AppVariables["session"]) {
  if (session.actorType !== "company_user" || session.accessMode !== "full" || session.role !== "admin") {
    throw new HTTPException(403, { message: "Admin access required" });
  }
}

function ensureManagerOrAdmin(session: AppVariables["session"]) {
  if (
    session.actorType !== "company_user" ||
    session.accessMode !== "full" ||
    (session.role !== "admin" && session.role !== "manager")
  ) {
    throw new HTTPException(403, { message: "Manager access required" });
  }
}

userRoutes.get("/", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  ensureManagerOrAdmin(session);

  return c.json({ users: await userService.listUsers(c.get("db"), session.companyId) });
});

userRoutes.get("/:userId", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  ensureAdmin(session);

  const params = userIdParamsSchema.parse(c.req.param());
  return c.json({ user: await userService.getUser(c.get("db"), session.companyId, params.userId) });
});

userRoutes.post("/", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  ensureAdmin(session);

  const body = createUserSchema.parse(await c.req.json());
  const userId = await userService.createUser(
    c.get("db"),
    session.companyId,
    body,
    (await settingsService.getBusinessNowSnapshot(c.get("db"), session.companyId)).localDay
  );
  return c.json({ success: true, userId });
});

userRoutes.put("/", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  ensureAdmin(session);

  const body = updateUserSchema.parse(await c.req.json());
  await userService.updateUser(
    c.get("db"),
    session.companyId,
    body,
    (await settingsService.getBusinessNowSnapshot(c.get("db"), session.companyId)).localDay
  );
  return c.json({ success: true });
});

userRoutes.delete("/", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  ensureAdmin(session);

  const body = deleteUserSchema.parse(await c.req.json());
  if (body.userId === session.userId) {
    throw new HTTPException(400, { message: "You cannot delete the active user" });
  }

  await userService.deleteUser(c.get("db"), session.companyId, body.userId);
  return c.json({ success: true });
});
