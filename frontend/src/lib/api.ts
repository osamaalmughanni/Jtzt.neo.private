import type {
  AdminLoginInput,
  CompanyListResponse,
  CompanyLoginInput,
  CompanySecurityResponse,
  CompanyMeResponse,
  CreateManualTimeEntryInput,
  CreateUserInput,
  DeleteTimeEntryInput,
  DeleteUserInput,
  CreateCompanyAdminInput,
  CreateCompanyInput,
  DashboardResponse,
  DeleteCompanyInput,
  HolidayResponse,
  LoginResponse,
  RegisterCompanyInput,
  ReportRequestInput,
  ReportResponse,
  SettingsResponse,
  StartTimerInput,
  StopTimerInput,
  SystemStatsResponse,
  TimeListResponse,
  UpdateSettingsInput,
  UpdateTabletCodeInput,
  UpdateTabletCodeResponse,
  UpdateUserInput,
  UserDetailResponse,
  UserListResponse,
  UpdateTimeEntryInput,
  TabletAccessInput,
  TabletAccessResponse,
  TabletCodeStatusResponse,
  TabletLoginInput
} from "@shared/types/api";
import type { TimeEntryView } from "@shared/types/models";

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function buildDefaultHeaders(init?: HeadersInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(init ?? {}),
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: buildDefaultHeaders(init?.headers),
    ...init
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: "Request failed" }))) as { error?: string };
    throw new ApiRequestError(error.error ?? "Request failed", response.status);
  }

  return response.json() as Promise<T>;
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

  getDashboard(token: string, targetUserId?: number) {
    const params = new URLSearchParams();
    if (targetUserId) params.set("targetUserId", String(targetUserId));
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

  async createCompanyFromDb(token: string, input: { name: string; file: File }) {
    const formData = new FormData();
    formData.set("name", input.name);
    formData.set("file", input.file);

    const response = await fetch("/api/admin/companies/create/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({ error: "Request failed" }))) as { error?: string };
      throw new Error(error.error ?? "Request failed");
    }

    return response.json() as Promise<{ company: unknown }>;
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

  async downloadCompanyDb(token: string, companyId: number) {
    const response = await fetch(`/api/admin/companies/${companyId}/download`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({ error: "Request failed" }))) as { error?: string };
      throw new Error(error.error ?? "Request failed");
    }

    return {
      blob: await response.blob(),
      fileName:
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? `company-${companyId}.sqlite`
    };
  },

  async importCompanyDb(token: string, companyId: number, file: File) {
    const formData = new FormData();
    formData.set("file", file);

    const response = await fetch(`/api/admin/companies/${companyId}/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({ error: "Request failed" }))) as { error?: string };
      throw new Error(error.error ?? "Request failed");
    }

    return response.json() as Promise<{ company: unknown }>;
  }
};
