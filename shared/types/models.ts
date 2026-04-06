import type {
  CalculationRow,
  CompanyRow,
  CompanySettingsRow,
  DeveloperAccessTokenRow,
  InvitationCodeRow,
  ProjectRow,
  TaskRow,
  TimeEntryRow,
  UserContractRow,
  UserRow,
} from "../db/types";

export type UserRole = "employee" | "manager" | "admin";
export type TimeEntryType = "work" | "vacation" | "sick_leave" | "time_off_in_lieu";
export type CustomFieldTargetScope = "time_entry" | "user" | "project" | "task";
export type CompanyCustomFieldType = "text" | "number" | "date" | "boolean" | "select";
export type ContractWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type OvertimeCompensationType = "cash" | "time_off" | "cash_or_time_off";
export type OvertimePayoutDecisionMode = "company" | "employee" | "conditional";
export type OvertimeConflictResolution = "stack" | "highest_only";
export type OvertimeRuleTriggerKind = "daily_overtime" | "weekly_overtime" | "sunday_or_holiday" | "night_shift" | "daily_after_hours" | "weekly_after_hours";
export type OvertimePresetId = "at_default" | "de_default" | "fr_35h" | "eu_custom";

export interface CompanyCustomFieldOption {
  id: string;
  label: string;
  value: string;
}

export interface CompanyCustomFieldTarget {
  scope: CustomFieldTargetScope;
  entryTypes?: TimeEntryType[];
}

export interface CompanyCustomField {
  id: string;
  label: string;
  description: string | null;
  type: CompanyCustomFieldType;
  targets: CompanyCustomFieldTarget[];
  required: boolean;
  placeholder: string | null;
  options: CompanyCustomFieldOption[];
}

export interface CompanyOvertimeRule {
  id: string;
  category: "standard_overtime" | "sunday_holiday" | "night_shift" | "special";
  triggerKind: OvertimeRuleTriggerKind;
  afterHours: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  multiplierPercent: number;
  compensationType: OvertimeCompensationType;
}

export interface CompanyOvertimeSettings {
  version: 1;
  presetId: OvertimePresetId;
  countryCode: string | null;
  title: string;
  dailyOvertimeThresholdHours: number;
  weeklyOvertimeThresholdHours: number;
  averagingEnabled: boolean;
  averagingWeeks: number;
  rules: CompanyOvertimeRule[];
  payoutDecisionMode: OvertimePayoutDecisionMode;
  employeeChoiceAfterDailyHours: number | null;
  employeeChoiceAfterWeeklyHours: number | null;
  conflictResolution: OvertimeConflictResolution;
}

export interface UserContractScheduleBlock {
  startTime: string;
  endTime: string;
  minutes: number;
}

export type CompanyRecord = Pick<CompanyRow, "id" | "name" | "tabletCodeUpdatedAt" | "createdAt">;

export interface InvitationCodeRecord extends Pick<InvitationCodeRow, "id" | "code" | "note" | "createdAt" | "usedAt" | "usedByCompanyId"> {
  usedByCompanyName: string | null;
}

export interface DeveloperAccessTokenRecord extends Pick<DeveloperAccessTokenRow, "companyId" | "tokenHint" | "createdAt" | "rotatedAt"> {
  companyName: string;
}

export interface CompanyUser extends Omit<UserRow, "customFieldValuesJson" | "isActive"> {
  isActive: boolean;
  deletedAt: string | null;
  pinCode: string;
  email: string | null;
  customFieldValues: Record<string, string | number | boolean>;
  role: UserRole;
  createdAt: string;
}

export interface UserContractScheduleDay {
  weekday: ContractWeekday;
  isWorkingDay: boolean;
  blocks: UserContractScheduleBlock[];
  minutes: number;
}

export interface UserContract extends Omit<UserContractRow, "hoursPerWeek" | "annualVacationDays"> {
  hoursPerWeek: number;
  annualVacationDays: number;
  schedule: UserContractScheduleDay[];
}

export interface ProjectRecord extends Omit<ProjectRow, "isActive" | "allowAllUsers" | "allowAllTasks" | "customFieldValuesJson"> {
  isActive: boolean;
  allowAllUsers: boolean;
  allowAllTasks: boolean;
  customFieldValues: Record<string, string | number | boolean>;
}

export interface CalculationRecord extends Omit<CalculationRow, "isBuiltin" | "sqlText" | "outputMode"> {
  sqlText: string;
  isBuiltin: boolean;
}

export interface CalculationPresetRecord {
  key: string;
  name: string;
  description: string;
  sqlText: string;
}

export interface TimeEntryRecord extends Omit<TimeEntryRow, "entryType" | "startTime" | "endTime" | "notes" | "projectId" | "taskId" | "customFieldValuesJson"> {
  entryType: TimeEntryType;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  projectId: number | null;
  taskId: number | null;
  customFieldValues: Record<string, string | number | boolean>;
}

export interface AuthSession {
  token: string;
  actorType: "admin" | "company_user" | "workspace";
  accessMode?: "full" | "tablet";
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
  role: UserRole;
}

export interface CompanyUserDetail {
  id: number;
  username: string;
  fullName: string;
  isActive: boolean;
  role: UserRole;
  pinCode: string;
  email: string | null;
  customFieldValues: Record<string, string | number | boolean>;
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
      schedule: UserContractScheduleDay[];
    } | null;
    totalBalanceMinutes: number;
    week: {
      expectedMinutes: number;
      recordedMinutes: number;
      balanceMinutes: number;
    };
    day: {
      expectedMinutes: number;
      recordedMinutes: number;
      balanceMinutes: number;
    };
    month: {
      expectedMinutes: number;
      recordedMinutes: number;
      balanceMinutes: number;
    };
    year: {
      expectedMinutes: number;
      recordedMinutes: number;
      balanceMinutes: number;
    };
    vacation: {
      entitledDays: number;
      usedDays: number;
      availableDays: number;
    };
    timeOffInLieu: {
      earnedMinutes: number;
      bookedMinutes: number;
      availableMinutes: number;
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
  projectId: number | null;
  taskId: number | null;
  durationMinutes: number;
  totalDayCount: number;
  effectiveDayCount: number;
  excludedHolidayCount: number;
  excludedWeekendCount: number;
  customFieldValues: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface CompanySettings extends Omit<CompanySettingsRow,
  | "weekendDaysJson"
  | "allowOneRecordPerDay"
  | "allowIntersectingRecords"
  | "allowRecordsOnHolidays"
  | "allowRecordsOnWeekends"
  | "allowFutureRecords"
  | "projectsEnabled"
  | "tasksEnabled"
  | "overtimeSettingsJson"
  | "customFieldsJson"
> {
  weekendDays: number[];
  allowOneRecordPerDay: boolean;
  allowIntersectingRecords: boolean;
  allowRecordsOnHolidays: boolean;
  allowRecordsOnWeekends: boolean;
  allowFutureRecords: boolean;
  projectsEnabled: boolean;
  tasksEnabled: boolean;
  customFields: CompanyCustomField[];
  overtime: CompanyOvertimeSettings;
}

export interface TabletCodeStatus {
  configured: boolean;
  code: string | null;
  updatedAt: string | null;
}

export interface PublicHolidayRecord {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
}

export interface TaskRecord extends Omit<TaskRow, "isActive" | "customFieldValuesJson"> {
  isActive: boolean;
  customFieldValues: Record<string, string | number | boolean>;
}

export interface ProjectUserAssignmentRecord {
  projectId: number;
  userId: number;
  createdAt: string;
}

export interface ProjectTaskAssignmentRecord {
  projectId: number;
  taskId: number;
  createdAt: string;
}

export interface SystemStats {
  companyCount: number;
  activeInvitationCodeCount: number;
  totalUsers: number;
  activeTimers: number;
}
