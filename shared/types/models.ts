export type UserRole = "employee" | "manager" | "admin";
export type TimeEntryType = "work" | "vacation" | "sick_leave";

export interface SickLeaveAttachment {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

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
  isActive?: boolean;
  pinCode?: string;
  email?: string | null;
  pictureUrl?: string | null;
  role: UserRole;
  createdAt: string;
}

export interface UserContract {
  id: number;
  userId: number;
  hoursPerWeek: number;
  startDate: string;
  endDate: string | null;
  paymentPerHour: number;
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
  entryType: TimeEntryType;
  entryDate: string;
  endDate: string | null;
  projectId: number | null;
  taskId: number | null;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  sickLeaveAttachment: SickLeaveAttachment | null;
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
  fullName: string;
  isActive: boolean;
}

export interface CompanyUserDetail {
  id: number;
  username: string;
  fullName: string;
  isActive: boolean;
  role: UserRole;
  pinCode: string;
  email: string | null;
  pictureUrl: string | null;
  contracts: UserContract[];
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
  entryType: TimeEntryType;
  entryDate: string;
  endDate: string | null;
  projectId: number | null;
  projectName: string | null;
  taskId: number | null;
  taskName: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string;
  durationMinutes: number;
  sickLeaveAttachment: SickLeaveAttachment | null;
  createdAt: string;
}

export type TrackingMode = "time" | "project" | "project_and_tasks";
export type RecordType = "all" | "start_finish" | "duration";

export interface CompanySettings {
  trackingMode: TrackingMode;
  recordType: RecordType;
  currency: string;
  locale: string;
  firstDayOfWeek: number;
  editDaysLimit: number;
  insertDaysLimit: number;
  country: string;
}

export interface PublicHolidayRecord {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
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
