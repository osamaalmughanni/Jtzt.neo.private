import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireCompanyAdmin } from "../../auth/middleware";
import { userService } from "../../services/user-service";
import type { AppVariables } from "../context";

const createUserSchema = z.object({
  username: z.string().min(2),
  fullName: z.string().min(2),
  password: z.string().min(6),
  role: z.enum(["employee", "company_admin"])
});

export const userRoutes = new Hono<{ Variables: AppVariables }>();

userRoutes.use("*", authMiddleware, requireCompanyAdmin);

userRoutes.get("/", (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  return c.json({ users: userService.listUsers(session.databasePath) });
});

userRoutes.post("/", async (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }

  const body = createUserSchema.parse(await c.req.json());
  userService.createUser(session.databasePath, body);
  return c.json({ success: true });
});
