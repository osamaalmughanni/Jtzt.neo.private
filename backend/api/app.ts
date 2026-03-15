import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./routes/auth-routes";
import { timeRoutes } from "./routes/time-routes";
import { adminRoutes } from "./routes/admin-routes";
import { reportRoutes } from "./routes/report-routes";
import { settingsRoutes } from "./routes/settings-routes";
import { userRoutes } from "./routes/user-routes";

export const app = new Hono();

app.route("/api/auth", authRoutes);
app.route("/api/time", timeRoutes);
app.route("/api/users", userRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/reports", reportRoutes);
app.route("/api/admin", adminRoutes);

app.get("/api/health", (c) => c.json({ ok: true }));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }

  console.error(error);
  return c.json({ error: "Internal server error" }, 500);
});
