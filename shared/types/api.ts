import type {
  CompanyCustomField,
  CompanySettings,
  CompanyRecord,
  CalculationPresetRecord,
  CalculationRecord,
  CompanyUserDetail,
  CompanyUserListItem,
  CompanyUserProfile,
  CompanyOvertimeSettings,
  DashboardSummary,
  InvitationCodeRecord,
  DeveloperAccessTokenRecord,
  PublicHolidayRecord,
  SystemStats,
  TabletCodeStatus,
  TimeEntryView
} from "./models";
import type { TimeEntryType, UserRole, UserContract, UserContractScheduleDay } from "./models";

export interface CompanyLoginInput {
  companyName: string;
  username: string;
  password: string;
}

export interface DeveloperLoginInput {
  companyName: string;
  token: string;
}

export interface AdminLoginInput {
  token: string;
}

export interface LoginResponse {
  session: {
    token: string;
    actorType: "admin" | "company_user" | "workspace";
    accessMode?: "full" | "tablet";
    expiresAt: string;
  };
}

export interface CompanyMeResponse {
  company: CompanyRecord;
  user: CompanyUserProfile;
  accessMode: "full" | "tablet";
}

export interface AdminMeResponse {
  username: string;
}

export interface StartTimerInput {
  notes?: string;
  projectId?: number | null;
  taskId?: number | null;
  customFieldValues?: Record<string, string | number | boolean>;
}

export type StartTimerRequirementKind = "project" | "task" | "custom_field" | "policy";

export interface StartTimerRequirement {
  kind: StartTimerRequirementKind;
  label: string;
  fieldId?: string;
}

export interface StartTimerCheckResponse {
  ready: boolean;
  requirements: StartTimerRequirement[];
}

export interface StopTimerInput {
  entryId?: number;
  notes?: string;
}

export interface UpdateTimeEntryInput {
  entryId: number;
  targetUserId?: number | null;
  entryType: TimeEntryType;
  startDate: string;
  endDate?: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string;
  projectId?: number | null;
  taskId?: number | null;
  customFieldValues: Record<string, string | number | boolean>;
}

export interface DeleteTimeEntryInput {
  entryId: number;
  targetUserId?: number | null;
}

export interface TimeOffInLieuBalanceResponse {
  balance: {
    earnedMinutes: number;
    bookedMinutes: number;
    availableMinutes: number;
  };
  requestedMinutes?: number;
}

export interface VacationBalanceResponse {
  balance: {
    entitledDays: number;
    usedDays: number;
    availableDays: number;
  };
  requestedDays?: number;
}

export interface SickLeaveSummaryResponse {
  summary: {
    usedDays: number;
    elapsedDays: number;
  };
}

export interface CreateManualTimeEntryInput {
  targetUserId?: number | null;
  entryType: TimeEntryType;
  startDate: string;
  endDate?: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string;
  projectId?: number | null;
  taskId?: number | null;
  customFieldValues: Record<string, string | number | boolean>;
}

export interface TimeListQuery {
  from?: string;
  to?: string;
  targetUserId?: number;
}

export interface TimeListResponse {
  entries: TimeEntryView[];
}

export interface DashboardResponse {
  summary: DashboardSummary;
}

export type CalendarDayState = "work" | "sick_leave" | "vacation" | "time_off_in_lieu" | "mixed";

export interface DashboardPageSnapshotResponse {
  summary: DashboardSummary;
  entries: TimeEntryView[];
  calendar: {
    month: string;
    holidays: PublicHolidayRecord[];
    dayStates: Record<string, CalendarDayState>;
  };
}

export interface AppHealthResponse {
  ok: boolean;
  env: string;
  version: string;
}

export interface UserListResponse {
  users: CompanyUserListItem[];
}

export interface UserDetailResponse {
  user: CompanyUserDetail;
}

export interface UserContractInput {
  id?: number;
  hoursPerWeek: number;
  startDate: string;
  endDate: string | null;
  paymentPerHour: number;
  annualVacationDays: number;
  schedule: UserContractScheduleDay[];
}

export interface CreateUserInput {
  username: string;
  fullName: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  pinCode: string;
  email: string | null;
  customFieldValues: Record<string, string | number | boolean>;
  contracts: UserContractInput[];
}

export interface UpdateUserInput {
  userId: number;
  username: string;
  fullName: string;
  password?: string;
  role: UserRole;
  isActive: boolean;
  pinCode: string;
  email: string | null;
  customFieldValues: Record<string, string | number | boolean>;
  contracts: UserContractInput[];
}

export interface DeleteUserInput {
  userId: number;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  budget: number;
  isActive?: boolean;
  allowAllUsers: boolean;
  allowAllTasks: boolean;
  userIds?: number[];
  taskIds?: number[];
  customFieldValues: Record<string, string | number | boolean>;
}

export interface UpdateProjectInput {
  projectId: number;
  name: string;
  description?: string | null;
  budget: number;
  isActive: boolean;
  allowAllUsers: boolean;
  allowAllTasks: boolean;
  userIds: number[];
  taskIds: number[];
  customFieldValues: Record<string, string | number | boolean>;
}

export interface DeleteProjectInput {
  projectId: number;
}

export interface CreateCalculationInput {
  name: string;
  description?: string | null;
  sqlText: string;
}

export interface UpdateCalculationInput {
  calculationId: number;
  name: string;
  description?: string | null;
  sqlText: string;
}

export interface CreateCalculationFromPresetInput {
  presetKey: string;
}

export interface CalculationValidationIssue {
  level: "error" | "warning";
  message: string;
}

export interface CalculationValidationResponse {
  valid: boolean;
  issues: CalculationValidationIssue[];
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
}

export interface CalculationListResponse {
  calculations: CalculationRecord[];
  presets: CalculationPresetRecord[];
}

export interface CreateTaskInput {
  title: string;
  customFieldValues: Record<string, string | number | boolean>;
}

export interface UpdateTaskInput {
  taskId: number;
  title: string;
  isActive: boolean;
  customFieldValues: Record<string, string | number | boolean>;
}

export interface DeleteTaskInput {
  taskId: number;
}

export interface ProjectTaskManagementResponse {
  users: import("./models").CompanyUserListItem[];
  projects: import("./models").ProjectRecord[];
  tasks: import("./models").TaskRecord[];
  projectUsers: import("./models").ProjectUserAssignmentRecord[];
  projectTasks: import("./models").ProjectTaskAssignmentRecord[];
}

export interface CreateCompanyInput {
  name: string;
  adminUsername?: string;
  adminPassword?: string;
  adminFullName?: string;
}

export interface RegisterCompanyInput {
  name: string;
  adminUsername: string;
  adminPassword: string;
  adminFullName?: string;
  invitationCode: string;
}

export interface CreateCompanyAdminInput {
  companyId: string;
  username: string;
  password: string;
  fullName: string;
}

export interface DeleteCompanyInput {
  companyId: string;
}

export interface CompanySnapshot {
  company: {
    name: string;
    tabletCodeValue: string | null;
    tabletCodeHash: string | null;
    tabletCodeUpdatedAt: string | null;
    createdAt: string;
  };
  settings: {
    currency: string;
    locale: string;
    timeZone: string;
    dateTimeFormat: string;
    firstDayOfWeek: number;
    weekendDays: number[];
    editDaysLimit: number;
    insertDaysLimit: number;
    allowOneRecordPerDay: boolean;
    allowIntersectingRecords: boolean;
    allowRecordsOnHolidays: boolean;
    allowRecordsOnWeekends: boolean;
    allowFutureRecords: boolean;
    country: string;
    tabletIdleTimeoutSeconds: number;
    autoBreakAfterMinutes: number;
    autoBreakDurationMinutes: number;
    projectsEnabled: boolean;
    tasksEnabled: boolean;
    customFields: CompanyCustomField[];
    overtime: CompanyOvertimeSettings;
  } | null;
  users: Array<{
    id: number;
    username: string;
    fullName: string;
    passwordHash: string;
    role: UserRole;
    isActive: boolean;
    deletedAt: string | null;
    pinCode: string;
    email: string | null;
    customFieldValues: Record<string, string | number | boolean>;
    createdAt: string;
  }>;
  userContracts: UserContract[];
  timeEntries: Array<{
    id: number;
    userId: number;
    entryType: TimeEntryType;
    entryDate: string;
    endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  projectId: number | null;
  taskId: number | null;
  customFieldValues: Record<string, string | number | boolean>;
  createdAt: string;
  }>;
  projects: Array<{
    id: number;
    name: string;
    description: string | null;
    budget: number;
    isActive: boolean;
    allowAllUsers: boolean;
    allowAllTasks: boolean;
    userIds: number[];
    taskIds: number[];
    customFieldValues: Record<string, string | number | boolean>;
    createdAt: string;
  }>;
  tasks: Array<{
    id: number;
    title: string;
    isActive: boolean;
    customFieldValues: Record<string, string | number | boolean>;
    createdAt: string;
  }>;
  publicHolidayCache: Array<{
    countryCode: string;
    year: number;
    payloadJson: string;
    fetchedAt: string;
  }>;
}

export interface ImportCompanySnapshotInput {
  companyId: string;
}

export interface CompanyListResponse {
  companies: CompanyRecord[];
}

export interface SystemStatsResponse {
  stats: SystemStats;
}

export interface InvitationCodeListResponse {
  invitationCodes: InvitationCodeRecord[];
}

export interface DeveloperAccessTokenListResponse {
  developerAccessTokens: DeveloperAccessTokenRecord[];
}

export interface RotateDeveloperAccessTokenInput {
  companyId: string;
}

export interface RotateDeveloperAccessTokenResponse {
  developerAccessToken: {
    companyId: string;
    companyName: string;
    tokenHint: string;
    createdAt: string;
    rotatedAt: string;
  };
  token: string;
}

export interface CreateInvitationCodeInput {
  note?: string;
}

export interface DeleteInvitationCodeInput {
  invitationCodeId: number;
}

export interface CompanyMigrationSchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  example: string | number | null;
  foreignKey?: {
    column: string;
    referencedTable: string;
    referencedColumn: string;
  } | null;
}

export interface CompanyMigrationSchemaTable {
  tableName: string;
  fileName: string;
  importOrder: number;
  rowScope: string;
  columns: CompanyMigrationSchemaColumn[];
}

export interface CompanyMigrationSchemaResponse {
  schema: {
    format: {
      key: string;
      version: number;
      encoding: string;
      singleFile: boolean;
      fileExtension: string;
      packageTableName: string;
      schemaSource: string;
      systemSchemaSource: string;
    };
    packageMetadata: {
      tableName: string;
      description: string;
      columns: CompanyMigrationSchemaColumn[];
    };
    tables: CompanyMigrationSchemaTable[];
    notes: string[];
  };
}

export interface CompanyMigrationFileResponse {
  packageName: string;
  fileName: string;
  contentType: string;
  exportedAt: string;
  fileBase64: string;
}

export interface CompanyMigrationImportProblem {
  severity: "error" | "warning";
  stage: "file" | "metadata" | "schema" | "layout" | "validation" | "import" | "company";
  table: string | null;
  rowId: number | string | null;
  column: string | null;
  message: string;
  details: unknown;
}

export interface CompanyMigrationImportReport {
  success: boolean;
  packageKey: string | null;
  packageVersion: number | null;
  packageName: string | null;
  originalCompanyId: string | null;
  expectedSchemaHash: string;
  packageSchemaHash: string | null;
  companyName: string | null;
  tableCount: number;
  rowCount: number;
  warnings: CompanyMigrationImportProblem[];
  errors: CompanyMigrationImportProblem[];
}

export interface CompanyMigrationImportResponse {
  company: unknown;
  importReport: CompanyMigrationImportReport;
}

export interface SettingsResponse {
  settings: CompanySettings;
}

export interface OvertimeSettingsResponse {
  overtime: CompanyOvertimeSettings;
}

export interface UpdateSettingsInput {
  currency: string;
  locale: string;
  timeZone: string;
  dateTimeFormat: string;
  firstDayOfWeek: number;
  weekendDays: number[];
  editDaysLimit: number;
  insertDaysLimit: number;
  allowOneRecordPerDay: boolean;
  allowIntersectingRecords: boolean;
  allowRecordsOnHolidays: boolean;
  allowRecordsOnWeekends: boolean;
  allowFutureRecords: boolean;
  country: string;
  tabletIdleTimeoutSeconds: number;
  autoBreakAfterMinutes: number;
  autoBreakDurationMinutes: number;
  projectsEnabled: boolean;
  tasksEnabled: boolean;
  customFields: CompanyCustomField[];
  overtime: CompanyOvertimeSettings;
}

export interface UpdateOvertimeSettingsInput {
  overtime: CompanyOvertimeSettings;
}

export interface HolidayResponse {
  holidays: PublicHolidayRecord[];
  cached: boolean;
}

export interface ReportRequestInput {
  startDate: string;
  endDate: string;
  userIds: number[];
  columns: string[];
  groupBy: string[];
  totalsOnly: boolean;
}

export interface ReportColumnDefinition {
  key: string;
  label: string;
  kind: "text" | "date" | "datetime" | "duration" | "currency" | "number" | "overtime_state" | "overtime_timeline";
}

export interface ReportOvertimeSegment {
  kind: "base" | "standard_overtime" | "employee_choice" | "break";
  minutes: number;
  label: string;
}

export interface ReportOvertimeMeta {
  state: "base_only" | "daily_overtime" | "weekly_overtime" | "employee_choice" | "needs_review";
  stateLabel: string;
  reviewState: "none" | "overtime_only" | "needs_review";
  targetMinutes: number;
  workedMinutes: number;
  paidMinutes: number;
  breakMinutes: number;
  baseMinutes: number;
  standardOvertimeMinutes: number;
  employeeChoiceMinutes: number;
  weeklyOvertimeMinutes: number;
  weeklyOnlyOvertimeMinutes: number;
  overtimeMinutes: number;
  premiumPercent: number;
  premiumCreditMinutes: number;
  timeOffInLieuCreditMinutes: number;
  equivalentValueMinutes: number;
  segments: ReportOvertimeSegment[];
  summary: string;
}

export interface ReportRowMeta {
  entryId: number | null;
  userId: number | null;
  overtime: ReportOvertimeMeta | null;
}

export interface ReportResponse {
  report: {
    startDate: string;
    endDate: string;
    columns: ReportColumnDefinition[];
    rows: Array<Record<string, string | number | null>>;
    rowMeta: ReportRowMeta[];
    totals: {
      entryCount: number;
      durationMinutes: number;
      cost: number;
    };
    locale: string;
    timeZone: string;
    dateTimeFormat: string;
    currency: string;
    grouped: boolean;
    timeline: Array<{
      entryId: number;
      userId: number;
      userName: string;
      role: string;
      entryType: TimeEntryType;
      startDate: string;
      endDate: string;
      startTime: string | null;
      endTime: string | null;
      notes: string | null;
    }>;
    vacationOverview: Array<{
      userId: number;
      userName: string;
      role: string;
      entitledDays: number;
      usedDays: number;
      availableDays: number;
      currentContractVacationDays: number | null;
      currentWorkYearStart: string | null;
      currentWorkYearEnd: string | null;
      nextFullEntitlementDate: string | null;
      inInitialAccrualPhase: boolean;
      periods: Array<{
        entryId: number;
        startDate: string;
        endDate: string;
        notes: string | null;
        days: number;
      }>;
      monthBreakdown: Array<{
        label: string;
        days: number;
      }>;
    }>;
  };
}

export interface ApiErrorPayload {
  error: string;
}

export interface TabletAccessInput {
  code: string;
}

export interface TabletLoginInput {
  code: string;
  pinCode: string;
}

export interface TabletAccessResponse {
  companyName: string;
}

export interface TabletCodeStatusResponse {
  tabletCode: TabletCodeStatus;
}

export interface UpdateTabletCodeInput {
  code: string;
}

export interface UpdateTabletCodeResponse {
  tabletCode: TabletCodeStatus;
  code: string;
}

export interface CompanyApiKeyStatusResponse {
  status: {
    configured: boolean;
    createdAt: string | null;
  };
}

export interface RotateCompanyApiKeyResponse {
  apiKey: string;
  status: {
    configured: boolean;
    createdAt: string | null;
  };
}

export type CompanyApiFilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in";

export interface CompanyApiQueryFilter {
  column: string;
  operator: CompanyApiFilterOperator;
  value: string | number | boolean | null | Array<string | number | boolean | null>;
}

export interface CompanyApiQueryOrderBy {
  column: string;
  direction: "asc" | "desc";
}

export interface CompanyApiQueryInput {
  table: string;
  columns?: string[];
  filters?: CompanyApiQueryFilter[];
  orderBy?: CompanyApiQueryOrderBy[];
  limit?: number;
  offset?: number;
}

export interface CompanyApiSchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  example: string | number | null;
}

export interface CompanyApiTableSchema {
  name: string;
  columns: CompanyApiSchemaColumn[];
  defaultOrderBy: CompanyApiQueryOrderBy[];
}

export interface CompanyApiSchemaResponse {
  tables: CompanyApiTableSchema[];
}

export interface CompanyApiQueryResponse {
  table: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}

export type CompanyApiMutationAction = "insert" | "update" | "delete";

export interface CompanyApiMutationInput {
  action: CompanyApiMutationAction;
  table: string;
  values?: Record<string, string | number | boolean | null>;
  filters?: CompanyApiQueryFilter[];
}

export interface CompanyApiMutationResponse {
  action: CompanyApiMutationAction;
  table: string;
  affectedRows: number;
  insertedRowId: number | null;
}

export interface CompanyApiDocsResponse {
  docs: {
    auth: {
      header: string;
      format: string;
      basePath: string;
      storage: string;
    };
    endpoints: Array<{
      method: "GET" | "POST";
      path: string;
      title: string;
      description: string;
    }>;
    query: {
      operators: CompanyApiFilterOperator[];
      notes: string[];
      example: CompanyApiQueryInput | null;
      curlExample: string | null;
      powerQueryExample: string | null;
    };
    mutation: {
      actions: CompanyApiMutationAction[];
      notes: string[];
      examples: {
        insert: CompanyApiMutationInput | null;
        update: CompanyApiMutationInput | null;
        delete: CompanyApiMutationInput | null;
      };
      curlExamples: {
        insert: string | null;
        update: string | null;
        delete: string | null;
      };
    };
    tables: CompanyApiTableSchema[];
    markdown: string;
  };
}
