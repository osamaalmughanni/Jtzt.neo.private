import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  sqliteView,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const companySettings = sqliteTable("company_settings", {
  currency: text("currency").notNull().default("EUR"),
  locale: text("locale").notNull().default("de-AT"),
  timeZone: text("time_zone").notNull().default("Europe/Vienna"),
  dateTimeFormat: text("date_time_format").notNull().default("dd.MM.yyyy HH:mm"),
  firstDayOfWeek: integer("first_day_of_week").notNull().default(1),
  weekendDaysJson: text("weekend_days_json").notNull().default("[6,7]"),
  editDaysLimit: integer("edit_days_limit").notNull().default(30),
  insertDaysLimit: integer("insert_days_limit").notNull().default(30),
  allowOneRecordPerDay: integer("allow_one_record_per_day").notNull().default(0),
  allowIntersectingRecords: integer("allow_intersecting_records").notNull().default(0),
  allowRecordsOnHolidays: integer("allow_records_on_holidays").notNull().default(1),
  allowRecordsOnWeekends: integer("allow_records_on_weekends").notNull().default(1),
  allowFutureRecords: integer("allow_future_records").notNull().default(0),
  country: text("country").notNull().default("AT"),
  tabletIdleTimeoutSeconds: integer("tablet_idle_timeout_seconds").notNull().default(10),
  autoBreakAfterMinutes: integer("auto_break_after_minutes").notNull().default(300),
  autoBreakDurationMinutes: integer("auto_break_duration_minutes").notNull().default(30),
  projectsEnabled: integer("projects_enabled").notNull().default(0),
  tasksEnabled: integer("tasks_enabled").notNull().default(0),
  overtimeSettingsJson: text("overtime_settings_json").notNull().default("{}"),
  customFieldsJson: text("custom_fields_json").notNull().default("[]"),
});

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    isActive: integer("is_active").notNull().default(1),
    deletedAt: text("deleted_at"),
    pinCode: text("pin_code").notNull().default("0000"),
    email: text("email"),
    customFieldValuesJson: text("custom_field_values_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_users_name").on(table.fullName),
    uniqueIndex("idx_users_username").on(table.username).where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("idx_users_pin_code").on(table.pinCode).where(sql`${table.deletedAt} IS NULL`),
    check("users_role_check", sql`${table.role} IN ('employee', 'manager', 'admin')`),
  ],
);

export const userContracts = sqliteTable(
  "user_contracts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    hoursPerWeek: real("hours_per_week").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    paymentPerHour: real("payment_per_hour").notNull(),
    annualVacationDays: real("annual_vacation_days").notNull().default(25),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_user_contracts_user").on(table.userId, table.startDate)],
);

export const userContractScheduleBlocks = sqliteTable(
  "user_contract_schedule_blocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contractId: integer("contract_id").notNull().references(() => userContracts.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    blockOrder: integer("block_order").notNull().default(1),
    startTime: text("start_time"),
    endTime: text("end_time"),
    minutes: integer("minutes").notNull().default(0),
  },
  (table) => [
    index("idx_user_contract_schedule_blocks_contract").on(table.contractId, table.weekday, table.blockOrder),
    uniqueIndex("user_contract_schedule_blocks_contract_weekday_order_unique").on(
      table.contractId,
      table.weekday,
      table.blockOrder,
    ),
    check("user_contract_schedule_blocks_weekday_check", sql`${table.weekday} BETWEEN 1 AND 7`),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    budget: real("budget").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    allowAllUsers: integer("allow_all_users").notNull().default(1),
    allowAllTasks: integer("allow_all_tasks").notNull().default(1),
    customFieldValuesJson: text("custom_field_values_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_projects_active").on(table.isActive, table.createdAt)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    isActive: integer("is_active").notNull().default(1),
    customFieldValuesJson: text("custom_field_values_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_tasks_active").on(table.isActive, table.createdAt)],
);

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    entryType: text("entry_type").notNull().default("work"),
    entryDate: text("entry_date").notNull(),
    endDate: text("end_date"),
    startTime: text("start_time").notNull(),
    endTime: text("end_time"),
    notes: text("notes"),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    customFieldValuesJson: text("custom_field_values_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_time_entries_user_day").on(table.userId, table.entryDate, table.endDate),
    index("idx_time_entries_user_type_day").on(table.userId, table.entryType, table.entryDate, table.endDate),
    check(
      "time_entries_entry_type_check",
      sql`${table.entryType} IN ('work', 'vacation', 'sick_leave', 'time_off_in_lieu')`,
    ),
  ],
);

export const publicHolidayCache = sqliteTable(
  "public_holiday_cache",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    countryCode: text("country_code").notNull(),
    year: integer("year").notNull(),
    payloadJson: text("payload_json").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (table) => [uniqueIndex("idx_public_holiday_cache_country_year").on(table.countryCode, table.year)],
);

export const projectUsers = sqliteTable(
  "project_users",
  {
    projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("idx_project_users_user").on(table.userId, table.projectId),
  ],
);

export const projectTasks = sqliteTable(
  "project_tasks",
  {
    projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.taskId] }),
    index("idx_project_tasks_task").on(table.taskId, table.projectId),
  ],
);

export const calculations = sqliteTable(
  "calculations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    sqlText: text("sql_text").notNull(),
    outputMode: text("output_mode").notNull().default("both"),
    chartType: text("chart_type").notNull().default("bar"),
    chartCategoryColumn: text("chart_category_column"),
    chartValueColumn: text("chart_value_column"),
    chartSeriesColumn: text("chart_series_column"),
    chartConfigJson: text("chart_config_json").notNull().default("{}"),
    chartStacked: integer("chart_stacked").notNull().default(0),
    isBuiltin: integer("is_builtin").notNull().default(0),
    builtinKey: text("builtin_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("calculations_output_mode_check", sql`${table.outputMode} IN ('table', 'chart', 'both')`),
    check("calculations_chart_type_check", sql`${table.chartType} IN ('bar', 'line', 'area', 'pie')`),
  ],
);

export const holidays = sqliteView("holidays", {
  countryCode: text("country_code"),
  year: integer("year"),
  date: text("date"),
  localName: text("local_name"),
  name: text("name"),
  countryCodeFromPayload: text("country_code_from_payload"),
}).as(sql`
  SELECT
    public_holiday_cache.country_code,
    public_holiday_cache.year,
    CAST(json_extract(json_each.value, '$.date') AS TEXT) AS date,
    CAST(json_extract(json_each.value, '$.localName') AS TEXT) AS local_name,
    CAST(json_extract(json_each.value, '$.name') AS TEXT) AS name,
    CAST(json_extract(json_each.value, '$.countryCode') AS TEXT) AS country_code_from_payload
  FROM public_holiday_cache
  JOIN company_settings
    ON UPPER(COALESCE(company_settings.country, '')) = public_holiday_cache.country_code
  JOIN json_each(public_holiday_cache.payload_json)
  WHERE json_extract(json_each.value, '$.date') IS NOT NULL
`);

export const customFieldValues = sqliteView("custom_field_values", {
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  entryType: text("entry_type"),
  fieldId: text("field_id"),
  valueRaw: text("value_raw"),
  valueType: text("value_type"),
  valueNumber: real("value_number"),
  valueBoolean: integer("value_boolean"),
}).as(sql`
  SELECT
    'user' AS entity_type,
    id AS entity_id,
    NULL AS entry_type,
    json_each.key AS field_id,
    json_each.value AS value_raw,
    json_each.type AS value_type,
    CASE
      WHEN json_each.type IN ('integer', 'real') THEN CAST(json_each.value AS REAL)
      ELSE NULL
    END AS value_number,
    CASE
      WHEN json_each.type = 'true' THEN 1
      WHEN json_each.type = 'false' THEN 0
      ELSE NULL
    END AS value_boolean
  FROM users, json_each(users.custom_field_values_json)
  UNION ALL
  SELECT
    'project' AS entity_type,
    id AS entity_id,
    NULL AS entry_type,
    json_each.key AS field_id,
    json_each.value AS value_raw,
    json_each.type AS value_type,
    CASE
      WHEN json_each.type IN ('integer', 'real') THEN CAST(json_each.value AS REAL)
      ELSE NULL
    END AS value_number,
    CASE
      WHEN json_each.type = 'true' THEN 1
      WHEN json_each.type = 'false' THEN 0
      ELSE NULL
    END AS value_boolean
  FROM projects, json_each(projects.custom_field_values_json)
  UNION ALL
  SELECT
    'task' AS entity_type,
    id AS entity_id,
    NULL AS entry_type,
    json_each.key AS field_id,
    json_each.value AS value_raw,
    json_each.type AS value_type,
    CASE
      WHEN json_each.type IN ('integer', 'real') THEN CAST(json_each.value AS REAL)
      ELSE NULL
    END AS value_number,
    CASE
      WHEN json_each.type = 'true' THEN 1
      WHEN json_each.type = 'false' THEN 0
      ELSE NULL
    END AS value_boolean
  FROM tasks, json_each(tasks.custom_field_values_json)
  UNION ALL
  SELECT
    'time_entry' AS entity_type,
    id AS entity_id,
    entry_type,
    json_each.key AS field_id,
    json_each.value AS value_raw,
    json_each.type AS value_type,
    CASE
      WHEN json_each.type IN ('integer', 'real') THEN CAST(json_each.value AS REAL)
      ELSE NULL
    END AS value_number,
    CASE
      WHEN json_each.type = 'true' THEN 1
      WHEN json_each.type = 'false' THEN 0
      ELSE NULL
    END AS value_boolean
  FROM time_entries, json_each(time_entries.custom_field_values_json)
`);

export const companyTables = {
  calculations,
  companySettings,
  projectTasks,
  projectUsers,
  projects,
  publicHolidayCache,
  tasks,
  timeEntries,
  userContractScheduleBlocks,
  userContracts,
  users,
};

export const companyViews = {
  customFieldValues,
  holidays,
};

export type CompanyTables = typeof companyTables;
