import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireCompanyUser } from "../../auth/middleware";
import { authService } from "../../services/auth-service";
import type { AppVariables } from "../context";

const companyLoginSchema = z.object({
  companyName: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1)
});

export const authRoutes = new Hono<{ Variables: AppVariables }>();

authRoutes.post("/login", async (c) => {
  const body = companyLoginSchema.parse(await c.req.json());
  return c.json({ session: authService.loginCompanyUser(body) });
});

authRoutes.get("/me", authMiddleware, requireCompanyUser, (c) => {
  const session = c.get("session");
  if (session.actorType !== "company_user") {
    return c.json({ error: "Company login required" }, 403);
  }
  return c.json(
    authService.getCompanySessionDetails({
      companyId: session.companyId,
      databasePath: session.databasePath,
      userId: session.userId
    })
  );
});
