import { Hono } from "hono";
import { companyApiService, externalMutationSchema, externalQuerySchema } from "../../services/company-api-service";
import type { CompanyApiMutationInput, CompanyApiQueryInput } from "../../../shared/types/api";
import type { AppRouteConfig } from "../context";

function extractApiKey(header: string | undefined) {
  return header?.trim() || "";
}

function getBearerToken(header: string | undefined) {
  return extractApiKey(header).replace(/^Bearer\s+/i, "");
}

export const externalRoutes = new Hono<AppRouteConfig>();

externalRoutes.use("*", async (c, next) => {
  const apiKey = extractApiKey(c.req.header("X-API-Key")) || getBearerToken(c.req.header("Authorization"));
  if (!apiKey) {
    return c.json({ error: "API key required" }, 401);
  }

  const company = await companyApiService.getCompanyByApiKey(c.get("db"), apiKey);
  if (!company) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  c.set("externalCompany", company);
  await next();
});

externalRoutes.get("/schema", async (c) => {
  return c.json(await companyApiService.getSchema(c.get("db")));
});

externalRoutes.post("/query", async (c) => {
  const company = c.get("externalCompany");
  const body = externalQuerySchema.parse(await c.req.json()) as CompanyApiQueryInput;
  return c.json(await companyApiService.queryTable(c.get("db"), company.id, body));
});

externalRoutes.post("/mutate", async (c) => {
  const company = c.get("externalCompany");
  const body = externalMutationSchema.parse(await c.req.json()) as CompanyApiMutationInput;
  return c.json(await companyApiService.mutateTable(c.get("db"), company.id, body));
});
