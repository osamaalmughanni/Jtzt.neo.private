export type UserRole = "employee" | "manager" | "admin";
export type TimeEntryType = "work" | "vacation" | "sick_leave";
export type CompanyCustomFieldType = "text" | "number" | "date" | "boolean" | "select";

export interface CompanyCustomFieldOption {
  id: string;
  label: string;
  value: string;
}

export interface SickLeaveAttachment {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface CompanyCustomField {
  id: string;
  label: string;
  type: CompanyCustomFieldType;
  targets: TimeEntryType[];
  required: boolean;
  placeholder: string | null;
  options: CompanyCustomFieldOption[];
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
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  sickLeaveAttachment: SickLeaveAttachment | null;
  customFieldValues: Record<string, string | number | boolean>;
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
  contracts: UserContract[];
  createdAt: string;
}

export interface DashboardSummary {
  todayMinutes: number;
  weekMinutes: number;
  activeEntry: TimeEntryView | null;
  recentEntries: TimeEntryView[];
  contractStats: {
    currentContract: {
      hoursPerWeek: number;
      paymentPerHour: number;
      startDate: string;
      endDate: string | null;
    } | null;
    totalBalanceMinutes: number;
    today: {
      expectedMinutes: number;
      recordedMinutes: number;
      balanceMinutes: number;
    };
    week: {
      expectedMinutes: number;
      recordedMinutes: number;
      balanceMinutes: number;
    };
    month: {
      expectedMinutes: number;
      recordedMinutes: number;
      balanceMinutes: number;
    };
  };
}

export interface TimeEntryView {
  id: number;
  userId: number;
  entryType: TimeEntryType;
  entryDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string;
  durationMinutes: number;
  totalDayCount: number;
  effectiveDayCount: number;
  excludedHolidayCount: number;
  excludedWeekendCount: number;
  sickLeaveAttachment: SickLeaveAttachment | null;
  customFieldValues: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface CompanySettings {
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
