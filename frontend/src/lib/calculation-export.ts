import type { CalculationValidationResponse } from "@shared/types/api";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function buildFileName(name: string) {
  const safeName = sanitizeFileName(name) || "calculation";
  return `jtzt-calculation-${safeName}.xls`;
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

function buildSpreadsheetRow(cells: Array<{ type: "String" | "Number"; value: string }>, styleId?: string) {
  const styleAttribute = styleId ? ` ss:StyleID="${styleId}"` : "";
  return `<Row>${cells
    .map(
      (cell) =>
        `<Cell${styleAttribute}><Data ss:Type="${cell.type}">${escapeHtml(cell.value)}</Data></Cell>`,
    )
    .join("")}</Row>`;
}

function getExcelCell(value: string | number | null) {
  if (value === null || value === "") {
    return { type: "String" as const, value: "" };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return { type: "Number" as const, value: String(value) };
  }

  return { type: "String" as const, value: String(value) };
}

function buildExcelWorkbook(calculationName: string, validation: CalculationValidationResponse) {
  const headers = validation.columns.map((column) => ({ type: "String" as const, value: column }));
  const dataRows = validation.rows.map((row) => validation.columns.map((column) => getExcelCell(row[column] ?? null)));

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
    <Title>${escapeHtml(calculationName)}</Title>
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
  <Worksheet ss:Name="calculation">
    <Table>
      ${buildSpreadsheetRow(headers, "Header")}
      ${dataRows.map((row) => buildSpreadsheetRow(row, "Cell")).join("")}
    </Table>
  </Worksheet>
</Workbook>`;
}

export function exportCalculationExcel(calculationName: string, validation: CalculationValidationResponse) {
  const workbook = buildExcelWorkbook(calculationName, validation);
  createDownload(workbook, buildFileName(calculationName), "application/vnd.ms-excel;charset=utf-8;");
}
