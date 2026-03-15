import type { ReportResponse } from "@shared/types/api";
import { formatMinutes } from "@shared/utils/time";
import { formatCompanyDate, formatCompanyDateTime } from "@/lib/locale-format";

const jtztLogoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Jtzt logo">
  <rect width="64" height="64" rx="14" fill="#111827" />
  <text
    x="32"
    y="48"
    fill="#ffffff"
    font-family="Arial, Helvetica, sans-serif"
    font-size="44"
    font-weight="700"
    text-anchor="middle"
  >
    J
  </text>
</svg>
`.trim();

function formatCellValue(
  value: string | number | null,
  kind: ReportResponse["report"]["columns"][number]["kind"],
  locale: string,
  currency: string,
  dateTimeFormat: string,
) {
  if (value === null || value === "") return "--";
  if (kind === "duration" && typeof value === "number") return formatMinutes(value);
  if (kind === "currency" && typeof value === "number") {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  }
  if (kind === "date" && typeof value === "string") return formatCompanyDate(value, locale);
  if (kind === "datetime" && typeof value === "string") return formatCompanyDateTime(value, locale, dateTimeFormat);
  if (kind === "number" && typeof value === "number") return new Intl.NumberFormat(locale).format(value);
  return String(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildFileName(report: ReportResponse["report"], extension: string) {
  return `jtzt-report-${report.startDate}-${report.endDate}.${extension}`;
}

function toExportColumnName(column: ReportResponse["report"]["columns"][number]) {
  const normalized = column.label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || column.key.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

function getExcelCell(
  value: string | number | null,
  kind: ReportResponse["report"]["columns"][number]["kind"],
  locale: string,
  currency: string,
  dateTimeFormat: string,
) {
  if (value === null || value === "") {
    return { type: "String", value: "" };
  }

  if (kind === "date" && typeof value === "string") {
    return { type: "String", value: formatCompanyDate(value, locale) };
  }

  if (kind === "duration" && typeof value === "number") {
    return { type: "String", value: formatMinutes(value) };
  }

  if (kind === "currency" && typeof value === "number") {
    return { type: "String", value: formatCellValue(value, kind, locale, currency, dateTimeFormat) };
  }

  if (kind === "datetime" && typeof value === "string") {
    return { type: "String", value: formatCompanyDateTime(value, locale, dateTimeFormat) };
  }

  if (kind === "number" && typeof value === "number") {
    return { type: "Number", value: String(value) };
  }

  return { type: "String", value: String(value) };
}

function buildSpreadsheetRow(cells: Array<{ type: string; value: string }>, styleId?: string) {
  const styleAttribute = styleId ? ` ss:StyleID="${styleId}"` : "";
  return `<Row>${cells
    .map(
      (cell) =>
        `<Cell${styleAttribute}><Data ss:Type="${cell.type}">${escapeHtml(cell.value)}</Data></Cell>`,
    )
    .join("")}</Row>`;
}

function buildExcelWorkbook(report: ReportResponse["report"]) {
  const dataHeader = report.columns.map((column) => ({
    type: "String",
    value: toExportColumnName(column),
  }));

  const dataRows = report.rows.map((row) =>
    report.columns.map((column) => getExcelCell(row[column.key] ?? null, column.kind, report.locale, report.currency, report.dateTimeFormat)),
  );

  return `<?xml version="1.0"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40"
>
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Author>Jtzt</Author>
    <Company>Jtzt</Company>
    <Title>Jtzt Report</Title>
  </DocumentProperties>
  <ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel">
    <ProtectStructure>False</ProtectStructure>
    <ProtectWindows>False</ProtectWindows>
  </ExcelWorkbook>
  <Styles>
    <Style ss:ID="Header">
      <Font ss:FontName="Courier New" ss:Bold="1" />
    </Style>
    <Style ss:ID="Cell">
      <Font ss:FontName="Courier New" />
    </Style>
  </Styles>
  <Worksheet ss:Name="report">
    <Table>
      ${buildSpreadsheetRow(dataHeader, "Header")}
      ${dataRows.map((row) => buildSpreadsheetRow(row, "Cell")).join("")}
    </Table>
  </Worksheet>
</Workbook>`;
}

function buildTableMarkup(report: ReportResponse["report"]) {
  const headerCells = report.columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join("");
  const bodyRows = report.rows
    .map(
      (row) =>
        `<tr>${report.columns
          .map((column) => `<td>${escapeHtml(formatCellValue(row[column.key] ?? null, column.kind, report.locale, report.currency, report.dateTimeFormat))}</td>`)
          .join("")}</tr>`,
    )
    .join("");

  return `
    <table class="report-table">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function createDownload(html: string, fileName: string, mimeType: string) {
  const blob = new Blob([html], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportReportExcel(report: ReportResponse["report"]) {
  const workbook = buildExcelWorkbook(report);
  createDownload(workbook, buildFileName(report, "xls"), "application/vnd.ms-excel;charset=utf-8;");
}

export function exportReportPdf(report: ReportResponse["report"]) {
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1280,height=900");
  if (!printWindow) return;

  printWindow.document.write(`
    <html>
      <head>
        <title>Jtzt Report</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          :root {
            color-scheme: light;
          }
          body {
            font-family: Inter, Arial, sans-serif;
            padding: 28px 32px 40px;
            color: #0f172a;
            background: #ffffff;
          }
          .page {
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            padding-bottom: 18px;
            border-bottom: 2px solid #e2e8f0;
          }
          .brand {
            display: flex;
            align-items: center;
            gap: 16px;
          }
          .logo {
            width: 48px;
            height: 48px;
            flex: 0 0 auto;
          }
          .title {
            margin: 0;
            font-size: 24px;
            line-height: 1.1;
            font-weight: 700;
          }
          .subtitle {
            margin: 6px 0 0;
            color: #475569;
            font-size: 12px;
          }
          .meta {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px 16px;
            min-width: 280px;
          }
          .meta-card {
            border: 1px solid #cbd5e1;
            border-radius: 12px;
            padding: 10px 12px;
            background: #f8fafc;
          }
          .meta-label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #64748b;
            margin: 0 0 4px;
          }
          .meta-value {
            font-size: 12px;
            font-weight: 600;
            color: #0f172a;
            margin: 0;
          }
          .report-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }
          .report-table th,
          .report-table td {
            border: 1px solid #cbd5e1;
            padding: 7px 9px;
            text-align: left;
            vertical-align: top;
          }
          .report-table thead th {
            background: #e2e8f0;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            white-space: nowrap;
          }
          .report-table tbody tr:nth-child(even) td {
            background: #f8fafc;
          }
          .footer {
            display: flex;
            justify-content: space-between;
            color: #64748b;
            font-size: 11px;
            padding-top: 12px;
            border-top: 1px solid #e2e8f0;
          }
          @page {
            size: A4 landscape;
            margin: 14mm;
          }
          @media print {
            body {
              padding: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header">
            <div class="brand">
              <div class="logo">${jtztLogoSvg}</div>
              <div>
                <h1 class="title">Jtzt Report</h1>
                <p class="subtitle">${escapeHtml(formatCompanyDate(report.startDate, report.locale))} to ${escapeHtml(formatCompanyDate(report.endDate, report.locale))}</p>
              </div>
            </div>
            <div class="meta">
              <div class="meta-card">
                <p class="meta-label">Entries</p>
                <p class="meta-value">${escapeHtml(new Intl.NumberFormat(report.locale).format(report.totals.entryCount))}</p>
              </div>
              <div class="meta-card">
                <p class="meta-label">Hours</p>
                <p class="meta-value">${escapeHtml(formatMinutes(report.totals.durationMinutes))}</p>
              </div>
              <div class="meta-card">
                <p class="meta-label">Cost</p>
                <p class="meta-value">${escapeHtml(formatCellValue(report.totals.cost, "currency", report.locale, report.currency))}</p>
              </div>
              <div class="meta-card">
                <p class="meta-label">Grouped</p>
                <p class="meta-value">${report.grouped ? "Yes" : "No"}</p>
              </div>
            </div>
          </div>
          ${buildTableMarkup(report)}
          <div class="footer">
            <span>Generated by Jtzt</span>
            <span>${escapeHtml(new Date().toLocaleString(report.locale))}</span>
          </div>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
