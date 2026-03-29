import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    apiKeyHash: text("api_key_hash"),
    apiKeyCreatedAt: text("api_key_created_at"),
    tabletCodeValue: text("tablet_code_value"),
    tabletCodeHash: text("tablet_code_hash"),
    tabletCodeUpdatedAt: text("tablet_code_updated_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_companies_name_lower").on(sql`lower(${table.name})`),
    uniqueIndex("idx_companies_api_key_hash").on(table.apiKeyHash).where(sql`${table.apiKeyHash} IS NOT NULL`),
    uniqueIndex("idx_companies_tablet_code_hash").on(table.tabletCodeHash).where(sql`${table.tabletCodeHash} IS NOT NULL`),
    uniqueIndex("idx_companies_tablet_code_value").on(table.tabletCodeValue).where(sql`${table.tabletCodeValue} IS NOT NULL`),
  ],
);

export const invitationCodes = sqliteTable(
  "invitation_codes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    usedAt: text("used_at"),
    usedByCompanyId: text("used_by_company_id").references(() => companies.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("invitation_codes_code_unique").on(table.code),
    index("idx_invitation_codes_status").on(table.usedAt, table.createdAt),
  ],
);

export const developerAccessTokens = sqliteTable(
  "developer_access_tokens",
  {
    companyId: text("company_id")
      .primaryKey()
      .references(() => companies.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tokenHint: text("token_hint").notNull(),
    createdAt: text("created_at").notNull(),
    rotatedAt: text("rotated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_developer_access_tokens_token_hash").on(table.tokenHash)],
);

export const systemTables = {
  companies,
  invitationCodes,
  developerAccessTokens,
};

export type SystemTables = typeof systemTables;
