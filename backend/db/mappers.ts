import type {
  CompanyRecord,
  CompanyUser,
  CompanyUserListItem,
  CompanyUserProfile,
  ProjectRecord,
  TaskRecord,
  TimeEntryRecord,
  TimeEntryView
} from "../../shared/types/models";
import { diffMinutes } from "../../shared/utils/time";

export function mapCompanyRecord(row: any): CompanyRecord {
  return {
    id: row.id,
    name: row.name,
    encryptionEnabled: Boolean(row.encryption_enabled),
    databasePath: row.database_path,
    createdAt: row.created_at
  };
}

export function mapCompanyUser(row: any): CompanyUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at
  };
}

export function mapCompanyUserProfile(row: any): CompanyUserProfile {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role
  };
}

export function mapCompanyUserListItem(row: any): CompanyUserListItem {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    createdAt: row.created_at
  };
}

export function mapProject(row: any): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at
  };
}

export function mapTimeEntry(row: any): TimeEntryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    startTime: row.start_time,
    endTime: row.end_time,
    notes: row.notes,
    createdAt: row.created_at
  };
}

export function mapTimeEntryView(row: any): TimeEntryView {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    projectName: row.project_name ?? null,
    startTime: row.start_time,
    endTime: row.end_time,
    notes: row.notes ?? "",
    durationMinutes: diffMinutes(row.start_time, row.end_time),
    createdAt: row.created_at
  };
}

export function mapTask(row: any): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    isActive: row.is_active,
    createdAt: row.created_at
  };
}
