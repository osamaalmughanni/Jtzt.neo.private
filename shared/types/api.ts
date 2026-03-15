import type {
  CompanyRecord,
  CompanyUserListItem,
  CompanyUserProfile,
  DashboardSummary,
  ProjectRecord,
  SystemStats,
  TaskRecord,
  TimeEntryView
} from "./models";

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
  projectId?: number | null;
}

export interface StopTimerInput {
  entryId?: number;
  notes?: string;
}

export interface UpdateTimeEntryInput {
  entryId: number;
  startTime: string;
  endTime: string | null;
  notes: string;
  projectId: number | null;
}

export interface TimeListQuery {
  from?: string;
  to?: string;
}

export interface TimeListResponse {
  entries: TimeEntryView[];
}

export interface DashboardResponse {
  summary: DashboardSummary;
}

export interface ProjectListResponse {
  projects: ProjectRecord[];
  tasks: TaskRecord[];
}

export interface UserListResponse {
  users: CompanyUserListItem[];
}

export interface CreateUserInput {
  username: string;
  fullName: string;
  password: string;
  role: "employee" | "company_admin";
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
