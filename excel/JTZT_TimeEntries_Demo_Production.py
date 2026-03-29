from __future__ import annotations

import argparse
import json
import re
import shutil
import urllib.error
import urllib.request
import zipfile
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any

import xlwings as xw
import xlsxwriter


DEFAULT_BASE_URL = "http://localhost:5173/api/external"
DEFAULT_COLUMNS = [
    "id",
    "user_id",
    "entry_type",
    "entry_date",
    "end_date",
    "start_time",
    "end_time",
    "notes",
    "project_id",
    "task_id",
    "created_at",
]
WORKBOOK_NAME = "JTZT_TimeEntries_Demo_Production.xlsm"


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_int(value: Any, default: int) -> int:
    text = normalize_text(value)
    if not text:
        return default
    try:
        return int(float(text))
    except ValueError:
        return default


def parse_json(value: Any, default: Any) -> Any:
    text = normalize_text(value)
    if not text:
        return default
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return default


def parse_columns(value: Any) -> list[str] | None:
    text = normalize_text(value)
    if not text:
        return None

    parsed = parse_json(text, None)
    if isinstance(parsed, list):
        columns = [normalize_text(item) for item in parsed if normalize_text(item)]
        return columns or None

    columns = [normalize_text(part) for part in re.split(r"[,\n;]+", text) if normalize_text(part)]
    return columns or None


def to_iso_date(value: Any) -> str | None:
    text = normalize_text(value)
    if not text:
        return None

    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def root_url(endpoint: str) -> str:
    endpoint = normalize_text(endpoint)
    if not endpoint:
        return DEFAULT_BASE_URL
    for suffix in ("/query", "/mutate", "/schema", "/docs"):
        if endpoint.endswith(suffix):
            return endpoint[: -len(suffix)]
    return endpoint.rstrip("/")


def resolve_endpoint(base_url: str, mode: str) -> str:
    root = root_url(base_url)
    mode = mode.lower()
    if mode == "overview":
        return root
    if mode == "docs":
        return f"{root}/docs"
    if mode == "schema":
        return f"{root}/schema"
    if mode == "mutate":
        return f"{root}/mutate"
    return f"{root}/query"


def http_request(url: str, api_key: str, method: str = "GET", payload: dict[str, Any] | None = None) -> Any:
    headers = {"X-API-Key": api_key}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def flatten_json(value: Any, prefix: str = "") -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, item in value.items():
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            rows.extend(flatten_json(item, next_prefix))
    elif isinstance(value, list):
        if value and all(isinstance(item, dict) for item in value):
            for index, item in enumerate(value, start=1):
                next_prefix = f"{prefix}[{index}]"
                rows.extend(flatten_json(item, next_prefix))
        else:
            rows.append((prefix or "value", json.dumps(value, ensure_ascii=False)))
    else:
        rows.append((prefix or "value", "" if value is None else str(value)))
    return rows


def excel_column_name(index: int) -> str:
    name = ""
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def clear_output_range(sheet) -> None:
    try:
        while sheet.api.ListObjects.Count:
            sheet.api.ListObjects(1).Delete()
    except Exception:
        pass
    sheet.range("A1:AZ20000").clear_contents()


def apply_table_style(sheet, cell_range: str, table_name: str) -> None:
    try:
        existing = sheet.api.ListObjects
        while existing.Count:
            existing(1).Delete()
    except Exception:
        pass

    try:
        lo = sheet.api.ListObjects.Add(1, sheet.range(cell_range).api, None, 1)
        lo.Name = table_name
        lo.TableStyle = "TableStyleMedium2"
    except Exception:
        pass


def write_table(sheet, columns: list[str], rows: list[dict[str, Any]]) -> None:
    clear_output_range(sheet)

    if not columns and rows:
        columns = list(rows[0].keys())

    if not columns:
        sheet.range("A1").value = "No rows returned."
        return

    sheet.range((1, 1), (1, len(columns))).value = [columns]
    if rows:
        table_rows = [[row.get(column) for column in columns] for row in rows]
        sheet.range((2, 1), (1 + len(rows), len(columns))).value = table_rows
        apply_table_style(sheet, f"A1:{excel_column_name(len(columns))}{1 + len(rows)}", "JTZTData")
    else:
        sheet.range("A2").value = "No rows returned."


def write_summary(sheet, data: Any) -> None:
    clear_output_range(sheet)
    sheet.range((1, 1), (1, 2)).value = [["Path", "Value"]]

    flattened = flatten_json(data)
    if not flattened:
        sheet.range("A2").value = "No data returned."
        return

    values = [[path, value] for path, value in flattened]
    sheet.range((2, 1), (1 + len(values), 2)).value = values
    apply_table_style(sheet, f"A1:B{1 + len(values)}", "JTZTSummary")


def load_config(sheet) -> dict[str, Any]:
    return {
        "mode": normalize_text(sheet["B4"].value).lower() or "read",
        "endpoint": normalize_text(sheet["B5"].value) or DEFAULT_BASE_URL,
        "api_key": normalize_text(sheet["B6"].value),
        "table": normalize_text(sheet["B7"].value) or "time_entries",
        "columns": parse_columns(sheet["B8"].value),
        "start_date": to_iso_date(sheet["B9"].value),
        "end_date": to_iso_date(sheet["B10"].value),
        "filters": parse_json(sheet["B11"].value, []),
        "order_by": parse_json(sheet["B12"].value, []),
        "limit": parse_int(sheet["B13"].value, 5000),
        "offset": parse_int(sheet["B14"].value, 0),
        "action": normalize_text(sheet["B15"].value).lower() or "insert",
        "values": parse_json(sheet["B16"].value, {}),
    }


def resolve_request(config: dict[str, Any]) -> tuple[str, str, dict[str, Any] | None]:
    mode = config["mode"]
    endpoint = resolve_endpoint(config["endpoint"], mode)

    if mode == "overview":
        return endpoint, "GET", None
    if mode == "docs":
        return endpoint, "GET", None
    if mode == "schema":
        return endpoint, "GET", None
    if mode == "mutate":
        payload = build_mutation_payload_from_config(config)
        return endpoint, "POST", payload

    payload = build_query_payload_from_config(config)
    return endpoint, "POST", payload


def build_query_payload_from_config(config: dict[str, Any]) -> dict[str, Any]:
    table = config["table"] or "time_entries"
    columns = config["columns"]
    filters = list(config["filters"] if isinstance(config["filters"], list) else [])
    order_by = list(config["order_by"] if isinstance(config["order_by"], list) else [])

    if table == "time_entries":
        if config["start_date"]:
            filters.append({"column": "entry_date", "operator": "gte", "value": config["start_date"]})
        if config["end_date"]:
            filters.append({"column": "entry_date", "operator": "lte", "value": config["end_date"]})
        if not order_by:
            order_by = [
                {"column": "entry_date", "direction": "asc"},
                {"column": "start_time", "direction": "asc"},
            ]

    payload: dict[str, Any] = {
        "table": table,
        "limit": config["limit"],
        "offset": config["offset"],
    }
    if columns:
        payload["columns"] = columns
    if filters:
        payload["filters"] = filters
    if order_by:
        payload["orderBy"] = order_by
    return payload


def build_mutation_payload_from_config(config: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "action": config["action"] or "insert",
        "table": config["table"],
    }
    if isinstance(config["values"], dict) and config["values"]:
        payload["values"] = config["values"]
    if isinstance(config["filters"], list) and config["filters"]:
        payload["filters"] = config["filters"]
    return payload


def refresh_from_sheet(sheet_controls, sheet_output) -> None:
    config = load_config(sheet_controls)
    mode = config["mode"]
    status_cell = sheet_controls["B17"]
    status_cell.value = "Refreshing..."

    if not config["api_key"]:
        status_cell.value = "API key is required"
        write_summary(sheet_output, {"error": "missing_api_key"})
        return

    endpoint, method, payload = resolve_request(config)

    try:
        if method == "GET":
            response = http_request(endpoint, config["api_key"], method="GET")
        else:
            response = http_request(endpoint, config["api_key"], method="POST", payload=payload)

        if isinstance(response, dict) and "rows" in response and isinstance(response["rows"], list):
            rows = response["rows"]
            columns = response.get("columns") or config["columns"] or []
            write_table(sheet_output, columns, rows)
            status_cell.value = f"Loaded {len(rows)} rows"
            return

        if isinstance(response, dict) and ("docs" in response or "tables" in response):
            write_summary(sheet_output, response)
            status_cell.value = "Loaded structured response"
            return

        write_summary(sheet_output, response)
        status_cell.value = "Loaded response"
    except urllib.error.HTTPError as exc:
        message = exc.read().decode("utf-8", "ignore") if hasattr(exc, "read") else str(exc)
        write_summary(sheet_output, {"error": exc.code, "message": message[:2000]})
        status_cell.value = f"Error: {exc.code}"
    except Exception as exc:
        write_summary(sheet_output, {"error": "request_failed", "message": str(exc)})
        status_cell.value = "Error"
        return


def main() -> None:
    wb = xw.Book.caller()
    controls = wb.sheets["API Controls"]
    output = wb.sheets["Output"]
    refresh_from_sheet(controls, output)


def _template_vba_project() -> Path:
    package_dir = Path(xw.__file__).resolve().parent
    return package_dir / "quickstart_standalone.xlsm"


def build_workbook(output_path: Path) -> None:
    template_path = _template_vba_project()
    with zipfile.ZipFile(template_path, "r") as archive:
        vba_project = BytesIO(archive.read("xl/vbaProject.bin"))

    workbook = xlsxwriter.Workbook(str(output_path))
    workbook.add_vba_project(vba_project, is_stream=True)
    workbook.set_properties(
        {
            "title": "JTZT Time Entries API Demo",
            "subject": "Company API Excel demo",
            "author": "JTZT",
            "company": "JTZT",
        }
    )

    # Formats
    title_fmt = workbook.add_format(
        {
            "bold": True,
            "font_size": 18,
            "font_color": "#111111",
            "bg_color": "#F3F3F3",
            "valign": "vcenter",
        }
    )
    subtitle_fmt = workbook.add_format(
        {
            "font_color": "#555555",
            "text_wrap": True,
            "valign": "vcenter",
        }
    )
    label_fmt = workbook.add_format(
        {
            "bold": True,
            "font_color": "#111111",
            "bg_color": "#F0F0F0",
            "border": 1,
            "border_color": "#111111",
            "valign": "vcenter",
        }
    )
    input_fmt = workbook.add_format(
        {
            "bg_color": "#FFFFFF",
            "border": 1,
            "border_color": "#111111",
            "valign": "vcenter",
        }
    )
    note_fmt = workbook.add_format(
        {
            "text_wrap": True,
            "font_color": "#555555",
            "valign": "top",
        }
    )
    status_fmt = workbook.add_format(
        {
            "bg_color": "#F8F8F8",
            "border": 1,
            "border_color": "#111111",
            "italic": True,
        }
    )
    header_fmt = workbook.add_format(
        {
            "bold": True,
            "font_color": "#FFFFFF",
            "bg_color": "#111111",
            "border": 1,
            "border_color": "#111111",
            "align": "center",
            "valign": "vcenter",
        }
    )
    help_fmt = workbook.add_format(
        {
            "font_color": "#555555",
            "text_wrap": True,
            "valign": "top",
        }
    )

    controls = workbook.add_worksheet("API Controls")
    output = workbook.add_worksheet("Output")
    config = workbook.add_worksheet("_xlwings.conf")
    config.hide()

    controls.hide_gridlines(2)
    controls.set_zoom(110)
    controls.set_default_row(20)
    controls.set_column("A:A", 18)
    controls.set_column("B:B", 72)
    controls.set_column("D:E", 22)
    controls.merge_range("A1:B1", "JTZT Company API Demo", title_fmt)
    controls.merge_range(
        "A2:B2",
        "All inputs live here. Leave fields blank to use defaults. Click Refresh to run the selected API case.",
        subtitle_fmt,
    )

    labels = [
        ("Mode", "read"),
        ("Base URL", DEFAULT_BASE_URL),
        ("API key", ""),
        ("Table", "time_entries"),
        ("Columns", ",".join(DEFAULT_COLUMNS)),
        ("Start date", (date.today() - timedelta(days=7)).isoformat()),
        ("End date", date.today().isoformat()),
        ("Filters JSON", ""),
        ("Order By JSON", ""),
        ("Limit", "5000"),
        ("Offset", "0"),
        ("Action", "insert"),
        ("Values JSON", ""),
    ]

    row = 4
    for label, default in labels:
        controls.write(f"A{row}", label, label_fmt)
        controls.write(f"B{row}", default, input_fmt)
        row += 1

    controls.write("A17", "Status", label_fmt)
    controls.write("B17", "Ready", status_fmt)
    controls.write("A19", "Mode options", label_fmt)
    controls.write("B19", "read, mutate, schema, docs, overview", help_fmt)
    controls.write("A20", "Quick read", label_fmt)
    controls.write(
        "B20",
        "For time entries, use Mode=read and the Start/End date fields. Columns can stay as-is or be cleared for all columns.",
        help_fmt,
    )
    controls.write("A21", "Filters", label_fmt)
    controls.write(
        "B21",
        "Use Filters JSON for extra conditions. Example: [{\"column\":\"user_id\",\"operator\":\"eq\",\"value\":1}]",
        help_fmt,
    )
    controls.write("A22", "Mutations", label_fmt)
    controls.write(
        "B22",
        "Use Mode=mutate, set Action to insert/update/delete, then provide Values JSON and Filters JSON as needed.",
        help_fmt,
    )
    controls.write("A23", "Tables", label_fmt)
    controls.write("B23", "Use any live company-scoped table from /api/external/schema.", help_fmt)

    controls.insert_button(
        "D4",
        {
            "macro": "SampleCall",
            "caption": "Refresh",
            "width": 160,
            "height": 36,
            "x_offset": 0,
            "y_offset": 0,
        },
    )

    output.hide_gridlines(2)
    output.set_zoom(100)
    output.set_default_row(18)
    output.freeze_panes(1, 0)
    output.set_column("A:A", 38)
    output.set_column("B:AZ", 18)

    config.write("A1", "PYTHONPATH")
    config.write("A2", "UDF Modules")
    config.write("A3", "Debug UDFs")
    config.write("A4", "Use UDF Server")
    config.write("A5", "Instructions:")
    config.write("A6", "Conda Env")
    config.write("A7", "When activated, these settings override workbook defaults.")
    config.write("A8", "Conda Path")
    config.write("A9", "Interpreter_Win")
    config.write("A10", "Interpreter_Mac")
    config.write("A11", "If you want to rely on add-in settings, you can delete this sheet.")
    config.write("A12", 'Rename this sheet to "xlwings.conf" to activate it.')
    config.write("A13", "If you delete a row from here, xlwings falls back to other config.")
    config.write("A14", "python")
    config.write("A15", "Show Console")

    workbook.close()


def main_cli() -> int:
    parser = argparse.ArgumentParser(description="JTZT Excel API workbook")
    parser.add_argument("--build", action="store_true", help="Build the macro-enabled workbook")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().with_name(WORKBOOK_NAME),
        help="Workbook output path",
    )
    args = parser.parse_args()

    if args.build:
        build_workbook(args.output.resolve())
        print(f"Created workbook: {args.output.resolve()}")
        return 0

    main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main_cli())
