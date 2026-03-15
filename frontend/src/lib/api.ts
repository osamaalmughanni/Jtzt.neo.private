import type {
  AdminLoginInput,
  CompanyListResponse,
  CompanyLoginInput,
  CompanyMeResponse,
  CreateProjectInput,
  CreateTaskInput,
  CreateUserInput,
  CreateCompanyAdminInput,
  CreateCompanyInput,
  DashboardResponse,
  DeleteCompanyInput,
  LoginResponse,
  ProjectListResponse,
  ResetCompanyInput,
  StartTimerInput,
  StopTimerInput,
  SystemStatsResponse,
  TimeListResponse,
  UserListResponse,
  UpdateTimeEntryInput
} from "@shared/types/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: "Request failed" }))) as { error?: string };
    throw new Error(error.error ?? "Request failed");
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

  getDashboard(token: string) {
    return request<DashboardResponse>("/api/time/dashboard", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  listTimeEntries(token: string, filters: { from?: string; to?: string }) {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
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

  listProjects(token: string) {
    return request<ProjectListResponse>("/api/projects", {
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

  createTask(token: string, input: CreateTaskInput) {
    return request<{ success: boolean }>("/api/projects/tasks", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  listUsers(token: string) {
    return request<UserListResponse>("/api/users", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  createUser(token: string, input: CreateUserInput) {
    return request<{ success: boolean }>("/api/users", {
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

  deleteCompany(token: string, input: DeleteCompanyInput) {
    return request<{ success: boolean }>("/api/admin/companies/delete", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input)
    });
  },

  resetCompany(token: string, input: ResetCompanyInput) {
    return request<{ success: boolean }>("/api/admin/companies/reset", {
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
  }
};
