export type UserRole = "employee" | "company_admin";

export interface CompanyRecord {
  id: number;
  name: string;
  encryptionEnabled: boolean;
  databasePath: string;
  createdAt: string;
}

export interface AdminRecord {
  id: number;
  username: string;
  createdAt: string;
}

export interface CompanyUser {
  id: number;
  username: string;
  fullName: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
}

export interface ProjectRecord {
  id: number;
  name: string;
  description: string | null;
  isActive: number;
  createdAt: string;
}

export interface TimeEntryRecord {
  id: number;
  userId: number;
  projectId: number | null;
  startTime: string;
  endTime: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  actorType: "admin" | "company_user";
  expiresAt: string;
}

export interface CompanyUserProfile {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
}

export interface CompanyUserListItem {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  createdAt: string;
}

export interface DashboardSummary {
  todayMinutes: number;
  weekMinutes: number;
  activeEntry: TimeEntryView | null;
  recentEntries: TimeEntryView[];
}

export interface TimeEntryView {
  id: number;
  userId: number;
  projectId: number | null;
  projectName: string | null;
  startTime: string;
  endTime: string | null;
  notes: string;
  durationMinutes: number;
  createdAt: string;
}

export interface TaskRecord {
  id: number;
  projectId: number;
  title: string;
  isActive: number;
  createdAt: string;
}

export interface SystemStats {
  companyCount: number;
  adminCount: number;
  totalUsers: number;
  activeTimers: number;
}
