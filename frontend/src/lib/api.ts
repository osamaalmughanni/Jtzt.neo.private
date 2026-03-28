import type {
  AdminLoginInput,
  CompanyApiDocsResponse,
  CompanyMigrationFileResponse,
  CompanyMigrationImportResponse,
  CompanyMigrationSchemaResponse,
  CompanyApiKeyStatusResponse,
  CompanyListResponse,
  CompanyLoginInput,
  CompanyMeResponse,
  CreateManualTimeEntryInput,
  CreateUserInput,
  DeleteTimeEntryInput,
  DeleteUserInput,
  CreateCompanyAdminInput,
  CreateInvitationCodeInput,
  CreateCompanyInput,
  CreateProjectInput,
  CreateCalculationFromPresetInput,
  CreateCalculationInput,
  CreateTaskInput,
  DashboardResponse,
  DeleteProjectInput,
  CalculationListResponse,
  CalculationValidationResponse,
  DeleteTaskInput,
  DeleteInvitationCodeInput,
  DeleteCompanyInput,
  HolidayResponse,
  DeveloperAccessTokenListResponse,
  InvitationCodeListResponse,
  LoginResponse,
  OvertimeSettingsResponse,
  RegisterCompanyInput,
  ReportRequestInput,
  ReportResponse,
  SettingsResponse,
  StartTimerInput,
  StopTimerInput,
  SystemStatsResponse,
  TimeListResponse,
  TimeOffInLieuBalanceResponse,
  SickLeaveSummaryResponse,
  VacationBalanceResponse,
  UpdateSettingsInput,
  UpdateOvertimeSettingsInput,
  UpdateProjectInput,
  UpdateCalculationInput,
  UpdateTaskInput,
  UpdateTabletCodeInput,
  UpdateTabletCodeResponse,
  UpdateUserInput,
  UserDetailResponse,
  UserListResponse,
  UpdateTimeEntryInput,
  TabletAccessInput,
  TabletAccessResponse,
  TabletCodeStatusResponse,
  TabletLoginInput,
  RotateCompanyApiKeyResponse,
  RotateDeveloperAccessTokenInput,
  RotateDeveloperAccessTokenResponse,
  ProjectTaskManagementResponse
} from "@shared/types/api";
import type { TimeEntryView } from "@shared/types/models";
import { emitAuthInvalid } from "./auth-events";

export interface ApiErrorPayload {
  error?: string;
  requestId?: string;
  method?: string;
  path?: string;
  runtime?: string;
  env?: string;
  details?: unknown;
  debugMessage?: string;
  stack?: string;
}

export class ApiRequestError extends Error {
  status: number;
  path: string;
  method: string;
  requestId: string | null;
  runtime: string | null;
  env: string | null;
  responseText: string;
  payload: ApiErrorPayload | null;

  constructor(
    message: string,
    status: number,
    options: {
      path: string;
      method: string;
      requestId?: string | null;
      runtime?: string | null;
      env?: string | null;
      responseText?: string;
      payload?: ApiErrorPayload | null;
    }
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.path = options.path;
    this.method = options.method;
    this.requestId = options.requestId ?? null;
    this.runtime = options.runtime ?? null;
    this.env = options.env ?? null;
    this.responseText = options.responseText ?? "";
    this.payload = options.payload ?? null;
  }
}

function getHeaderValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) {
    return null;
  }

  if (headers instanceof Headers) {
    return headers.get(name);
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() === name.toLowerCase()) {
        return value;
      }
    }
    return null;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return String(value);
    }
  }

  return null;
}

function parseJsonSafely<T>(value: string): T | null {
  if (!value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getRequestMethod(init?: RequestInit) {
  return init?.method?.toUpperCase() ?? "GET";
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function parseJsonResponse<T>(response: Response, path: string, method: string): Promise<T> {
  const text = await response.text();
  const parsed = parseJsonSafely<T>(text);
  if (parsed !== null) {
    return parsed;
  }

  throw new ApiRequestError("The server returned a non-JSON success response.", response.status, {
    path,
    method,
    requestId: response.headers.get("X-Request-Id"),
    responseText: text,
  });
}

async function buildApiRequestError(response: Response, path: string, method: string) {
  const responseText = await response.text();
  const payload = parseJsonSafely<ApiErrorPayload>(responseText);
  const message = payload?.error?.trim() || response.statusText || "Request failed";
  return new ApiRequestError(message, response.status, {
    path,
    method,
    requestId: response.headers.get("X-Request-Id"),
    runtime: payload?.runtime ?? null,
    env: payload?.env ?? null,
    responseText,
    payload,
  });
}

export function describeApiError(error: unknown, fallback = "Request failed") {
  if (error instanceof ApiRequestError) {
    const lines = [
      `${error.message} (${error.status})`,
      `${error.method} ${error.path}`,
    ];

    if (error.requestId) {
      lines.push(`Request ID: ${error.requestId}`);
    }
    if (error.runtime || error.env) {
      lines.push(`Runtime: ${error.runtime ?? "unknown"}${error.env ? ` / ${error.env}` : ""}`);
    }

    const detailText =
      typeof error.payload?.details === "string"
        ? error.payload.details
        : error.payload?.details
          ? JSON.stringify(error.payload.details)
          : error.payload?.debugMessage || "";
    if (detailText) {
      lines.push(detailText);
    } else if (error.responseText && !error.payload?.error) {
      lines.push(error.responseText.slice(0, 500));
    }

    return lines.join("\n");
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = getRequestMethod(init);
  const authorization = getHeaderValue(init?.headers, "Authorization");
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body != null && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers
  });

  if (!response.ok) {
    if (response.status === 401 && authorization?.startsWith("Bearer ")) {
      emitAuthInvalid({
        token: authorization.slice("Bearer ".length),
        status: response.status,
        path,
        method,
      });
    }
    throw await buildApiRequestError(response, path, method);
  }

  return parseJsonResponse<T>(response, path, method);
}

export const api = {
  companyLogin(input: CompanyLoginInput) {
    return request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  registerCompany(input: RegisterCompanyInput) {
    return request<LoginResponse>("/api/auth/register-company", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  tabletAccess(input: TabletAccessInput) {
    return request<TabletAccessResponse>("/api/auth/tablet/access", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  tabletLogin(input: TabletLoginInput) {
    return request<LoginResponse>("/api/auth/tablet/login", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  adminLogin(input: AdminLoginInput) {
    return request<LoginResponse>("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  workspaceLogin(input: { token: string }) {
    return request<LoginResponse>("/api/auth/workspace-login", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  getCompanyMe(token: string) {
    return request<CompanyMeResponse>("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  getAdminMe(token: string) {
    return request<{ username: string }>("/api/admin/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  getDashboard(token: string, targetUserId?: number, targetDay?: string) {
    const params = new URLSearchParams();
    if (targetUserId) params.set("targetUserId", String(targetUserId));
    if (targetDay) params.set("targetDay", targetDay);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<DashboardResponse>(`/api/time/dashboard${suffix}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  getTimeEntry(token: string, entryId: number, targetUserId?: number) {
    const params = new URLSearchParams();
    if (targetUserId) params.set("targetUserId", String(targetUserId));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{ entry: TimeEntryView }>(`/api/time/entry/${entryId}${suffix}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  listTimeEntries(token: string, filters: { from?: string; to?: string; targetUserId?: number }) {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.targetUserId) params.set("targetUserId", String(filters.targetUserId));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<TimeListResponse>(`/api/time/list${suffix}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  getTimeOffInLieuBalance(
    token: string,
    filters: { targetUserId?: number; excludeEntryId?: number; startDate?: string; endDate?: string },
  ) {
    const params = new URLSearchParams();
    if (filters.targetUserId) params.set("targetUserId", String(filters.targetUserId));
    if (filters.excludeEntryId) params.set("excludeEntryId", String(filters.excludeEntryId));
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<TimeOffInLieuBalanceResponse>(`/api/time/time-off-in-lieu/balance${suffix}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  getVacationBalance(
    token: string,
    filters: { targetUserId?: number; excludeEntryId?: number; startDate?: string; endDate?: string },
  ) {
    const params = new URLSearchParams();
    if (filters.targetUserId) params.set("targetUserId", String(filters.targetUserId));
    if (filters.excludeEntryId) params.set("excludeEntryId", String(filters.excludeEntryId));
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<VacationBalanceResponse>(`/api/time/vacation/balance${suffix}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  getSickLeaveSummary(token: string, filters: { targetUserId?: number }) {
    const params = new URLSearchParams();
    if (filters.targetUserId) params.set("targetUserId", String(filters.targetUserId));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<SickLeaveSummaryResponse>(`/api/time/sick-leave/summary${suffix}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  startTimer(token: string, input: StartTimerInput) {
    return request<{ entry: unknown }>("/api/time/start", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  stopTimer(token: string, input: StopTimerInput) {
    return request<{ entry: unknown }>("/api/time/stop", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  updateTimeEntry(token: string, input: UpdateTimeEntryInput) {
    return request<{ entry: unknown }>("/api/time/entry", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  createManualTimeEntry(token: string, input: CreateManualTimeEntryInput) {
    return request<{ entry: unknown }>("/api/time/entry", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  deleteTimeEntry(token: string, input: DeleteTimeEntryInput) {
    return request<{ success: boolean }>("/api/time/entry", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  listUsers(token: string, activeOnly = false) {
    return request<UserListResponse>(`/api/users${activeOnly ? "?activeOnly=1" : ""}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  listActiveUsers(token: string) {
    return request<UserListResponse>("/api/users?activeOnly=1", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  getUser(token: string, userId: number) {
    return request<UserDetailResponse>(`/api/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  createUser(token: string, input: CreateUserInput) {
    return request<{ success: boolean; userId: number }>("/api/users", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  updateUser(token: string, input: UpdateUserInput) {
    return request<{ success: boolean }>("/api/users", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  deleteUser(token: string, input: DeleteUserInput) {
    return request<{ success: boolean }>("/api/users", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  listProjectData(token: string, activeOnly = false) {
    return request<ProjectTaskManagementResponse>(`/api/projects${activeOnly ? "?activeOnly=1" : ""}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  createProject(token: string, input: CreateProjectInput) {
    return request<{ success: boolean }>("/api/projects", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  updateProject(token: string, input: UpdateProjectInput) {
    return request<{ success: boolean }>("/api/projects", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  deleteProject(token: string, input: DeleteProjectInput) {
    return request<{ success: boolean }>("/api/projects", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  listCalculations(token: string) {
    return request<CalculationListResponse>("/api/calculations", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  validateCalculation(token: string, input: { sqlText: string; chartConfig: CreateCalculationInput["chartConfig"] }) {
    return request<CalculationValidationResponse>("/api/calculations/validate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  createCalculation(token: string, input: CreateCalculationInput) {
    return request<{ success: boolean; calculationId: number }>("/api/calculations", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  updateCalculation(token: string, input: UpdateCalculationInput) {
    return request<{ success: boolean }>("/api/calculations", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  deleteCalculation(token: string, calculationId: number) {
    return request<{ success: boolean }>("/api/calculations", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ calculationId })
    });
  },

  createCalculationFromPreset(token: string, input: CreateCalculationFromPresetInput) {
    return request<{ success: boolean; calculationId: number }>("/api/calculations/from-preset", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  createTask(token: string, input: CreateTaskInput) {
    return request<{ success: boolean }>("/api/projects/tasks", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  updateTask(token: string, input: UpdateTaskInput) {
    return request<{ success: boolean }>("/api/projects/tasks/item", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  deleteTask(token: string, input: DeleteTaskInput) {
    return request<{ success: boolean }>("/api/projects/tasks/item", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  getSettings(token: string) {
    return request<SettingsResponse>("/api/settings", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  updateSettings(token: string, input: UpdateSettingsInput) {
    return request<SettingsResponse>("/api/settings", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  getOvertimeSettings(token: string) {
    return request<OvertimeSettingsResponse>("/api/settings/overtime", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  updateOvertimeSettings(token: string, input: UpdateOvertimeSettingsInput) {
    return request<OvertimeSettingsResponse>("/api/settings/overtime", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  getTabletCodeStatus(token: string) {
    return request<TabletCodeStatusResponse>("/api/settings/tablet-code", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  updateTabletCode(token: string, input: UpdateTabletCodeInput) {
    return request<UpdateTabletCodeResponse>("/api/settings/tablet-code", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  regenerateTabletCode(token: string) {
    return request<UpdateTabletCodeResponse>("/api/settings/tablet-code/regenerate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  getCompanyApiKeyStatus(token: string) {
    return request<CompanyApiKeyStatusResponse>("/api/settings/api-access", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  rotateCompanyApiKey(token: string) {
    return request<RotateCompanyApiKeyResponse>("/api/settings/api-access/rotate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  getCompanyApiDocs(token: string) {
    return request<CompanyApiDocsResponse>("/api/settings/api-access/docs", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  getPublicHolidays(token: string, country: string, year: number) {
    const params = new URLSearchParams({ country, year: String(year) });
    return request<HolidayResponse>(`/api/settings/holidays?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  previewReport(token: string, input: ReportRequestInput) {
    return request<ReportResponse>("/api/reports/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  listCompanies(token: string) {
    return request<CompanyListResponse>("/api/admin/companies", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  createCompany(token: string, input: CreateCompanyInput) {
    return request<{ company: unknown }>("/api/admin/companies/create", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  async createCompanyFromMigrationFile(token: string, input: { name: string; file: File }) {
    const formData = new FormData();
    formData.set("name", input.name);
    formData.set("file", input.file);

    const response = await fetch("/api/admin/companies/create/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    if (!response.ok) {
      throw await buildApiRequestError(response, "/api/admin/companies/create/import", "POST");
    }

    return parseJsonResponse<CompanyMigrationImportResponse>(response, "/api/admin/companies/create/import", "POST");
  },

  deleteCompany(token: string, input: DeleteCompanyInput) {
    return request<{ success: boolean }>("/api/admin/companies/delete", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  createCompanyAdmin(token: string, input: CreateCompanyAdminInput) {
    return request<{ success: boolean }>("/api/admin/companies/admins/create", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  getSystemStats(token: string) {
    return request<SystemStatsResponse>("/api/admin/stats", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  listInvitationCodes(token: string) {
    return request<InvitationCodeListResponse>("/api/admin/invitation-codes", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  listDeveloperAccessTokens(token: string) {
    return request<DeveloperAccessTokenListResponse>("/api/admin/developer-access-tokens", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  createInvitationCode(token: string, input: CreateInvitationCodeInput) {
    return request<{ invitationCode: InvitationCodeListResponse["invitationCodes"][number] }>("/api/admin/invitation-codes/create", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  deleteInvitationCode(token: string, input: DeleteInvitationCodeInput) {
    return request<{ success: boolean }>("/api/admin/invitation-codes/delete", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  rotateDeveloperAccessToken(token: string, input: RotateDeveloperAccessTokenInput) {
    return request<RotateDeveloperAccessTokenResponse>("/api/admin/developer-access-tokens/rotate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  async downloadCompanyMigrationFile(token: string, companyId: string) {
    const path = `/api/admin/companies/${companyId}/export`;
    const payload = await request<CompanyMigrationFileResponse>(path, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return {
      blob: new Blob([base64ToBytes(payload.fileBase64)], { type: payload.contentType || "application/x-sqlite3" }),
      fileName: payload.fileName || `company-${companyId}.migration.sqlite`
    };
  },

  async importCompanyMigrationFile(token: string, companyId: string, file: File) {
    const formData = new FormData();
    formData.set("file", file);

    const path = `/api/admin/companies/${companyId}/import`;
    const response = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    if (!response.ok) {
      throw await buildApiRequestError(response, path, "POST");
    }

    return parseJsonResponse<CompanyMigrationImportResponse>(response, path, "POST");
  },

  getCompanyMigrationSchema(token: string) {
    return request<CompanyMigrationSchemaResponse>("/api/admin/migration-schema", {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
};
