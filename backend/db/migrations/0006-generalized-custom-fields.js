import crypto from "node:crypto";

function hasColumn(db, tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => row.name === columnName);
}

const TIME_ENTRY_TYPES = new Set(["work", "vacation", "sick_leave", "time_off_in_lieu"]);
const TARGET_SCOPES = new Set(["time_entry", "user", "project", "task"]);

function normalizeTargets(targets) {
  if (!Array.isArray(targets)) {
    return [];
  }

  const scopeMap = new Map();
  for (const target of targets) {
    if (typeof target === "string") {
      if (TIME_ENTRY_TYPES.has(target)) {
        const current = scopeMap.get("time_entry") ?? { scope: "time_entry", entryTypes: [] };
        current.entryTypes = Array.from(new Set([...(current.entryTypes ?? []), target]));
        scopeMap.set("time_entry", current);
      } else if (TARGET_SCOPES.has(target)) {
        scopeMap.set(target, { scope: target });
      }
      continue;
    }

    if (!target || typeof target !== "object") {
      continue;
    }

    const scope = typeof target.scope === "string" && TARGET_SCOPES.has(target.scope) ? target.scope : null;
    if (!scope) {
      continue;
    }

    if (scope === "time_entry") {
      const entryTypes = Array.isArray(target.entryTypes)
        ? target.entryTypes.filter((value) => typeof value === "string" && TIME_ENTRY_TYPES.has(value))
        : [];
      const current = scopeMap.get("time_entry") ?? { scope: "time_entry", entryTypes: [] };
      current.entryTypes = Array.from(new Set([...(current.entryTypes ?? []), ...entryTypes]));
      scopeMap.set("time_entry", current);
      continue;
    }

    scopeMap.set(scope, { scope });
  }

  const normalized = Array.from(scopeMap.values()).flatMap((target) => {
    if (target.scope !== "time_entry") {
      return [target];
    }

    const entryTypes = Array.from(new Set((target.entryTypes ?? []).filter((value) => TIME_ENTRY_TYPES.has(value))));
    return [{
      scope: "time_entry",
      entryTypes: entryTypes.length > 0 ? entryTypes : ["work"],
    }];
  });

  return normalized;
}

function normalizeCustomFields(customFields) {
  if (!Array.isArray(customFields)) {
    return [];
  }

  return customFields.map((field) => {
    const id = typeof field?.id === "string" && field.id.trim().length > 0 ? field.id.trim() : crypto.randomUUID();
    const label = typeof field?.label === "string" ? field.label.trim() : "";
    const type = field?.type === "number" || field?.type === "date" || field?.type === "boolean" || field?.type === "select" ? field.type : "text";
    const required = Boolean(field?.required);
    const placeholder = typeof field?.placeholder === "string" ? field.placeholder.trim() || null : null;
    const options = type === "select" && Array.isArray(field?.options)
      ? field.options.map((option) => ({
          id: typeof option?.id === "string" && option.id.trim().length > 0 ? option.id.trim() : crypto.randomUUID(),
          label: typeof option?.label === "string" ? option.label.trim() : "",
          value: typeof option?.value === "string" && option.value.trim().length > 0 ? option.value.trim() : (typeof option?.id === "string" && option.id.trim().length > 0 ? option.id.trim() : crypto.randomUUID()),
        }))
      : [];

    return {
      id,
      label,
      type,
      targets: normalizeTargets(field?.targets),
      required,
      placeholder,
      options,
    };
  });
}

export async function up({ context: db }) {
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const [tableName] of [["users"], ["projects"], ["tasks"]]) {
      if (!hasColumn(db, tableName, "custom_field_values_json")) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN custom_field_values_json TEXT NOT NULL DEFAULT '{}'`);
      }
    }

    const settingsRows = db.prepare("SELECT company_id, custom_fields_json FROM company_settings").all();
    for (const row of settingsRows) {
      let parsed = [];
      try {
        parsed = JSON.parse(row.custom_fields_json || "[]");
      } catch {
        parsed = [];
      }
      const normalized = normalizeCustomFields(parsed);
      db.prepare("UPDATE company_settings SET custom_fields_json = ? WHERE company_id = ?").run(JSON.stringify(normalized), row.company_id);
    }

    db.exec("DROP VIEW IF EXISTS custom_field_values");
    db.exec(`
      CREATE VIEW custom_field_values AS
      SELECT
        company_id,
        'user' AS entity_type,
        id AS entity_id,
        NULL AS entry_type,
        json_each.key AS field_id,
        CAST(json_each.value AS TEXT) AS value_text,
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
        company_id,
        'project' AS entity_type,
        id AS entity_id,
        NULL AS entry_type,
        json_each.key AS field_id,
        CAST(json_each.value AS TEXT) AS value_text,
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
        company_id,
        'task' AS entity_type,
        id AS entity_id,
        NULL AS entry_type,
        json_each.key AS field_id,
        CAST(json_each.value AS TEXT) AS value_text,
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
        company_id,
        'time_entry' AS entity_type,
        id AS entity_id,
        entry_type,
        json_each.key AS field_id,
        CAST(json_each.value AS TEXT) AS value_text,
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

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
