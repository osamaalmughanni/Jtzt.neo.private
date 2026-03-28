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
export type CalculationOutputMode = "table" | "chart" | "both";
export type CalculationChartType = "bar" | "line" | "area" | "pie";

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

export interface CompanyRecord {
  id: string;
  name: string;
  tabletCodeUpdatedAt?: string | null;
  createdAt: string;
}

export interface InvitationCodeRecord {
  id: number;
  code: string;
  note: string | null;
  createdAt: string;
  usedAt: string | null;
  usedByCompanyId: string | null;
  usedByCompanyName: string | null;
}

export interface DeveloperAccessTokenRecord {
  companyId: string;
  companyName: string;
  tokenHint: string;
  createdAt: string;
  rotatedAt: string;
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
  deletedAt?: string | null;
  pinCode?: string;
  email?: string | null;
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

export interface UserContract {
  id: number;
  userId: number;
  hoursPerWeek: number;
  startDate: string;
  endDate: string | null;
  paymentPerHour: number;
  annualVacationDays: number;
  schedule: UserContractScheduleDay[];
  createdAt: string;
}

export interface ProjectRecord {
  id: number;
  name: string;
  description: string | null;
  budget: number;
  isActive: boolean;
  allowAllUsers: boolean;
  allowAllTasks: boolean;
  customFieldValues: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface CalculationChartConfig {
  type: CalculationChartType;
  categoryColumn: string | null;
  valueColumn: string | null;
  seriesColumn: string | null;
  stacked: boolean;
}

export interface CalculationRecord {
  id: number;
  name: string;
  description: string | null;
  sqlText: string;
  outputMode: CalculationOutputMode;
  chartConfig: CalculationChartConfig;
  isBuiltin: boolean;
  builtinKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalculationPresetRecord {
  key: string;
  name: string;
  description: string;
  sqlText: string;
  outputMode: CalculationOutputMode;
  chartConfig: CalculationChartConfig;
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
  projectId: number | null;
  taskId: number | null;
  customFieldValues: Record<string, string | number | boolean>;
  createdAt: string;
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

export interface CompanySettings {
  currency: string;
  locale: string;
  timeZone: string;
  dateTimeFormat: string;
  firstDayOfWeek: number;
  weekendDays: number[];
  editDaysLimit: number;
  insertDaysLimit: number;
  allowOneRecordPerDay: boolean;
  allowIntersectingRecords: boolean;
  allowRecordsOnHolidays: boolean;
  allowRecordsOnWeekends: boolean;
  allowFutureRecords: boolean;
  country: string;
  tabletIdleTimeoutSeconds: number;
  autoBreakAfterMinutes: number;
  autoBreakDurationMinutes: number;
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

export interface TaskRecord {
  id: number;
  title: string;
  isActive: boolean;
  customFieldValues: Record<string, string | number | boolean>;
  createdAt: string;
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
