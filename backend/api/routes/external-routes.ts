import { Hono } from "hono";
import { createCompanyDatabase } from "../../db/runtime-database";
import { companyApiService, externalMutationSchema, externalQuerySchema } from "../../services/company-api-service";
import type { CompanyApiMutationInput, CompanyApiQueryInput } from "../../../shared/types/api";
import type { AppRouteConfig } from "../context";

function extractApiKey(header: string | undefined) {
  return header?.trim() || "";
}

function getBearerToken(header: string | undefined) {
  return extractApiKey(header).replace(/^Bearer\s+/i, "");
}

async function resolveExternalCompany(c: Hono<AppRouteConfig> extends never ? never : any) {
  const apiKey = extractApiKey(c.req.header("X-API-Key")) || getBearerToken(c.req.header("Authorization"));
  if (!apiKey) {
    return null;
  }

  return companyApiService.getCompanyByApiKey(c.get("systemDb"), apiKey);
}

export const externalRoutes = new Hono<AppRouteConfig>();

externalRoutes.use("*", async (c, next) => {
  const apiKey = extractApiKey(c.req.header("X-API-Key")) || getBearerToken(c.req.header("Authorization"));
  if (!apiKey) {
    return c.json(
      {
        error: "API key required",
        acceptedHeaders: ["X-API-Key", "Authorization: Bearer <key>"],
        docs: "/api/external/docs",
      },
      401,
    );
  }

  const company = await companyApiService.getCompanyByApiKey(c.get("systemDb"), apiKey);
  if (!company) {
    return c.json(
      {
        error: "Invalid API key",
        docs: "/api/external/docs",
      },
      401,
    );
  }

  c.set("externalCompany", company);
  c.set("db", await createCompanyDatabase(c.get("config"), company.id));
  await next();
});

externalRoutes.get("/", async (c) => {
  const company = c.get("externalCompany");
  return c.json({
    service: "jtzt-company-api",
    ok: true,
    auth: {
      required: true,
      acceptedHeaders: ["X-API-Key", "Authorization: Bearer <key>"],
    },
    company: { id: company.id, name: company.name },
    endpoints: [
      "GET /api/external",
      "GET /api/external/docs",
      "GET /api/external/schema",
      "POST /api/external/query",
      "POST /api/external/mutate",
    ],
  });
});

externalRoutes.get("/docs", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({
    ok: true,
    docs: await companyApiService.getGeneratedDocs(c.get("db")),
  });
});

externalRoutes.get("/schema", async (c) => {
  c.header("Cache-Control", "no-store");
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
