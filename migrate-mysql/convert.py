from __future__ import annotations

import hashlib
import json
import lzma
import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT_DIR = Path(__file__).resolve().parent
REPO_ROOT = ROOT_DIR.parent
OUTPUT_DIR = ROOT_DIR / "output"
PACKAGE_KEY = "jtzt-company-sqlite-migration"
PACKAGE_VERSION = 1
PACKAGE_METADATA_TABLE = "jtzt_migration_metadata"
VIENNA_TZ = ZoneInfo("Europe/Vienna")

DEFAULT_OVERTIME_SETTINGS = {
    "version": 1,
    "presetId": "at_default",
    "countryCode": "AT",
    "title": "Austria - Statutory Baseline",
    "dailyOvertimeThresholdHours": 8,
    "weeklyOvertimeThresholdHours": 40,
    "averagingEnabled": True,
    "averagingWeeks": 17,
    "rules": [
        {
            "id": "standard-overtime",
            "category": "standard_overtime",
            "triggerKind": "daily_overtime",
            "afterHours": 8,
            "windowStart": None,
            "windowEnd": None,
            "multiplierPercent": 50,
            "compensationType": "cash_or_time_off",
        },
        {
            "id": "sunday-holiday",
            "category": "sunday_holiday",
            "triggerKind": "sunday_or_holiday",
            "afterHours": None,
            "windowStart": None,
            "windowEnd": None,
            "multiplierPercent": 0,
            "compensationType": "cash",
        },
        {
            "id": "night-shift",
            "category": "night_shift",
            "triggerKind": "night_shift",
            "afterHours": None,
            "windowStart": "22:00",
            "windowEnd": "06:00",
            "multiplierPercent": 0,
            "compensationType": "cash",
        },
    ],
    "payoutDecisionMode": "conditional",
    "employeeChoiceAfterDailyHours": 10,
    "employeeChoiceAfterWeeklyHours": 50,
    "conflictResolution": "highest_only",
}


@dataclass(frozen=True)
class ColumnInfo:
    name: str
    type: str
    nullable: bool
    primary_key: bool


@dataclass(frozen=True)
class ForeignKeyInfo:
    column: str
    referenced_table: str
    referenced_column: str


@dataclass(frozen=True)
class TableInfo:
    name: str
    columns: list[ColumnInfo]
    foreign_keys: list[ForeignKeyInfo]
    primary_key_columns: list[str]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sqlite_quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


@lru_cache(maxsize=1)
def load_company_schema_rows() -> list[dict[str, str]]:
    schema_ts_path = (REPO_ROOT / "backend" / "db" / "schema.ts").resolve()
    schema_text = schema_ts_path.read_text(encoding="utf-8")
    schema_match = re.search(r"export const companySchema = `([\s\S]*?)`;\s*$", schema_text, re.M)
    if not schema_match:
        schema_match = re.search(r"export const companySchema = `([\s\S]*?)`;", schema_text, re.M)
    if not schema_match:
        raise RuntimeError(f"Could not extract companySchema from {schema_ts_path.as_posix()}")

    company_schema = schema_match.group(1)
    rows: list[dict[str, str]] = []
    pattern = re.compile(r"CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.I)

    for match in pattern.finditer(company_schema):
        table_name = match.group(1)
        statement_start = match.start()
        statement_end = company_schema.find(";\n", statement_start)
        if statement_end == -1:
            statement_end = company_schema.find(";", statement_start)
        if statement_end == -1:
            statement_end = len(company_schema)
        rows.append({
            "name": table_name,
            "sql": company_schema[statement_start:statement_end].strip(),
        })

    if not rows:
        raise RuntimeError("No company schema tables could be parsed from backend/db/schema.ts")

    return rows


def split_top_level_commas(value: str) -> list[str]:
    segments: list[str] = []
    current: list[str] = []
    depth = 0
    for char in value:
        if char == "(":
            depth += 1
            current.append(char)
            continue
        if char == ")":
            depth = max(0, depth - 1)
            current.append(char)
            continue
        if char == "," and depth == 0:
            segment = "".join(current).strip()
            if segment:
                segments.append(segment)
            current = []
            continue
        current.append(char)
    tail = "".join(current).strip()
    if tail:
        segments.append(tail)
    return segments


def parse_columns_from_create_table_sql(create_table_sql: str) -> tuple[list[ColumnInfo], list[ForeignKeyInfo]]:
    start = create_table_sql.find("(")
    end = create_table_sql.rfind(")")
    if start == -1 or end == -1 or end <= start:
        return [], []

    body = create_table_sql[start + 1 : end]
    segments = [segment.strip() for segment in split_top_level_commas(body) if segment.strip()]
    columns: list[ColumnInfo] = []
    foreign_keys: list[ForeignKeyInfo] = []

    for segment in segments:
        if re.match(r"^foreign key\b", segment, re.I):
            match = re.match(
                r'^foreign key\s*\(\s*"?(?P<column>[A-Za-z_][A-Za-z0-9_]*)"?\s*\)\s*references\s*"?(?P<table>[A-Za-z_][A-Za-z0-9_]*)"?\s*\(\s*"?(?P<refColumn>[A-Za-z_][A-Za-z0-9_]*)"?\s*\)',
                segment,
                re.I,
            )
            if match:
                foreign_keys.append(
                    ForeignKeyInfo(
                        column=match.group("column"),
                        referenced_table=match.group("table"),
                        referenced_column=match.group("refColumn"),
                    )
                )
            continue

        if re.match(r"^(constraint|primary key|unique|check)\b", segment, re.I):
            continue

        match = re.match(r'^"?(?P<name>[A-Za-z_][A-Za-z0-9_]*)"?\s+(?P<rest>.+)$', segment, re.S)
        if not match:
            continue

        rest = match.group("rest").strip()
        type_match = re.match(r"^(?P<type>[A-Za-z0-9_()]+(?:\s+[A-Za-z0-9_()]+)?)", rest)
        normalized_rest = rest.upper()
        columns.append(
            ColumnInfo(
                name=match.group("name"),
                type=type_match.group("type").strip() if type_match else "TEXT",
                nullable="NOT NULL" not in normalized_rest,
                primary_key="PRIMARY KEY" in normalized_rest,
            )
        )

    return columns, foreign_keys


def parse_tables_from_schema_rows(schema_rows: list[dict[str, str]]) -> list[TableInfo]:
    tables: list[TableInfo] = []
    for row in schema_rows:
        table_name = row["name"]
        create_table_sql = row["sql"]
        columns, foreign_keys = parse_columns_from_create_table_sql(create_table_sql)
        tables.append(
            TableInfo(
                name=table_name,
                columns=columns,
                foreign_keys=foreign_keys,
                primary_key_columns=[column.name for column in columns if column.primary_key],
            )
        )

    return tables


def infer_example_value(column: ColumnInfo):
    name = column.name.lower()
    type_name = column.type.lower()

    if name.endswith("_id") or column.primary_key:
        return 1
    if "date" in name and "updated" not in name:
        return "2026-01-01"
    if "time" in name:
        return "09:00"
    if "email" in name:
        return "name@example.com"
    if name.startswith("is_") or name.startswith("has_") or name.endswith("_enabled"):
        return 1
    if "int" in type_name or "real" in type_name or "numeric" in type_name:
        return 1
    if "json" in name:
        return "{}"
    if column.nullable:
        return None
    return f"{column.name}_value"


def build_included_table_order(tables: list[TableInfo]) -> list[TableInfo]:
    selected_tables = list(tables)
    selected = {table.name for table in selected_tables}
    in_degree = {table.name: 0 for table in selected_tables}
    children_by_parent: dict[str, set[str]] = {}

    for table in selected_tables:
        for fk in table.foreign_keys:
            if fk.referenced_table not in selected:
                continue
            children_by_parent.setdefault(fk.referenced_table, set()).add(table.name)
            in_degree[table.name] += 1

    queue = sorted(table.name for table in selected_tables if in_degree[table.name] == 0)
    order: list[str] = []

    while queue:
        table_name = queue.pop(0)
        order.append(table_name)
        for child in sorted(children_by_parent.get(table_name, set())):
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)
                queue.sort()

    if len(order) != len(selected_tables):
        raise RuntimeError("Could not resolve migration table import order")

    by_name = {table.name: table for table in selected_tables}
    return [by_name[table_name] for table_name in order]


def build_package_metadata_columns():
    return [
        {"name": "package_key", "type": "TEXT", "nullable": False, "primaryKey": False, "example": PACKAGE_KEY},
        {"name": "package_version", "type": "INTEGER", "nullable": False, "primaryKey": False, "example": PACKAGE_VERSION},
        {"name": "exported_at", "type": "TEXT", "nullable": False, "primaryKey": False, "example": "2026-01-01T00:00:00.000Z"},
        {"name": "source_schema_hash", "type": "TEXT", "nullable": False, "primaryKey": False, "example": "sha256:..."},
        {"name": "schema_json", "type": "TEXT", "nullable": False, "primaryKey": False, "example": "{\"format\":{...}}"},
        {"name": "original_company_id", "type": "TEXT", "nullable": False, "primaryKey": False, "example": "company_uuid"},
        {"name": "name", "type": "TEXT", "nullable": False, "primaryKey": False, "example": "Example Company"},
        {"name": "api_key_hash", "type": "TEXT", "nullable": True, "primaryKey": False, "example": None},
        {"name": "api_key_created_at", "type": "TEXT", "nullable": True, "primaryKey": False, "example": None},
        {"name": "tablet_code_value", "type": "TEXT", "nullable": True, "primaryKey": False, "example": None},
        {"name": "tablet_code_hash", "type": "TEXT", "nullable": True, "primaryKey": False, "example": None},
        {"name": "tablet_code_updated_at", "type": "TEXT", "nullable": True, "primaryKey": False, "example": None},
        {"name": "created_at", "type": "TEXT", "nullable": False, "primaryKey": False, "example": "2026-01-01T00:00:00.000Z"},
    ]


def build_schema_document(tables: list[TableInfo]) -> dict:
    ordered_tables = build_included_table_order(tables)
    return {
        "format": {
            "key": PACKAGE_KEY,
            "version": PACKAGE_VERSION,
            "encoding": "UTF-8",
            "singleFile": True,
            "fileExtension": ".sqlite",
            "packageTableName": PACKAGE_METADATA_TABLE,
            "schemaSource": "backend/db/schema.ts",
            "systemSchemaSource": "backend/db/schema.ts",
        },
        "packageMetadata": {
            "tableName": PACKAGE_METADATA_TABLE,
            "description": "Single-row metadata that anchors the SQLite migration file and documents the generated schema.",
            "columns": build_package_metadata_columns(),
        },
        "tables": [
            {
                "tableName": table.name,
                "importOrder": index + 1,
                "rowScope": "Rows are stored directly in the package tables and linked through foreign keys.",
                "columns": [
                    {
                        "name": column.name,
                        "type": column.type,
                        "nullable": column.nullable,
                        "primaryKey": column.primary_key,
                        "example": infer_example_value(column),
                        "foreignKey": next(
                            (
                                {
                                    "column": fk.column,
                                    "referencedTable": fk.referenced_table,
                                    "referencedColumn": fk.referenced_column,
                                }
                                for fk in table.foreign_keys
                                if fk.column == column.name
                            ),
                            None,
                        ),
                    }
                    for column in table.columns
                ],
            }
            for index, table in enumerate(ordered_tables)
        ],
        "notes": [
            "The exported package is a single SQLite file.",
            "The schema document is generated from the live company schema and stored in the file metadata.",
            "Import fully replaces the target company database before rows are inserted.",
            "The package is self-describing: it carries both schema JSON and a schema hash.",
        ],
    }


def canonicalize_schema_document(schema_document):
    if not isinstance(schema_document, dict) or "tables" not in schema_document:
        return schema_document

    format_section = schema_document.get("format") or {}
    package_metadata = schema_document.get("packageMetadata") or {}
    canonical = {
        "format": dict(sorted(format_section.items())),
        "packageMetadata": dict(sorted(package_metadata.items())),
        "tables": [],
        "notes": list(schema_document.get("notes") or []),
    }

    tables = list(schema_document.get("tables") or [])
    for table in sorted(tables, key=lambda item: str(item.get("tableName", ""))):
        columns = list(table.get("columns") or [])
        canonical["tables"].append(
            {
                "tableName": table.get("tableName"),
                "rowScope": table.get("rowScope"),
                "columns": [
                    {
                        "name": column.get("name"),
                        "type": column.get("type"),
                        "nullable": column.get("nullable"),
                        "primaryKey": column.get("primaryKey"),
                        "example": column.get("example"),
                        "foreignKey": column.get("foreignKey"),
                    }
                    for column in sorted(columns, key=lambda item: str(item.get("name", "")))
                ],
            }
        )

    return canonical


def build_schema_hash(schema_document: dict) -> str:
    schema_json = json.dumps(canonicalize_schema_document(schema_document), separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(schema_json.encode("utf-8")).hexdigest()


def clean_legacy_statement(statement: str) -> str:
    statement = statement.strip()
    if not statement:
        return statement

    upper = statement.upper()
    if upper.startswith("CREATE TABLE"):
        statement = re.sub(r"\bAUTO_INCREMENT\b", "", statement, flags=re.I)
        statement = re.sub(r"\bUNSIGNED\b", "", statement, flags=re.I)
        statement = re.sub(r"\bCOLLATE\s*=?\s*[\w_]+", "", statement, flags=re.I)
        statement = re.sub(r"\bCHARACTER SET\s+[\w_]+", "", statement, flags=re.I)
        statement = re.sub(r"\bDEFAULT CHARSET\s*=?\s*[\w_]+", "", statement, flags=re.I)
        statement = re.sub(r"\bint\(\d+\)", "INTEGER", statement, flags=re.I)
        statement = re.sub(r"\btinyint\(\d+\)", "INTEGER", statement, flags=re.I)
        statement = re.sub(r"\bbigint\(\d+\)", "INTEGER", statement, flags=re.I)

        lines = []
        for line in statement.splitlines():
            line_upper = line.strip().upper()
            if (
                line_upper.startswith("KEY `")
                or line_upper.startswith("UNIQUE KEY `")
                or line_upper.startswith("CONSTRAINT `")
                or line_upper.startswith("FULLTEXT KEY `")
            ):
                continue
            lines.append(line)
        statement = "\n".join(lines)
        statement = re.sub(r",\s*\)", "\n)", statement)
        statement = re.sub(r"\)\s*ENGINE\s*=\s*\w+.*?;", ");", statement, flags=re.I | re.S)
        return statement

    if upper.startswith("INSERT INTO"):
        statement = statement.replace("\\'", "''")
        statement = statement.replace('\\"', '"')
        statement = statement.replace("\\\\", "\\")
        return statement

    return statement


def load_dump_into_sqlite(source_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("PRAGMA journal_mode = MEMORY")
    conn.execute("PRAGMA synchronous = OFF")
    cursor = conn.cursor()

    allowed_tables = {
        "tt_groups",
        "tt_users",
        "tt_projects",
        "tt_tasks",
        "tt_log",
        "tt_project_task_binds",
        "tt_user_project_binds",
        "tt_custom_fields",
        "tt_custom_field_options",
        "tt_custom_field_log",
        "tt_entity_custom_fields",
    }

    current_statement: list[str] = []
    with lzma.open(source_path, "rt", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            if (
                line.startswith("/*")
                or line.startswith("--")
                or line.startswith("LOCK TABLES")
                or line.startswith("UNLOCK TABLES")
                or line.startswith("SET ")
            ):
                continue

            current_statement.append(line)
            if not line.strip().endswith(";"):
                continue

            statement_raw = "".join(current_statement)
            current_statement = []
            if not any(f"`{table}`" in statement_raw for table in allowed_tables):
                continue

            statement = clean_legacy_statement(statement_raw)
            if not statement.strip():
                continue

            try:
                cursor.execute(statement)
            except sqlite3.Error:
                continue

    conn.commit()
    return conn


def now_iso_from_dt(dt: datetime | None = None) -> str:
    moment = dt or datetime.now(timezone.utc)
    return moment.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def format_locale_from_group(group_row: sqlite3.Row) -> str:
    lang = str(group_row["lang"] or "").strip()
    country = str(group_row["country_code"] or "").strip().upper()
    if not lang:
        return "de-AT"
    if "-" in lang:
        return lang
    if country:
        return f"{lang.lower()}-{country}"
    return lang.lower()


def convert_php_datetime_format(date_format: str | None, time_format: str | None) -> str:
    date_format = date_format or "%d.%m.%Y"
    time_format = time_format or "%H:%M"

    def replace_tokens(value: str) -> str:
        replacements = [
            ("%Y", "yyyy"),
            ("%y", "yy"),
            ("%m", "MM"),
            ("%d", "dd"),
            ("%H", "HH"),
            ("%k", "H"),
            ("%I", "hh"),
            ("%l", "h"),
            ("%i", "mm"),
            ("%M", "mm"),
            ("%s", "ss"),
            ("%p", "tt"),
            ("%b", "MMM"),
        ]
        result = value
        for needle, replacement in replacements:
            result = result.replace(needle, replacement)
        return result

    combined = f"{replace_tokens(date_format)} {replace_tokens(time_format)}".strip()
    return combined or "dd.MM.yyyy HH:mm"


def derive_overtime_settings(country_code: str | None) -> dict:
    settings = json.loads(json.dumps(DEFAULT_OVERTIME_SETTINGS))
    if country_code:
        settings["countryCode"] = country_code
    return settings


def make_custom_field_definitions(field_rows: list[sqlite3.Row], option_rows: list[sqlite3.Row]) -> list[dict]:
    option_map: dict[int, list[dict]] = {}
    for row in option_rows:
        if not is_active_legacy_row(row["status"]):
            continue
        field_id = int(row["field_id"])
        option_map.setdefault(field_id, []).append(
            {
                "id": str(row["id"]),
                "label": str(row["value"] or ""),
                "value": str(row["value"] or ""),
            }
        )

    definitions: list[dict] = []
    for row in sorted(field_rows, key=lambda item: int(item["id"])):
        if not is_active_legacy_row(row["status"]):
            continue
        field_id = int(row["id"])
        options = option_map.get(field_id, [])
        entity_type = int(row["entity_type"] or 0)
        if entity_type == 1:
            targets = [{"scope": "time_entry"}]
        elif entity_type == 2:
            targets = [{"scope": "user"}]
        elif entity_type == 3:
            targets = [{"scope": "project"}]
        elif entity_type == 4:
            targets = [{"scope": "task"}]
        else:
            targets = [{"scope": "user"}]

        definitions.append(
            {
                "id": str(field_id),
                "label": str(row["label"] or ""),
                "type": "select" if options else "text",
                "targets": targets,
                "required": bool(row["required"]),
                "placeholder": None,
                "options": options,
            }
        )

    return definitions


def build_time_entry_custom_values(source: sqlite3.Connection) -> dict[int, dict[str, str | int | float | bool]]:
    option_rows = source.execute("SELECT id, field_id, value, status FROM tt_custom_field_options").fetchall()
    option_lookup = {int(row["id"]): str(row["value"] or "") for row in option_rows if is_active_legacy_row(row["status"])}
    rows = source.execute("SELECT log_id, field_id, option_id, value, status FROM tt_custom_field_log ORDER BY log_id ASC, field_id ASC, id ASC").fetchall()
    values_by_log_id: dict[int, dict[str, str | int | float | bool]] = {}

    for row in rows:
        if not is_active_legacy_row(row["status"]):
            continue
        log_id = int(row["log_id"])
        field_id = str(row["field_id"])
        value = row["value"]
        if row["option_id"] is not None:
            value = option_lookup.get(int(row["option_id"]), value)
        if value is None:
            continue
        values_by_log_id.setdefault(log_id, {})[field_id] = value

    return values_by_log_id


def build_user_custom_values(entity_rows: list[sqlite3.Row]) -> dict[int, dict[str, str | int | float | bool]]:
    values_by_user_id: dict[int, dict[str, str | int | float | bool]] = {}
    for row in entity_rows:
        if not is_active_legacy_row(row["status"]):
            continue
        user_id = int(row["entity_id"])
        field_id = str(row["field_id"])
        value = row["value"]
        if value is None and row["option_id"] is not None:
            value = str(row["option_id"])
        if value is None:
            continue
        values_by_user_id.setdefault(user_id, {})[field_id] = value
    return values_by_user_id


def should_skip_legacy_user(row: sqlite3.Row) -> bool:
    login = str(row["login"] or "").strip().lower()
    name = str(row["name"] or "").strip().lower()
    return "tablet" in login or "demo" in login or "tablet" in name or "demo" in name


def choose_group_row(source: sqlite3.Connection) -> sqlite3.Row:
    group_row = source.execute("SELECT * FROM tt_groups WHERE status = 1 ORDER BY id ASC LIMIT 1").fetchone()
    if group_row is None:
        group_row = source.execute("SELECT * FROM tt_groups ORDER BY id ASC LIMIT 1").fetchone()
    if group_row is None:
        raise RuntimeError("No legacy group row found in dump")
    return group_row


def collect_legacy_rows(source: sqlite3.Connection, group_id: int) -> dict[str, list[sqlite3.Row]]:
    queries = {
        "users": "SELECT * FROM tt_users WHERE group_id = ? ORDER BY id ASC",
        "projects": "SELECT * FROM tt_projects WHERE group_id = ? ORDER BY id ASC",
        "tasks": "SELECT * FROM tt_tasks WHERE group_id = ? ORDER BY id ASC",
        "logs": "SELECT * FROM tt_log WHERE group_id = ? ORDER BY id ASC",
        "project_task_binds": "SELECT * FROM tt_project_task_binds WHERE group_id = ? OR group_id IS NULL ORDER BY project_id ASC, task_id ASC",
        "user_project_binds": "SELECT * FROM tt_user_project_binds WHERE group_id = ? OR group_id IS NULL ORDER BY user_id ASC, project_id ASC",
        "custom_fields": "SELECT * FROM tt_custom_fields WHERE group_id = ? ORDER BY id ASC",
        "custom_field_options": "SELECT * FROM tt_custom_field_options WHERE group_id = ? OR group_id IS NULL ORDER BY id ASC",
        "entity_custom_fields": "SELECT * FROM tt_entity_custom_fields WHERE group_id = ? OR group_id IS NULL ORDER BY entity_id ASC, field_id ASC, id ASC",
    }
    return {key: source.execute(query, (group_id,)).fetchall() for key, query in queries.items()}


def build_unique_username(base: str, used: set[str]) -> str:
    candidate = base.strip() or "user"
    unique = candidate
    suffix = 1
    while unique.lower() in used:
        unique = f"{candidate}_{suffix}"
        suffix += 1
    used.add(unique.lower())
    return unique


def build_unique_pin(base: str | None, used: set[str], counter: list[int]) -> str:
    candidate = str(base).strip() if base else ""
    if not candidate or candidate.lower() in used:
        while True:
            candidate = str(counter[0]).zfill(4)
            counter[0] += 1
            if candidate.lower() not in used:
                break
    used.add(candidate.lower())
    return candidate


def build_contract_schedule(hours_per_week: float, workdays_week: int) -> list[dict]:
    if workdays_week < 1:
        workdays_week = 5
    workdays_week = min(workdays_week, 7)
    if hours_per_week <= 0:
        return []

    daily_minutes = round((hours_per_week * 60.0) / workdays_week)
    if daily_minutes <= 0:
        return []

    start_minutes = 9 * 60
    end_minutes = start_minutes + daily_minutes
    if end_minutes >= 24 * 60:
        end_minutes = 23 * 60 + 59

    start_time = f"{start_minutes // 60:02d}:{start_minutes % 60:02d}"
    end_time = f"{end_minutes // 60:02d}:{end_minutes % 60:02d}"
    blocks = []
    for weekday in range(1, 8):
        if weekday <= workdays_week:
            blocks.append({"weekday": weekday, "start_time": start_time, "end_time": end_time, "minutes": daily_minutes})
        else:
            blocks.append({"weekday": weekday, "start_time": None, "end_time": None, "minutes": 0})
    return blocks


def get_iso_times(date_str: str | None, start_str: str | None, duration_str: str | None) -> tuple[str | None, str | None]:
    if not date_str:
        return None, None

    safe_start = start_str if start_str else "09:00:00"
    safe_duration = duration_str if duration_str else "00:00:00"
    try:
        local_dt = datetime.strptime(f"{date_str} {safe_start}", "%Y-%m-%d %H:%M:%S").replace(tzinfo=VIENNA_TZ)
        hours, minutes, seconds = (int(part) for part in safe_duration.split(":"))
        local_end_dt = local_dt + timedelta(hours=hours, minutes=minutes, seconds=seconds)
        iso_format = "%Y-%m-%dT%H:%M:%S.000Z"
        return local_dt.astimezone(timezone.utc).strftime(iso_format), local_end_dt.astimezone(timezone.utc).strftime(iso_format)
    except Exception:
        return None, None


def build_entry_type(custom_values: dict[str, str | int | float | bool]) -> str:
    value = str(custom_values.get("1", "")).lower()
    if "urlaub" in value:
        return "vacation"
    if "krankenstand" in value:
        return "sick_leave"
    if "zeitausgleich" in value:
        return "time_off_in_lieu"
    return "work"


def normalize_status(value) -> int:
    try:
        return 1 if int(value) == 1 else 0
    except Exception:
        return 1


def is_active_legacy_row(value) -> bool:
    try:
        return int(value) == 1
    except Exception:
        return False


def create_package_database(output_path: Path, schema_rows: list[dict[str, str]]) -> sqlite3.Connection:
    if output_path.exists():
        output_path.unlink()

    conn = sqlite3.connect(output_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    for row in schema_rows:
        conn.executescript(row["sql"])
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {sqlite_quote(PACKAGE_METADATA_TABLE)} (
          package_key TEXT NOT NULL,
          package_version INTEGER NOT NULL,
          exported_at TEXT NOT NULL,
          source_schema_hash TEXT NOT NULL,
          schema_json TEXT NOT NULL,
          original_company_id TEXT NOT NULL,
          name TEXT NOT NULL,
          api_key_hash TEXT,
          api_key_created_at TEXT,
          tablet_code_value TEXT,
          tablet_code_hash TEXT,
          tablet_code_updated_at TEXT,
          created_at TEXT NOT NULL
        )
        """
    )
    return conn


def migrate_dump(source_path: Path, output_dir: Path) -> Path:
    print(f"\n--- Processing {source_path.name} ---")
    source_db = load_dump_into_sqlite(source_path)
    group_row = choose_group_row(source_db)
    group_id = int(group_row["id"])
    legacy_rows = collect_legacy_rows(source_db, group_id)

    schema_rows = load_company_schema_rows()
    schema_tables = parse_tables_from_schema_rows(schema_rows)
    schema_document = build_schema_document(schema_tables)
    schema_json = json.dumps(schema_document, separators=(",", ":"), ensure_ascii=False)
    schema_hash = build_schema_hash(schema_document)

    company_name = str(group_row["name"] or source_path.stem)
    company_id = str(uuid.uuid4())
    created_at = str(group_row["created"] or now_iso())
    if "T" not in created_at and " " in created_at:
        created_at = created_at.replace(" ", "T", 1)
    if created_at and len(created_at) == 19 and created_at[10] == "T":
        created_at = f"{created_at}Z"

    package_name = source_path.name.removesuffix(".sql.xz")
    output_path = output_dir / f"{package_name}.sqlite"
    package_db = create_package_database(output_path, schema_rows)
    cursor = package_db.cursor()

    cursor.execute(
        f"""
        INSERT INTO {sqlite_quote(PACKAGE_METADATA_TABLE)} (
          package_key,
          package_version,
          exported_at,
          source_schema_hash,
          schema_json,
          original_company_id,
          name,
          api_key_hash,
          api_key_created_at,
          tablet_code_value,
          tablet_code_hash,
          tablet_code_updated_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            PACKAGE_KEY,
            PACKAGE_VERSION,
            now_iso(),
            schema_hash,
            schema_json,
            company_id,
            company_name,
            None,
            None,
            None,
            None,
            None,
            created_at,
        ),
    )

    currency = str(group_row["currency"] or "EUR")
    locale = format_locale_from_group(group_row)
    time_zone = "Europe/Vienna"
    date_time_format = convert_php_datetime_format(str(group_row["date_format"] or "%d.%m.%Y"), str(group_row["time_format"] or "%H:%M"))
    first_day_of_week = int(group_row["week_start"] or 1)
    country = str(group_row["country_code"] or "AT").upper()
    tablet_idle_timeout_seconds = int(group_row["screen_timeout"] or 10)
    custom_fields = make_custom_field_definitions(legacy_rows["custom_fields"], legacy_rows["custom_field_options"])
    user_custom_values = build_user_custom_values(legacy_rows["entity_custom_fields"])
    time_entry_custom_values = build_time_entry_custom_values(source_db)

    project_rows = list(legacy_rows["projects"])
    task_rows = list(legacy_rows["tasks"])
    user_rows = [row for row in legacy_rows["users"] if not should_skip_legacy_user(row)]

    project_users_by_project: dict[int, set[int]] = {}
    for row in legacy_rows["user_project_binds"]:
        if normalize_status(row["status"]) == 0:
            continue
        project_users_by_project.setdefault(int(row["project_id"]), set()).add(int(row["user_id"]))

    project_tasks_by_project: dict[int, set[int]] = {}
    for row in legacy_rows["project_task_binds"]:
        if normalize_status(row["status"]) == 0:
            continue
        project_tasks_by_project.setdefault(int(row["project_id"]), set()).add(int(row["task_id"]))

    projects_enabled = bool(project_rows or project_users_by_project)
    tasks_enabled = bool(task_rows or project_tasks_by_project)
    if tasks_enabled:
        projects_enabled = True

    cursor.execute(
        """
        INSERT INTO company_settings (
          currency,
          locale,
          time_zone,
          date_time_format,
          first_day_of_week,
          weekend_days_json,
          edit_days_limit,
          insert_days_limit,
          allow_one_record_per_day,
          allow_intersecting_records,
          allow_records_on_holidays,
          allow_records_on_weekends,
          allow_future_records,
          country,
          tablet_idle_timeout_seconds,
          auto_break_after_minutes,
          auto_break_duration_minutes,
          projects_enabled,
          tasks_enabled,
          overtime_settings_json,
          custom_fields_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            currency,
            locale,
            time_zone,
            date_time_format,
            first_day_of_week,
            json.dumps([6, 7]),
            int(group_row["days_limit_edit"] or 30),
            int(group_row["days_limit_insert"] or 30),
            0,
            0,
            1,
            1,
            0,
            country,
            tablet_idle_timeout_seconds,
            300,
            30,
            1 if projects_enabled else 0,
            1 if tasks_enabled else 0,
            json.dumps(derive_overtime_settings(country)),
            json.dumps(custom_fields, ensure_ascii=False),
        ),
    )

    active_user_ids: set[int] = set()
    used_usernames: set[str] = set()
    used_pins: set[str] = {"1234"}
    safe_pin_counter = [2000]
    inserted_users: set[int] = set()
    admin_exists = False

    for row in user_rows:
        source_user_id = int(row["id"])
        login = str(row["login"] or f"user_{source_user_id}").strip()
        full_name = str(row["name"] or login).strip()
        username = build_unique_username(login, used_usernames)
        pin = build_unique_pin(row["pin"], used_pins, safe_pin_counter)
        role_id = int(row["role_id"] or 0)
        role = "admin" if role_id == 1 else "manager" if role_id == 2 else "employee"
        if role == "admin":
            admin_exists = True
        created = str(row["created"] or created_at)
        custom_values = user_custom_values.get(source_user_id, {})

        cursor.execute(
            """
            INSERT INTO users (
              id,
              username,
              full_name,
              password_hash,
              role,
              is_active,
              deleted_at,
              pin_code,
              email,
              custom_field_values_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_user_id,
                username,
                full_name,
                str(row["password"] or "hash"),
                role,
                normalize_status(row["status"]),
                None,
                pin,
                row["email"],
                json.dumps(custom_values, ensure_ascii=False),
                created,
            ),
        )
        inserted_users.add(source_user_id)
        active_user_ids.add(source_user_id)

    if not admin_exists:
        synthetic_admin_id = 1
        while synthetic_admin_id in inserted_users:
            synthetic_admin_id += 1
        synthetic_username = build_unique_username("admin", used_usernames)
        synthetic_pin = build_unique_pin("1234", used_pins, safe_pin_counter)
        cursor.execute(
            """
            INSERT INTO users (
              id,
              username,
              full_name,
              password_hash,
              role,
              is_active,
              deleted_at,
              pin_code,
              email,
              custom_field_values_json,
              created_at
            ) VALUES (?, ?, ?, ?, 'admin', 1, NULL, ?, NULL, '{}', ?)
            """,
            (
                synthetic_admin_id,
                synthetic_username,
                "Admin",
                "$2a$10$9uxd6lvkIVHphs6drBpmOuG6JDhBEgigbECqD2PBdbyX3LBij65BS",
                synthetic_pin,
                created_at,
            ),
        )
        inserted_users.add(synthetic_admin_id)
        active_user_ids.add(synthetic_admin_id)

    project_ids: set[int] = set()
    for row in project_rows:
        project_id = int(row["id"])
        project_ids.add(project_id)
        description = row["description"] if row["description"] is not None else row["notes"]
        allow_all_users = 0 if project_users_by_project.get(project_id) else 1
        allow_all_tasks = 0 if project_tasks_by_project.get(project_id) else 1
        cursor.execute(
            """
            INSERT INTO projects (
              id,
              name,
              description,
              budget,
              is_active,
              allow_all_users,
              allow_all_tasks,
              custom_field_values_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                str(row["name"] or f"Project {project_id}"),
                description,
                float(row["budget"] or 0.0),
                normalize_status(row["status"]),
                allow_all_users,
                allow_all_tasks,
                "{}",
                created_at,
            ),
        )

    task_ids: set[int] = set()
    for row in task_rows:
        task_id = int(row["id"])
        task_ids.add(task_id)
        cursor.execute(
            """
            INSERT INTO tasks (
              id,
              title,
              is_active,
              custom_field_values_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                task_id,
                str(row["name"] or f"Task {task_id}"),
                normalize_status(row["status"]),
                "{}",
                created_at,
            ),
        )

    for project_id, user_ids in project_users_by_project.items():
        if project_id not in project_ids:
            continue
        for user_id in sorted(user_ids):
            if user_id not in active_user_ids:
                continue
            cursor.execute(
                "INSERT OR IGNORE INTO project_users (project_id, user_id, created_at) VALUES (?, ?, ?)",
                (project_id, user_id, created_at),
            )

    for project_id, task_ids_for_project in project_tasks_by_project.items():
        if project_id not in project_ids:
            continue
        for task_id in sorted(task_ids_for_project):
            if task_id not in task_ids:
                continue
            cursor.execute(
                "INSERT OR IGNORE INTO project_tasks (project_id, task_id, created_at) VALUES (?, ?, ?)",
                (project_id, task_id, created_at),
            )

    for user_row in user_rows:
        user_id = int(user_row["id"])
        if user_id not in active_user_ids:
            continue
        quota_percent = float(user_row["quota_percent"] or 100.0)
        workdays_week = int(float(user_row["workingdays_week"] or 5))
        if workdays_week < 1:
            workdays_week = 5
        workdays_week = min(workdays_week, 7)
        hours_per_week = round((quota_percent / 100.0) * 40.0, 2)
        payment_per_hour = float(user_row["rate"] or 0.0)
        contract_created_at = str(user_row["created"] or created_at)
        contract_start_date = contract_created_at.split(" ")[0].split("T")[0]

        cursor.execute(
            """
            INSERT INTO user_contracts (
              id,
              user_id,
              hours_per_week,
              start_date,
              end_date,
              payment_per_hour,
              annual_vacation_days,
              created_at
            ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
            """,
            (
                user_id,
                user_id,
                hours_per_week,
                contract_start_date,
                payment_per_hour,
                25.0,
                contract_created_at,
            ),
        )

        for block in build_contract_schedule(hours_per_week, workdays_week):
            cursor.execute(
                """
                INSERT INTO user_contract_schedule_blocks (
                  contract_id,
                  weekday,
                  block_order,
                  start_time,
                  end_time,
                  minutes
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    block["weekday"],
                    1,
                    block["start_time"],
                    block["end_time"],
                    block["minutes"],
                ),
            )

    for row in legacy_rows["logs"]:
        if not is_active_legacy_row(row["status"]):
            continue
        source_log_id = int(row["id"])
        user_id = int(row["user_id"])
        if user_id not in active_user_ids:
            continue
        custom_values = time_entry_custom_values.get(source_log_id, {})
        entry_type = build_entry_type(custom_values)
        start_iso, end_iso = get_iso_times(str(row["date"] or ""), str(row["start"] or ""), str(row["duration"] or ""))
        if entry_type != "work":
            day = str(row["date"] or "")
            start_iso, end_iso = get_iso_times(day, "12:00:00", "00:00:00")

        cursor.execute(
            """
            INSERT INTO time_entries (
              id,
              user_id,
              entry_type,
              entry_date,
              end_date,
              start_time,
              end_time,
              notes,
              project_id,
              task_id,
              custom_field_values_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_log_id,
                user_id,
                entry_type,
                str(row["date"] or ""),
                None if entry_type == "work" else str(row["date"] or ""),
                start_iso or "1970-01-01T00:00:00.000Z",
                end_iso if entry_type == "work" else end_iso or start_iso or "1970-01-01T00:00:00.000Z",
                row["comment"],
                int(row["project_id"]) if row["project_id"] is not None and int(row["project_id"]) in project_ids else None,
                int(row["task_id"]) if row["task_id"] is not None and int(row["task_id"]) in task_ids else None,
                json.dumps(custom_values, ensure_ascii=False),
                str(row["created"] or created_at),
            ),
        )

    package_db.commit()
    package_db.close()
    source_db.close()

    print(f"  company: {company_name}")
    print(f"  users: {len(active_user_ids)}")
    print(f"  projects: {len(project_ids)}")
    print(f"  tasks: {len(task_ids)}")
    print(f"  output: {output_path}")
    return output_path


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    dump_files = sorted(ROOT_DIR.glob("*.sql.xz"))
    if not dump_files:
        dump_files = sorted((ROOT_DIR / "databases").glob("*.sql.xz"))

    if not dump_files:
        print("No .sql.xz files found.")
        return

    for dump_file in dump_files:
        migrate_dump(dump_file, OUTPUT_DIR)


if __name__ == "__main__":
    main()
