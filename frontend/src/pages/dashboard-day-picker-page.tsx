import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PublicHolidayRecord } from "@shared/types/models";
import { enumerateLocalDays, formatLocalDay, parseLocalDay } from "@shared/utils/time";
import { FormPage, FormPanel } from "@/components/form-layout";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { Calendar } from "@/components/ui/calendar";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getEntryStateUi } from "@/lib/entry-state-ui";
import { formatCompanyDate } from "@/lib/locale-format";

function parseDayParam(value: string | null) {
  if (!value) return new Date();
  return parseLocalDay(value) ?? new Date();
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function enumerateDays(startDate: string, endDate: string) {
  return enumerateLocalDays(startDate, endDate);
}

export function DashboardDayPickerPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { companyIdentity, companySession } = useAuth();
  const [searchParams] = useSearchParams();
  const [settingsLocale, setSettingsLocale] = useState("en-GB");
  const [settingsCountry, setSettingsCountry] = useState("AT");
  const [holidays, setHolidays] = useState<PublicHolidayRecord[]>([]);
  const [dayStates, setDayStates] = useState<Record<string, "work" | "sick_leave" | "vacation" | "mixed">>({});
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDayParam(searchParams.get("day"))));
  const selectedDate = parseDayParam(searchParams.get("day"));
  const userId = searchParams.get("user") ?? String(companyIdentity?.user.id ?? "");
  const numericUserId = Number(userId);
  const backTo = `/dashboard?user=${userId}&day=${formatLocalDay(selectedDate)}`;
  const entryStateUi = useMemo(() => getEntryStateUi(t), [t]);
  const pageResource = usePageResource<{
    settingsLocale: string;
    settingsCountry: string;
    holidays: PublicHolidayRecord[];
    dayStates: Record<string, "work" | "sick_leave" | "vacation" | "mixed">;
  }>({
    enabled: Boolean(companySession) && !Number.isNaN(numericUserId) && numericUserId > 0,
    deps: [companySession?.token, numericUserId, settingsCountry, visibleMonth.getFullYear(), visibleMonth.getMonth(), t],
    load: async () => {
      if (!companySession || Number.isNaN(numericUserId) || numericUserId <= 0) {
        return {
          settingsLocale: "en-GB",
          settingsCountry: "AT",
          holidays: [],
          dayStates: {},
        };
      }

      const settingsResponse = await api.getSettings(companySession.token);
      const [holidayResponse, entriesResponse] = await Promise.all([
        api.getPublicHolidays(companySession.token, settingsResponse.settings.country, visibleMonth.getFullYear()),
        api.listTimeEntries(companySession.token, {
          from: formatLocalDay(startOfMonth(visibleMonth)),
          to: formatLocalDay(endOfMonth(visibleMonth)),
          targetUserId: numericUserId,
        })
      ]);

      const nextStates: Record<string, "work" | "sick_leave" | "vacation" | "mixed"> = {};
      for (const entry of entriesResponse.entries) {
        const entryDays = enumerateDays(entry.entryDate, entry.endDate ?? entry.entryDate);
        for (const entryDay of entryDays) {
          const currentState = nextStates[entryDay];
          nextStates[entryDay] =
            !currentState || currentState === entry.entryType
              ? entry.entryType
              : "mixed";
        }
      }

      return {
        settingsLocale: settingsResponse.settings.locale,
        settingsCountry: settingsResponse.settings.country,
        holidays: holidayResponse.holidays,
        dayStates: nextStates,
      };
    }
  });
  const selectedHoliday = holidays.find((holiday) => holiday.date === formatLocalDay(selectedDate));
  const selectedDayState = dayStates[formatLocalDay(selectedDate)];

  function handleSelect(date: Date) {
    navigate(`/dashboard?user=${userId}&day=${formatLocalDay(date)}`);
  }

  useEffect(() => {
    if (!pageResource.data) {
      return;
    }

    setSettingsLocale(pageResource.data.settingsLocale);
    setSettingsCountry(pageResource.data.settingsCountry);
    setHolidays(pageResource.data.holidays);
    setDayStates(pageResource.data.dayStates);
  }, [pageResource.data]);

  return (
    <FormPage>
      <PageLoadBoundary
        loading={pageResource.isLoading}
        refreshing={pageResource.isRefreshing}
        overlayLabel={t("common.loading", { defaultValue: "Loading..." })}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
      >
        <PageBackAction to={backTo} label={t("dayPicker.backToOverview")} />
        <PageLabel
          title={t("dayPicker.title")}
          description={
            selectedHoliday
              ? t("dayPicker.holidayDescription", {
                  name: selectedHoliday.localName,
                  date: formatCompanyDate(selectedHoliday.date, settingsLocale),
                })
              : selectedDayState === "work"
                ? t("dayPicker.workDescription")
                : selectedDayState === "sick_leave"
                  ? t("dayPicker.sickLeaveDescription")
                  : selectedDayState === "vacation"
                    ? t("dayPicker.vacationDescription")
                    : selectedDayState === "mixed"
                      ? t("dayPicker.mixedDescription")
                      : t("dayPicker.defaultDescription")
          }
        />
        <FormPanel className="flex flex-col gap-4 overflow-hidden p-5">
          <div className="flex flex-wrap gap-2 text-xs">
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${entryStateUi.work.badgeClassName}`}>
            <span className={`h-2 w-2 rounded-full ${entryStateUi.work.dotClassName}`} />
            <span>{entryStateUi.work.label}</span>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${entryStateUi.vacation.badgeClassName}`}>
            <span className={`h-2 w-2 rounded-full ${entryStateUi.vacation.dotClassName}`} />
            <span>{entryStateUi.vacation.label}</span>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${entryStateUi.sick_leave.badgeClassName}`}>
            <span className={`h-2 w-2 rounded-full ${entryStateUi.sick_leave.dotClassName}`} />
            <span>{entryStateUi.sick_leave.label}</span>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${entryStateUi.holiday.badgeClassName}`}>
            <span className={`h-2 w-2 rounded-full ${entryStateUi.holiday.dotClassName}`} />
            <span>{entryStateUi.holiday.label}</span>
          </div>
        </div>
          <Calendar
            selected={selectedDate}
            onSelect={handleSelect}
            locale={settingsLocale}
            holidayDates={holidays.map((holiday) => holiday.date)}
            dayStates={dayStates}
            onMonthChange={setVisibleMonth}
            className="w-full rounded-xl border border-border bg-background p-4 sm:p-5"
          />
        </FormPanel>
      </PageLoadBoundary>
    </FormPage>
  );
}
