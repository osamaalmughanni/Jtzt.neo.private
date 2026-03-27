import type { CalculationChartType } from "@shared/types/models";

type CalculationRow = Record<string, string | number | null>;

export interface CalculationChartPreviewProps {
  rows: CalculationRow[];
  categoryColumn: string | null;
  valueColumn: string | null;
  chartType: CalculationChartType;
  missingMappingLabel: string;
  emptyDataLabel: string;
  className?: string;
}

function toNumber(value: string | number | null) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toLabel(value: string | number | null, index: number) {
  if (value === null || value === undefined || value === "") {
    return `Item ${index + 1}`;
  }

  return String(value);
}

export function CalculationChartPreview({
  rows,
  categoryColumn,
  valueColumn,
  chartType,
  missingMappingLabel,
  emptyDataLabel,
  className,
}: CalculationChartPreviewProps) {
  const points = rows
    .map((row, index) => ({
      label: toLabel(categoryColumn ? row[categoryColumn] ?? null : null, index),
      value: toNumber(valueColumn ? row[valueColumn] ?? null : null),
    }))
    .filter((point) => Number.isFinite(point.value));

  if (!categoryColumn || !valueColumn) {
    return (
      <div className={className}>
        <p className="text-sm text-muted-foreground">{missingMappingLabel}</p>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className={className}>
        <p className="text-sm text-muted-foreground">{emptyDataLabel}</p>
      </div>
    );
  }

  const width = 720;
  const height = 320;
  const paddingX = 40;
  const paddingY = 24;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const barGap = 12;
  const barWidth = Math.max(16, (width - paddingX * 2 - barGap * (points.length - 1)) / points.length);

  if (chartType === "pie") {
    const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
    let offset = 0;
    const segments = points.map((point, index) => {
      const percent = Math.max(point.value, 0) / total;
      const start = offset;
      offset += percent;
      const colors = ["#0ea5e9", "#8b5cf6", "#f97316", "#22c55e", "#ef4444", "#14b8a6"];
      return {
        ...point,
        color: colors[index % colors.length],
        start,
        end: offset,
      };
    });

    return (
      <div className={className}>
        <div
          className="mx-auto aspect-square w-full max-w-[18rem] rounded-full border border-border"
          style={{
            background: `conic-gradient(${segments
              .map((segment) => `${segment.color} ${segment.start * 100}% ${segment.end * 100}%`)
              .join(", ")})`,
          }}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {segments.map((segment) => (
            <div key={segment.label} className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
              <span>{segment.label}</span>
              <span className="text-muted-foreground">{segment.value.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const chartHeight = height - paddingY * 2;
  const chartWidth = width - paddingX * 2;

  if (chartType === "line" || chartType === "area") {
    const stepX = points.length > 1 ? chartWidth / (points.length - 1) : chartWidth;
    const yPoints = points.map((point, index) => {
      const x = paddingX + index * stepX;
      const y = paddingY + chartHeight - (point.value / maxValue) * chartHeight;
      return { ...point, x, y };
    });
    const linePath = yPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    const areaPath =
      chartType === "area"
        ? `${linePath} L ${paddingX + chartWidth} ${paddingY + chartHeight} L ${paddingX} ${paddingY + chartHeight} Z`
        : null;

    return (
      <div className={className}>
        <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full">
          <defs>
            <linearGradient id="calculation-chart-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line x1={paddingX} y1={paddingY + chartHeight} x2={paddingX + chartWidth} y2={paddingY + chartHeight} stroke="currentColor" strokeOpacity="0.2" />
          <line x1={paddingX} y1={paddingY} x2={paddingX} y2={paddingY + chartHeight} stroke="currentColor" strokeOpacity="0.2" />
          {areaPath ? <path d={areaPath} fill="url(#calculation-chart-fill)" /> : null}
          <path d={linePath} fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          {yPoints.map((point) => (
            <g key={point.label}>
              <circle cx={point.x} cy={point.y} r="4" fill="#0ea5e9" />
              <text x={point.x} y={height - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {point.label.length > 12 ? `${point.label.slice(0, 12)}…` : point.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex h-72 items-end gap-3 rounded-2xl border border-border bg-background p-4">
        {points.map((point) => (
          <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex w-full flex-1 items-end">
              <div
                className="min-h-2 w-full rounded-t-xl bg-sky-500"
                style={{ height: `${(point.value / maxValue) * 100}%` }}
                title={`${point.label}: ${point.value.toFixed(2)}`}
              />
            </div>
            <span className="w-full truncate text-center text-[11px] text-muted-foreground">{point.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
