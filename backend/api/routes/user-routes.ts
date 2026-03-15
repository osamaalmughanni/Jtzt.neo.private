import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { authMiddleware, requireCompanyUser } from "../../auth/middleware";
import { userService } from "../../services/user-service";
import type { AppVariables } from "../context";

const contractSchema = z.object({
  id: z.number().int().positive().optional(),
  hoursPerWeek: z.number().min(0),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  paymentPerHour: z.number().min(0)
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

export const userRoutes = new Hono<{ Variables: AppVariables }>();

userRoutes.use("*", authMiddleware, requireCompanyUser);

function ensureAdmin(session: AppVariables["session"]) {
  if (session.actorType !== "company_user" || session.role !== "admin") {
    throw new HTTPException(403, { message: "Admin access required" });
  }
}

function ensureManagerOrAdmin(session: AppVariables["session"]) {
  if (session.actorType !== "company_user" || (session.role !== "admin" && session.role !== "manager")) {
    throw new HTTPException(403, { message: "Manager access required" });
  }
}

userRoutes.get("/", (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  ensureManagerOrAdmin(session);

  return c.json({ users: userService.listUsers(session.databasePath) });
});

userRoutes.get("/:userId", (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  ensureAdmin(session);

  const params = userIdParamsSchema.parse(c.req.param());
  return c.json({ user: userService.getUser(session.databasePath, params.userId) });
});

userRoutes.post("/", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  ensureAdmin(session);

  const body = createUserSchema.parse(await c.req.json());
  const userId = userService.createUser(session.databasePath, body);
  return c.json({ success: true, userId });
});

userRoutes.put("/", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  ensureAdmin(session);

  const body = updateUserSchema.parse(await c.req.json());
  userService.updateUser(session.databasePath, body);
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

  userService.deleteUser(session.databasePath, body.userId);
  return c.json({ success: true });
});
