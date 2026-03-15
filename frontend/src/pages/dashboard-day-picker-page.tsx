import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { PublicHolidayRecord } from "@shared/types/models";
import { FormPage, FormPanel } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { Calendar } from "@/components/ui/calendar";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { entryStateUi } from "@/lib/entry-state-ui";

function formatDayParam(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDayParam(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date();
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function enumerateDays(startDate: string, endDate: string) {
  const days: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const finalDate = new Date(`${endDate}T00:00:00`);
  while (cursor.getTime() <= finalDate.getTime()) {
    days.push(formatDayParam(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function DashboardDayPickerPage() {
  const navigate = useNavigate();
  const { companyIdentity, companySession } = useAuth();
  const [searchParams] = useSearchParams();
  const [settingsCountry, setSettingsCountry] = useState("AT");
  const [holidays, setHolidays] = useState<PublicHolidayRecord[]>([]);
  const [dayStates, setDayStates] = useState<Record<string, "work" | "sick_leave" | "vacation" | "mixed">>({});
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDayParam(searchParams.get("day"))));
  const selectedDate = parseDayParam(searchParams.get("day"));
  const userId = searchParams.get("user") ?? String(companyIdentity?.user.id ?? "");
  const numericUserId = Number(userId);
  const backTo = `/dashboard?user=${userId}&day=${formatDayParam(selectedDate)}`;
  const selectedHoliday = holidays.find((holiday) => holiday.date === formatDayParam(selectedDate));
  const selectedDayState = dayStates[formatDayParam(selectedDate)];

  function handleSelect(date: Date) {
    navigate(`/dashboard?user=${userId}&day=${formatDayParam(date)}`);
  }

  useEffect(() => {
    if (!companySession) return;
    void api.getSettings(companySession.token).then((response) => setSettingsCountry(response.settings.country)).catch(() => undefined);
  }, [companySession]);

  useEffect(() => {
    if (!companySession) return;
    void api
      .getPublicHolidays(companySession.token, settingsCountry, visibleMonth.getFullYear())
      .then((response) => setHolidays(response.holidays))
      .catch(() => setHolidays([]));
  }, [companySession, settingsCountry, visibleMonth]);

  useEffect(() => {
    if (!companySession || Number.isNaN(numericUserId) || numericUserId <= 0) return;
    void api
      .listTimeEntries(companySession.token, {
        from: startOfMonth(visibleMonth).toISOString(),
        to: endOfMonth(visibleMonth).toISOString(),
        targetUserId: numericUserId,
      })
      .then((response) => {
        const nextStates: Record<string, "work" | "sick_leave" | "vacation" | "mixed"> = {};
        for (const entry of response.entries) {
          const entryDays = enumerateDays(entry.entryDate, entry.endDate ?? entry.entryDate);
          for (const entryDay of entryDays) {
            const currentState = nextStates[entryDay];
            nextStates[entryDay] =
              !currentState || currentState === entry.entryType
                ? entry.entryType
                : "mixed";
          }
        }
        setDayStates(nextStates);
      })
      .catch(() => setDayStates({}));
  }, [companySession, numericUserId, visibleMonth]);

  return (
    <FormPage>
      <PageBackAction to={backTo} label="Back to overview" />
      <PageLabel
        title="Select day"
        description={
          selectedHoliday
            ? `${selectedHoliday.localName}. Records are blocked on this public holiday.`
            : selectedDayState === "work"
              ? "This day has working time entries."
              : selectedDayState === "sick_leave"
                ? "This day is marked as sick leave."
                : selectedDayState === "vacation"
                  ? "This day is covered by vacation."
                  : selectedDayState === "mixed"
                    ? "This day contains multiple entry types."
                    : "Choose the day you want to manage in overview."
        }
      />
      <FormPanel className="flex flex-col gap-4 overflow-hidden p-5">
        <div className="flex flex-wrap gap-2 text-sm">
          <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${entryStateUi.work.badgeClassName}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${entryStateUi.work.dotClassName}`} />
            <span>{entryStateUi.work.label}</span>
          </div>
          <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${entryStateUi.vacation.badgeClassName}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${entryStateUi.vacation.dotClassName}`} />
            <span>{entryStateUi.vacation.label}</span>
          </div>
          <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${entryStateUi.sick_leave.badgeClassName}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${entryStateUi.sick_leave.dotClassName}`} />
            <span>{entryStateUi.sick_leave.label}</span>
          </div>
          <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${entryStateUi.holiday.badgeClassName}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${entryStateUi.holiday.dotClassName}`} />
            <span>{entryStateUi.holiday.label}</span>
          </div>
        </div>
        <Calendar
          selected={selectedDate}
          onSelect={handleSelect}
          holidayDates={holidays.map((holiday) => holiday.date)}
          dayStates={dayStates}
          onMonthChange={setVisibleMonth}
          className="w-full rounded-xl border border-border bg-background p-4 sm:p-5"
        />
      </FormPanel>
    </FormPage>
  );
}
