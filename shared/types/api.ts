import type {
  CompanyCustomField,
  CompanySettings,
  CompanyRecord,
  CompanyUserDetail,
  CompanyUserListItem,
  CompanyUserProfile,
  DashboardSummary,
  PublicHolidayRecord,
  SystemStats,
  TimeEntryView
} from "./models";
import type { TimeEntryType, UserRole, UserContract } from "./models";

export interface CompanyLoginInput {
  companyName: string;
  username: string;
  password: string;
  encryptionKeyProof?: string;
}

export interface AdminLoginInput {
  username: string;
  password: string;
}

export interface LoginResponse {
  session: {
    token: string;
    actorType: "admin" | "company_user";
    expiresAt: string;
  };
}

export interface CompanyMeResponse {
  company: CompanyRecord;
  user: CompanyUserProfile;
}

export interface AdminMeResponse {
  username: string;
}

export interface StartTimerInput {
  notes?: string;
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
  sickLeaveAttachment: {
    fileName: string;
    mimeType: string;
    dataUrl: string;
  } | null;
  customFieldValues: Record<string, string | number | boolean>;
}

export interface DeleteTimeEntryInput {
  entryId: number;
  targetUserId?: number | null;
}

export interface CreateManualTimeEntryInput {
  targetUserId?: number | null;
  entryType: TimeEntryType;
  startDate: string;
  endDate?: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string;
  sickLeaveAttachment: {
    fileName: string;
    mimeType: string;
    dataUrl: string;
  } | null;
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
}

export interface CreateUserInput {
  username: string;
  fullName: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  pinCode: string;
  email: string | null;
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
  contracts: UserContractInput[];
}

export interface DeleteUserInput {
  userId: number;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface CreateTaskInput {
  projectId: number;
  title: string;
}

export interface CreateCompanyInput {
  name: string;
  adminUsername: string;
  adminPassword: string;
  adminFullName: string;
  encryptionEnabled?: boolean;
  encryptionKdfAlgorithm?: "pbkdf2-sha256";
  encryptionKdfIterations?: number;
  encryptionKdfSalt?: string;
  encryptionKeyVerifier?: string;
}

export interface RegisterCompanyInput {
  name: string;
  adminUsername: string;
  adminPassword: string;
  adminFullName?: string;
  encryptionEnabled: boolean;
  encryptionKdfAlgorithm?: "pbkdf2-sha256";
  encryptionKdfIterations?: number;
  encryptionKdfSalt?: string;
  encryptionKeyVerifier?: string;
}

export interface CreateCompanyAdminInput {
  companyId: number;
  username: string;
  password: string;
  fullName: string;
}

export interface DeleteCompanyInput {
  companyId: number;
}

export interface CompanyListResponse {
  companies: CompanyRecord[];
}

export interface SystemStatsResponse {
  stats: SystemStats;
}

export interface SettingsResponse {
  settings: CompanySettings;
}

export interface UpdateSettingsInput {
  currency: string;
  locale: string;
  dateTimeFormat: string;
  firstDayOfWeek: number;
  editDaysLimit: number;
  insertDaysLimit: number;
  country: string;
  autoBreakAfterMinutes: number;
  autoBreakDurationMinutes: number;
  customFields: CompanyCustomField[];
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
  kind: "text" | "date" | "datetime" | "duration" | "currency" | "number";
}

export interface ReportResponse {
  report: {
    startDate: string;
    endDate: string;
    columns: ReportColumnDefinition[];
    rows: Array<Record<string, string | number | null>>;
    totals: {
      entryCount: number;
      durationMinutes: number;
      cost: number;
    };
    locale: string;
    dateTimeFormat: string;
    currency: string;
    grouped: boolean;
  };
}

export interface ApiErrorPayload {
  error: string;
}

export interface CompanySecurityResponse {
  companyName: string;
  encryptionEnabled: boolean;
  kdfAlgorithm: "pbkdf2-sha256" | null;
  kdfIterations: number | null;
  kdfSalt: string | null;
}
