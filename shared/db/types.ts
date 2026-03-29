import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import {
  calculations,
  companySettings,
  companies,
  developerAccessTokens,
  invitationCodes,
  projects,
  tasks,
  timeEntries,
  userContracts,
  userContractScheduleBlocks,
  users,
} from "./schema";

export type CompanyRow = InferSelectModel<typeof companies>;
export type InvitationCodeRow = InferSelectModel<typeof invitationCodes>;
export type DeveloperAccessTokenRow = InferSelectModel<typeof developerAccessTokens>;
export type CompanySettingsRow = InferSelectModel<typeof companySettings>;
export type UserRow = InferSelectModel<typeof users>;
export type UserContractRow = InferSelectModel<typeof userContracts>;
export type UserContractScheduleBlockRow = InferSelectModel<typeof userContractScheduleBlocks>;
export type ProjectRow = InferSelectModel<typeof projects>;
export type TaskRow = InferSelectModel<typeof tasks>;
export type TimeEntryRow = InferSelectModel<typeof timeEntries>;
export type CalculationRow = InferSelectModel<typeof calculations>;

export type CompanyInsert = InferInsertModel<typeof companies>;
export type InvitationCodeInsert = InferInsertModel<typeof invitationCodes>;
export type DeveloperAccessTokenInsert = InferInsertModel<typeof developerAccessTokens>;
export type CompanySettingsInsert = InferInsertModel<typeof companySettings>;
export type UserInsert = InferInsertModel<typeof users>;
export type UserContractInsert = InferInsertModel<typeof userContracts>;
export type UserContractScheduleBlockInsert = InferInsertModel<typeof userContractScheduleBlocks>;
export type ProjectInsert = InferInsertModel<typeof projects>;
export type TaskInsert = InferInsertModel<typeof tasks>;
export type TimeEntryInsert = InferInsertModel<typeof timeEntries>;
export type CalculationInsert = InferInsertModel<typeof calculations>;
