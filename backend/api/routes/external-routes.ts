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

async function resolveExternalCompany(c: Hono<AppRouteConfig> extends never ? never : any) {
  const apiKey = extractApiKey(c.req.header("X-API-Key")) || getBearerToken(c.req.header("Authorization"));
  if (!apiKey) {
    return null;
  }

  return companyApiService.getCompanyByApiKey(c.get("db"), apiKey);
}

export const externalRoutes = new Hono<AppRouteConfig>();

externalRoutes.get("/", async (c) => {
  const company = await resolveExternalCompany(c);
  const docs = company ? await companyApiService.getGeneratedDocs(c.get("db")) : null;

  return c.json({
    service: "jtzt-company-api",
    ok: true,
    auth: {
      required: true,
      acceptedHeaders: ["X-API-Key", "Authorization: Bearer <key>"],
      errorExample: {
        status: 401,
        body: { error: "API key required" },
      },
    },
    endpoints: company
      ? [
          "GET /api/external",
          "GET /api/external/docs",
          "GET /api/external/schema",
          "POST /api/external/query",
          "POST /api/external/mutate",
        ]
      : [
          "GET /api/external",
          "GET /api/external/docs",
        ],
    company: company ? { id: company.id, name: company.name } : null,
    docs,
  });
});

externalRoutes.get("/docs", async (c) => {
  return c.json({
    ok: true,
    public: true,
    docs: await companyApiService.getGeneratedDocs(c.get("db")),
  });
});

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

  const company = await companyApiService.getCompanyByApiKey(c.get("db"), apiKey);
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
