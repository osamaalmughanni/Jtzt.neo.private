import type { RuntimeConfig } from "./types";

async function parseDotEnvFile(filePath: string) {
  const fs = await import("node:fs");
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const contents = fs.readFileSync(filePath, "utf8");
  const values: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

async function getNodeEnvSource() {
  const path = await import("node:path");
  const root = process.cwd();
  const fromFile = {
    ...(await parseDotEnvFile(path.resolve(root, ".env"))),
    ...(await parseDotEnvFile(path.resolve(root, ".env.local"))),
  };

  return {
    ...fromFile,
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  };
}

function toPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validateRuntimeConfig(config: RuntimeConfig) {
  const isProduction = config.appEnv === "production";
  const jwtLooksPlaceholder = config.jwtSecret.startsWith("replace-with-");
  const adminTokenLooksPlaceholder =
    config.adminAccessToken === "change-this-admin-token" ||
    config.adminAccessToken.startsWith("replace-with-");

  if (isProduction && (config.jwtSecret === "jtzt-dev-secret-change-me" || jwtLooksPlaceholder)) {
    throw new Error("JWT_SECRET must be set explicitly in production");
  }

  if (isProduction && config.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }

  if (isProduction && adminTokenLooksPlaceholder) {
    throw new Error("ADMIN_ACCESS_TOKEN must not use the default value in production");
  }

  if (isProduction && config.adminAccessToken.length < 24) {
    throw new Error("ADMIN_ACCESS_TOKEN must be at least 24 characters in production");
  }
}

export async function resolveRuntimeConfig(): Promise<RuntimeConfig> {
  const source = await getNodeEnvSource();
  const config: RuntimeConfig = {
    appEnv: source.APP_ENV?.trim() || "development",
    appVersion: source.APP_VERSION?.trim() || "dev",
    jwtSecret: source.JWT_SECRET?.trim() || "jtzt-dev-secret-change-me",
    sessionTtlHours: toPositiveInteger(source.SESSION_TTL_HOURS, 12),
    nodeSystemSqlitePath: source.NODE_SYSTEM_SQLITE_PATH?.trim() || `${process.cwd()}/data/system.db`,
    nodeCompanySqliteDir: source.NODE_COMPANY_SQLITE_DIR?.trim() || `${process.cwd()}/data/companies`,
    adminAccessToken: source.ADMIN_ACCESS_TOKEN?.trim() || source.ADMIN_BOOTSTRAP_TOKEN?.trim() || "change-this-admin-token"
  };

  validateRuntimeConfig(config);
  return config;
}
