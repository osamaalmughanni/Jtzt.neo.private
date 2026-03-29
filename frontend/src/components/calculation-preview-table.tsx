import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type PreviewRow = Record<string, string | number | null>;

function normalizeCell(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }
  return String(value);
}

export function CalculationPreviewTable({
  title,
  columns,
  rows,
  emptyLabel,
  searchPlaceholder,
  embedded = false,
  fullHeight = false,
}: {
  title: string;
  columns: string[];
  rows: PreviewRow[];
  emptyLabel: string;
  searchPlaceholder: string;
  embedded?: boolean;
  fullHeight?: boolean;
}) {
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      columns.some((column) => normalizeCell(row[column]).toLowerCase().includes(query))
    );
  }, [columns, rows, search]);

  return (
    <div
      className={
        embedded
          ? "flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4"
          : "flex min-h-0 w-full min-w-0 flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5"
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="min-w-0 text-sm font-medium text-foreground">{title}</p>
        <div className="grid min-w-0 gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
          <Badge
            variant="outline"
            className="h-9 w-fit shrink-0 whitespace-nowrap rounded-full border-border bg-muted/40 px-3 text-[11px] font-medium text-muted-foreground"
          >
            {filteredRows.length} / {rows.length}
          </Badge>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full min-w-0 md:max-w-md"
          />
        </div>
      </div>

      <div
        className={
          fullHeight
            ? "relative min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-2xl border border-border bg-background"
            : "relative min-h-0 w-full min-w-0 overflow-auto rounded-2xl border border-border bg-background"
        }
      >
        <Table className="w-full min-w-full table-auto border-separate border-spacing-0 text-sm">
          <TableHeader className="sticky top-0 z-30">
            <TableRow className="h-11 border-b border-border bg-muted/40 hover:bg-muted/40">
              {columns.map((column) => (
                <TableHead
                  key={column}
                  className="min-w-[10rem] whitespace-normal break-words border-b border-border bg-muted/40 px-4 py-3 text-left font-medium leading-5 text-foreground align-middle"
                >
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell className="px-4 py-6 text-sm text-muted-foreground align-middle" colSpan={Math.max(1, columns.length)}>
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row, index) => (
                <TableRow key={index} className="h-11 border-b border-border/70 last:border-b-0">
                  {columns.map((column) => (
                    <TableCell key={column} className="min-w-[10rem] px-4 py-3 align-middle text-muted-foreground">
                      <span className="block whitespace-normal break-words leading-5">{normalizeCell(row[column])}</span>
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
