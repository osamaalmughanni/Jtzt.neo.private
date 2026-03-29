import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatLocalDay, parseLocalDay } from "@shared/utils/time";
import { FormPage, FormPanel } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { Calendar } from "@/components/ui/calendar";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCompanySettings } from "@/lib/company-settings";
import { useAppHeaderState } from "@/components/app-header-state";
import { getEntryStateUi } from "@/lib/entry-state-ui";
import { formatCompanyDate } from "@/lib/locale-format";
import { toast } from "@/lib/toast";
import type { DashboardPageSnapshotResponse } from "@shared/types/api";

function parseDayParam(value: string | null) {
  if (!value) return new Date();
  return parseLocalDay(value) ?? new Date();
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function DashboardDayPickerPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { companyIdentity, companySession } = useAuth();
  const { settings: companySettings } = useCompanySettings();
  const { setHomeAction } = useAppHeaderState();
  const [searchParams] = useSearchParams();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDayParam(searchParams.get("day"))));
  const selectedDate = parseDayParam(searchParams.get("day"));
  const selectedDayKey = formatLocalDay(selectedDate);
  const previousSelectedDayKeyRef = useRef(selectedDayKey);
  const userId = searchParams.get("user") ?? String(companyIdentity?.user.id ?? "");
  const numericUserId = Number(userId);
  const backTo = `/dashboard?user=${userId}&day=${formatLocalDay(selectedDate)}`;
  const entryStateUi = useMemo(() => getEntryStateUi(t), [t]);
  const pageResource = usePageResource<DashboardPageSnapshotResponse>({
    enabled: Boolean(companySession) && !Number.isNaN(numericUserId) && numericUserId > 0,
    deps: [companySession?.token, numericUserId, selectedDayKey, visibleMonth.getFullYear(), visibleMonth.getMonth(), t],
    minPendingMs: 0,
    load: async () => {
      if (!companySession || Number.isNaN(numericUserId) || numericUserId <= 0) {
        return {
          summary: {
            todayMinutes: 0,
            weekMinutes: 0,
            activeEntry: null,
            recentEntries: [],
            contractStats: {
              currentContract: null,
              totalBalanceMinutes: 0,
              week: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
              month: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
              year: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
              vacation: { entitledDays: 0, usedDays: 0, availableDays: 0 },
              timeOffInLieu: { earnedMinutes: 0, bookedMinutes: 0, availableMinutes: 0 },
            },
          },
          entries: [],
          calendar: {
            month: formatLocalDay(startOfMonth(selectedDate)),
            holidays: [],
            dayStates: {},
          },
        };
      }

      return api.getDashboardPageSnapshot(companySession.token, {
        targetUserId: numericUserId,
        targetDay: selectedDayKey,
        targetMonth: formatLocalDay(startOfMonth(visibleMonth)),
      });
    }
  });
  const pageErrorRef = useRef<unknown>(null);
  const pageSnapshot =
    pageResource.data ?? {
      summary: {
        todayMinutes: 0,
        weekMinutes: 0,
        activeEntry: null,
        recentEntries: [],
        contractStats: {
          currentContract: null,
          totalBalanceMinutes: 0,
          week: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
          month: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
          year: { expectedMinutes: 0, recordedMinutes: 0, balanceMinutes: 0 },
          vacation: { entitledDays: 0, usedDays: 0, availableDays: 0 },
          timeOffInLieu: { earnedMinutes: 0, bookedMinutes: 0, availableMinutes: 0 },
        },
      },
      entries: [],
      calendar: {
        month: formatLocalDay(startOfMonth(selectedDate)),
        holidays: [],
        dayStates: {},
      },
    };
  const selectedHoliday = pageSnapshot.calendar.holidays.find((holiday) => holiday.date === selectedDayKey);
  const selectedDayState = pageSnapshot.calendar.dayStates[selectedDayKey];

  function handleSelect(date: Date) {
    navigate(`/dashboard?user=${userId}&day=${formatLocalDay(date)}`);
  }

  useEffect(() => {
    if (previousSelectedDayKeyRef.current !== selectedDayKey) {
      previousSelectedDayKeyRef.current = selectedDayKey;
      setVisibleMonth(startOfMonth(selectedDate));
    }
  }, [selectedDate, selectedDayKey]);

  useEffect(() => {
    if (!pageResource.error || pageErrorRef.current === pageResource.error) {
      return;
    }

    pageErrorRef.current = pageResource.error;
    toast({
      title: t("dayPicker.title"),
      description: pageResource.error instanceof Error ? pageResource.error.message : "Request failed",
    });
  }, [pageResource.error, t]);

  useEffect(() => {
    setHomeAction({
      key: "calendar-home-back",
      label: t("dayPicker.backToOverview"),
      onClick: () => navigate(backTo),
    });
    return () => setHomeAction(null);
  }, [backTo, navigate, setHomeAction, t]);

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <>
            <PageBackAction to={backTo} label={t("dayPicker.backToOverview")} />
            <PageIntro>
              <PageLabel
                title={t("dayPicker.title")}
                description={
                  selectedHoliday
                    ? t("dayPicker.holidayDescription", {
                        name: selectedHoliday.localName,
                        date: formatCompanyDate(selectedHoliday.date, companySettings?.locale ?? "en-GB"),
                      })
                    : selectedDayState === "work"
                      ? t("dayPicker.workDescription")
                      : selectedDayState === "sick_leave"
                        ? t("dayPicker.sickLeaveDescription")
                        : selectedDayState === "vacation"
                          ? t("dayPicker.vacationDescription")
                          : selectedDayState === "time_off_in_lieu"
                            ? t("dayPicker.timeOffInLieuDescription")
                          : selectedDayState === "mixed"
                            ? t("dayPicker.mixedDescription")
                            : t("dayPicker.defaultDescription")
                }
              />
            </PageIntro>
          </>
        }
        loading={pageResource.isLoading}
        refreshing={pageResource.isRefreshing}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
      >
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
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${entryStateUi.time_off_in_lieu.badgeClassName}`}>
            <span className={`h-2 w-2 rounded-full ${entryStateUi.time_off_in_lieu.dotClassName}`} />
            <span>{entryStateUi.time_off_in_lieu.label}</span>
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
            month={visibleMonth}
            onSelect={handleSelect}
            locale={companySettings?.locale ?? "en-GB"}
            firstDayOfWeek={companySettings?.firstDayOfWeek ?? 1}
            weekendDays={companySettings?.weekendDays ?? [6, 7]}
            holidayDates={pageSnapshot.calendar.holidays.map((holiday) => holiday.date)}
            dayStates={pageSnapshot.calendar.dayStates}
            onMonthChange={setVisibleMonth}
            className="w-full rounded-xl border border-border bg-background p-4 sm:p-5"
          />
        </FormPanel>
      </PageLoadBoundary>
    </FormPage>
  );
}
