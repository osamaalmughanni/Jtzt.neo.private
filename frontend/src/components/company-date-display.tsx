import { useMemo } from "react";
import { useCompanySettings } from "@/lib/company-settings";
import { formatCompanyDateParts } from "@/lib/locale-format";
import { cn } from "@/lib/utils";
import { DEFAULT_COMPANY_LOCALE } from "@shared/utils/company-locale";

export function CompanyDateDisplay({
  day,
  className,
  dateClassName,
  weekdayClassName,
  centered = false,
}: {
  day: string;
  className?: string;
  dateClassName?: string;
  weekdayClassName?: string;
  centered?: boolean;
}) {
  const { settings } = useCompanySettings();
  const locale = settings?.locale ?? DEFAULT_COMPANY_LOCALE;
  const { dateLabel, weekdayLabel } = useMemo(() => formatCompanyDateParts(day, locale), [day, locale]);
  const alignmentClassName = centered ? "items-center text-center" : "items-start text-left";

  return (
    <div className={cn("flex w-full flex-col gap-1", alignmentClassName, className)}>
      <p className={cn("min-w-0 text-foreground", dateClassName)}>{dateLabel}</p>
      {weekdayLabel ? (
        <p className={cn("min-w-0 text-muted-foreground", weekdayClassName)}>{weekdayLabel}</p>
      ) : null}
    </div>
  );
}
