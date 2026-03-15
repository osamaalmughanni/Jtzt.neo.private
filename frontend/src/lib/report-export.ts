import rawLogo from "@shared/img/logo.svg?raw";
import type { ReportResponse } from "@shared/types/api";
import { formatMinutes } from "@shared/utils/time";
import { formatCompanyDate, formatCompanyDateTime } from "@/lib/locale-format";

type TranslateFn = (key: string) => string;
type CustomFieldLabels = Map<string, string>;

function isLocalDayValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getReportColumnLabel(column: ReportResponse["report"]["columns"][number], t: TranslateFn) {
  const nativeKey = `reports.columns.${column.key}`;
  const translated = t(nativeKey);
  return translated === nativeKey ? column.label : translated;
}

function humanizeFieldKey(value: string) {
  return value
    .replace(/^custom:/, "")
    .replace(/^field-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getResolvedReportColumnLabel(
  column: ReportResponse["report"]["columns"][number],
  t: TranslateFn,
  customFieldLabels?: CustomFieldLabels,
) {
  const nativeLabel = getReportColumnLabel(column, t);
  if (nativeLabel !== column.label) return nativeLabel;
  const customLabel = customFieldLabels?.get(column.key) ?? customFieldLabels?.get(column.label);
  if (customLabel) return customLabel;
  if (column.label.startsWith("field-") || column.label.startsWith("custom:")) return humanizeFieldKey(column.label);
  return column.label;
}

function translateEntryType(value: string, t: TranslateFn) {
  switch (value) {
    case "work":
    case "Working":
      return t("recordEditor.working");
    case "vacation":
    case "Vacation":
      return t("recordEditor.vacation");
    case "sick_leave":
    case "Sick leave":
      return t("recordEditor.sickLeave");
    default:
      return value;
  }
}

function formatCellValue(
  value: string | number | null,
  columnKey: string,
  kind: ReportResponse["report"]["columns"][number]["kind"],
  locale: string,
  currency: string,
  dateTimeFormat: string,
  t: TranslateFn,
) {
  if (value === null || value === "") return "--";
  if (columnKey === "type" && typeof value === "string") return translateEntryType(value, t);
  if (kind === "duration" && typeof value === "number") return formatMinutes(value);
  if (kind === "currency" && typeof value === "number") {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  }
  if (kind === "date" && typeof value === "string") return formatCompanyDate(value, locale);
  if (kind === "datetime" && typeof value === "string" && isLocalDayValue(value)) {
    return formatCompanyDate(value, locale);
  }
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

function toExportColumnName(
  column: ReportResponse["report"]["columns"][number],
  t: TranslateFn,
  customFieldLabels?: CustomFieldLabels,
) {
  const normalized = getResolvedReportColumnLabel(column, t, customFieldLabels)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || column.key.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

function getExcelCell(
  value: string | number | null,
  columnKey: string,
  kind: ReportResponse["report"]["columns"][number]["kind"],
  locale: string,
  currency: string,
  dateTimeFormat: string,
  t: TranslateFn,
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
    return { type: "String", value: formatCellValue(value, columnKey, kind, locale, currency, dateTimeFormat, t) };
  }

  if (kind === "datetime" && typeof value === "string") {
    return { type: "String", value: formatCellValue(value, columnKey, kind, locale, currency, dateTimeFormat, t) };
  }

  if (kind === "number" && typeof value === "number") {
    return { type: "Number", value: String(value) };
  }

  return { type: "String", value: formatCellValue(value, columnKey, kind, locale, currency, dateTimeFormat, t) };
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

function buildExcelWorkbook(report: ReportResponse["report"], t: TranslateFn, customFieldLabels?: CustomFieldLabels) {
  const dataHeader = report.columns.map((column) => ({
    type: "String",
    value: toExportColumnName(column, t, customFieldLabels),
  }));

  const dataRows = report.rows.map((row) =>
    report.columns.map((column) =>
      getExcelCell(row[column.key] ?? null, column.key, column.kind, report.locale, report.currency, report.dateTimeFormat, t),
    ),
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

function createDownload(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function normalizePdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncatePdfText(value: string, maxChars: number) {
  const normalized = normalizePdfText(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function formatPdfCellValue(
  value: string | number | null,
  columnKey: string,
  kind: ReportResponse["report"]["columns"][number]["kind"],
  locale: string,
  currency: string,
  dateTimeFormat: string,
  t: TranslateFn,
) {
  if (value === null || value === "") return "";
  if (kind === "currency" && typeof value === "number") {
    return `${value.toFixed(2)} ${currency}`;
  }

  return normalizePdfText(formatCellValue(value, columnKey, kind, locale, currency, dateTimeFormat, t));
}

function buildPdf(report: ReportResponse["report"], t: TranslateFn, customFieldLabels?: CustomFieldLabels) {
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 28;
  const headerHeight = 52;
  const footerHeight = 14;
  const tableHeaderHeight = 18;
  const rowHeight = 14;
  const tableTop = pageHeight - margin - headerHeight;
  const usableHeight = tableTop - margin - footerHeight - tableHeaderHeight;
  const rowsPerPage = Math.max(10, Math.floor(usableHeight / rowHeight));
  const contentWidth = pageWidth - margin * 2;
  const columnWidth = contentWidth / Math.max(1, report.columns.length);
  const maxCharsPerCell = Math.max(6, Math.floor((columnWidth - 6) / 5.2));
  const formattedRows = report.rows.map((row) =>
    report.columns.map((column) =>
      truncatePdfText(
        formatPdfCellValue(
          row[column.key] ?? null,
          column.key,
          column.kind,
          report.locale,
          report.currency,
          report.dateTimeFormat,
          t,
        ),
        maxCharsPerCell,
      ),
    ),
  );
  const pageChunks = Array.from({ length: Math.max(1, Math.ceil(formattedRows.length / rowsPerPage)) }, (_, index) =>
    formattedRows.slice(index * rowsPerPage, (index + 1) * rowsPerPage),
  );

  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const fontRegularId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds: number[] = [];
  const logoWord = normalizePdfText(rawLogo).includes("Jtzt") ? "Jtzt" : "Jtzt";

  for (let pageIndex = 0; pageIndex < pageChunks.length; pageIndex += 1) {
    const rows = pageChunks[pageIndex];
    const commands: string[] = [];
    const pushText = (text: string, x: number, y: number, size: number, fontKey: "F1" | "F2" = "F1") => {
      commands.push(`BT /${fontKey} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`);
    };

    commands.push("0 0 0 rg");
    commands.push("0 0 0 RG");
    commands.push("0.5 w");

    pushText(logoWord, margin, pageHeight - margin - 4, 16, "F2");
    pushText("Report", margin + 40, pageHeight - margin - 4, 13, "F2");
    pushText(
      normalizePdfText(`${formatCompanyDate(report.startDate, report.locale)} to ${formatCompanyDate(report.endDate, report.locale)}`),
      margin,
      pageHeight - margin - 18,
      8.5,
    );

    const headerY = tableTop;
    commands.push(`${margin} ${headerY} m ${pageWidth - margin} ${headerY} l S`);
    commands.push(`${margin} ${headerY - tableHeaderHeight} m ${pageWidth - margin} ${headerY - tableHeaderHeight} l S`);

    for (let columnIndex = 0; columnIndex < report.columns.length; columnIndex += 1) {
      const x = margin + columnIndex * columnWidth;
      if (columnIndex > 0) {
        commands.push(`${x.toFixed(2)} ${margin} m ${x.toFixed(2)} ${headerY} l S`);
      }
      pushText(
        truncatePdfText(normalizePdfText(getResolvedReportColumnLabel(report.columns[columnIndex], t, customFieldLabels)), maxCharsPerCell),
        x + 3,
        headerY - 12,
        7.5,
        "F2",
      );
    }

    rows.forEach((row, rowIndex) => {
      const rowTop = headerY - tableHeaderHeight - rowIndex * rowHeight;
      const rowBottom = rowTop - rowHeight;
      commands.push(`${margin} ${rowBottom} m ${pageWidth - margin} ${rowBottom} l S`);
      row.forEach((cell, columnIndex) => {
        const x = margin + columnIndex * columnWidth;
        pushText(cell, x + 3, rowTop - 10, 7, "F1");
      });
    });

    pushText(`Page ${pageIndex + 1} / ${pageChunks.length}`, pageWidth - margin - 46, margin - 2, 7);

    const contentStream = commands.join("\n");
    const contentId = addObject(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`,
    );
    pageIds.push(pageId);
  }

  const pagesId = addObject(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  objects.forEach((object, index) => {
    if (object.includes("/Parent 0 0 R")) {
      objects[index] = object.replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
    }
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

export function exportReportExcel(report: ReportResponse["report"], t: TranslateFn, customFieldLabels?: CustomFieldLabels) {
  const workbook = buildExcelWorkbook(report, t, customFieldLabels);
  createDownload(workbook, buildFileName(report, "xls"), "application/vnd.ms-excel;charset=utf-8;");
}

export function exportReportPdf(report: ReportResponse["report"], t: TranslateFn, customFieldLabels?: CustomFieldLabels) {
  const pdf = buildPdf(report, t, customFieldLabels);
  createDownload(pdf, buildFileName(report, "pdf"), "application/pdf");
}
