import type {
  AdminLoginInput,
  CompanyApiDocsResponse,
  CompanyApiKeyStatusResponse,
  CompanyListResponse,
  CompanyLoginInput,
  CompanySecurityResponse,
  CompanyMeResponse,
  CreateManualTimeEntryInput,
  CreateUserInput,
  DeleteTimeEntryInput,
  DeleteUserInput,
  CreateCompanyAdminInput,
  CreateInvitationCodeInput,
  CreateCompanyInput,
  DashboardResponse,
  DeleteInvitationCodeInput,
  DeleteCompanyInput,
  HolidayResponse,
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
  VacationBalanceResponse,
  UpdateSettingsInput,
  UpdateOvertimeSettingsInput,
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
  RotateCompanyApiKeyResponse
} from "@shared/types/api";
import type { TimeEntryView } from "@shared/types/models";

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

const D1_BOOKMARK_STORAGE_KEY = "jtzt.d1-bookmark";

function buildDefaultHeaders(init?: HeadersInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(init ?? {}),
  };
}

function readD1Bookmark() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(D1_BOOKMARK_STORAGE_KEY);
}

function writeD1Bookmark(value: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!value) {
    window.localStorage.removeItem(D1_BOOKMARK_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(D1_BOOKMARK_STORAGE_KEY, value);
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
  const bookmark = readD1Bookmark();
  const method = getRequestMethod(init);
  const response = await fetch(path, {
    headers: buildDefaultHeaders({
      ...(init?.headers ?? {}),
      ...(bookmark ? { "X-D1-Bookmark": bookmark } : {}),
    }),
    ...init
  });

  writeD1Bookmark(response.headers.get("X-D1-Bookmark"));

  if (!response.ok) {
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

  getCompanySecurity(companyName: string) {
    const params = new URLSearchParams({ companyName });
    return request<CompanySecurityResponse>(`/api/auth/company-security?${params.toString()}`);
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

  listUsers(token: string) {
    return request<UserListResponse>("/api/users", {
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

  async createCompanyFromSnapshot(token: string, input: { name: string; file: File }) {
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

    return parseJsonResponse<{ company: unknown }>(response, "/api/admin/companies/create/import", "POST");
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

  async downloadCompanySnapshot(token: string, companyId: string) {
    const path = `/api/admin/companies/${companyId}/export`;
    const response = await fetch(path, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw await buildApiRequestError(response, path, "GET");
    }

    return {
      blob: await response.blob(),
      fileName:
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? `company-${companyId}.snapshot.json`
    };
  },

  async importCompanySnapshot(token: string, companyId: string, file: File) {
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

    return parseJsonResponse<{ company: unknown }>(response, path, "POST");
  }
};
