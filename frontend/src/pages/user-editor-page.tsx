import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { diffClockTimeMinutes, getLocalNowSnapshot } from "@shared/utils/time";
import type { UserContractInput } from "@shared/types/api";
import type { ContractWeekday, UserContractScheduleDay, UserRole } from "@shared/types/models";
import { Trash } from "phosphor-react";
import { FormActions, FormFields, FormPage, FormPanel, FormSection, Field, FieldCombobox } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePageResource } from "@/hooks/use-page-resource";
import { toast } from "@/lib/toast";

interface UserEditorPageProps {
  mode: "create" | "edit";
}

interface UserFormState {
  fullName: string;
  username: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  pinCode: string;
  email: string;
  contracts: UserContractInput[];
}

const CONTRACT_WEEKDAYS: ContractWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "17:00";

function buildScheduleDay(weekday: ContractWeekday, isWorkingDay: boolean, startTime: string | null, endTime: string | null): UserContractScheduleDay {
  const minutes = isWorkingDay && startTime && endTime ? diffClockTimeMinutes(startTime, endTime) ?? 0 : 0;
  return {
    weekday,
    isWorkingDay,
    startTime: isWorkingDay ? startTime : null,
    endTime: isWorkingDay ? endTime : null,
    minutes
  };
}

function computeScheduleHoursPerWeek(schedule: UserContractScheduleDay[]) {
  const totalMinutes = schedule.reduce((sum, day) => sum + day.minutes, 0);
  return Math.round((totalMinutes / 60) * 100) / 100;
}

function normalizeContract(contract: UserContractInput): UserContractInput {
  const schedule = [...contract.schedule]
    .sort((left, right) => left.weekday - right.weekday)
    .map((day) => buildScheduleDay(day.weekday, day.isWorkingDay, day.startTime, day.endTime));

  return {
    ...contract,
    schedule,
    hoursPerWeek: computeScheduleHoursPerWeek(schedule)
  };
}

function createDefaultSchedule() {
  return CONTRACT_WEEKDAYS.map((weekday) =>
    buildScheduleDay(weekday, weekday <= 5, weekday <= 5 ? DEFAULT_START_TIME : null, weekday <= 5 ? DEFAULT_END_TIME : null)
  );
}

function createEmptyContract(): UserContractInput {
  return normalizeContract({ hoursPerWeek: 40, startDate: "", endDate: null, paymentPerHour: 0, annualVacationDays: 25, schedule: createDefaultSchedule() });
}

function createEmptyForm(): UserFormState {
  return {
    fullName: "",
    username: "",
    password: "",
    role: "employee",
    isActive: true,
    pinCode: "",
    email: "",
    contracts: []
  };
}

function validateContracts(contracts: UserContractInput[], t: (key: string) => string, timeZone: string) {
  if (contracts.length > 100) throw new Error(t("userEditor.contractMax"));
  const sorted = [...contracts].map(normalizeContract).sort((left, right) => left.startDate.localeCompare(right.startDate));
  for (let index = 0; index < sorted.length; index += 1) {
    const contract = sorted[index];
    if (!contract.startDate) throw new Error(t("userEditor.contractStartRequired"));
    if (contract.endDate !== null && contract.startDate > contract.endDate) throw new Error(t("userEditor.contractEndAfterStart"));
    if (!contract.schedule.some((day) => day.isWorkingDay && day.minutes > 0)) throw new Error(t("userEditor.workingDayRequired"));

    for (const day of contract.schedule) {
      if (!day.isWorkingDay) continue;
      if (!day.startTime || !day.endTime) throw new Error(t("userEditor.dayTimeRequired"));
      if ((diffClockTimeMinutes(day.startTime, day.endTime) ?? 0) <= 0) throw new Error(t("userEditor.dayTimeOrder"));
    }

    const previous = sorted[index - 1];
    if (previous && contract.startDate <= (previous.endDate ?? "9999-12-31")) throw new Error(t("userEditor.contractsOverlap"));
  }

  const today = getLocalNowSnapshot(new Date(), timeZone).localDay;
  const hasCurrentContract = sorted.some((contract) => contract.startDate <= today && (contract.endDate === null || contract.endDate >= today));
  if (!hasCurrentContract) throw new Error(t("userEditor.currentContractRequired"));
}

function getContractStatus(contract: UserContractInput, t: (key: string) => string, timeZone: string) {
  const today = getLocalNowSnapshot(new Date(), timeZone).localDay;
  if (!contract.startDate) return t("userEditor.draft");
  if (contract.startDate > today) return t("userEditor.upcoming");
  if (contract.endDate === null || contract.endDate >= today) return t("userEditor.current");
  return t("userEditor.past");
}

function formatHours(hours: number) {
  return hours.toFixed(2).replace(/\.00$/, "");
}

function CompactTimeInput({
  value,
  disabled,
  onChange
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="time"
      value={value}
      disabled={disabled}
      className="h-11 min-w-[7.25rem] text-sm font-medium"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function UserIdentityFields({
  form,
  mode,
  statusOptions,
  roleOptions,
  onFieldChange,
  t
}: {
  form: UserFormState;
  mode: "create" | "edit";
  statusOptions: Array<{ value: string; label: string }>;
  roleOptions: Array<{ value: string; label: string }>;
  onFieldChange: <K extends keyof UserFormState>(key: K, value: UserFormState[K]) => void;
  t: (key: string) => string;
}) {
  return (
    <>
      <FormSection>
        <FormFields className="flex flex-col gap-4">
          <Field label={t("userEditor.name")}>
            <Input placeholder="Jane Doe" value={form.fullName} onChange={(event) => onFieldChange("fullName", event.target.value)} />
          </Field>
          <Field label={t("userEditor.email")}>
            <Input placeholder="jane@company.com" type="email" value={form.email} onChange={(event) => onFieldChange("email", event.target.value)} />
          </Field>
          <Field label={t("userEditor.status")}>
            <FieldCombobox
              label="status"
              value={form.isActive ? "active" : "inactive"}
              onValueChange={(value) => onFieldChange("isActive", value === "active")}
              items={statusOptions}
            />
          </Field>
        </FormFields>
      </FormSection>

      <FormSection>
        <FormFields className="flex flex-col gap-4">
          <Field label={t("userEditor.username")}>
            <Input placeholder="jane" value={form.username} onChange={(event) => onFieldChange("username", event.target.value)} />
          </Field>
          <Field label={t("userEditor.pin")}>
            <Input
              inputMode="numeric"
              maxLength={4}
              placeholder="0000"
              value={form.pinCode}
              onChange={(event) => onFieldChange("pinCode", event.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </Field>
          <Field label={t("userEditor.password")}>
            <Input
              type="password"
              placeholder={mode === "edit" ? t("userEditor.passwordPlaceholderEdit") : t("userEditor.passwordPlaceholderCreate")}
              value={form.password}
              onChange={(event) => onFieldChange("password", event.target.value)}
            />
          </Field>
          <Field label={t("userEditor.role")}>
            <FieldCombobox
              label="role"
              value={form.role}
              onValueChange={(value) => onFieldChange("role", value as UserRole)}
              items={roleOptions}
            />
          </Field>
        </FormFields>
      </FormSection>
    </>
  );
}

function ContractCard({
  contract,
  index,
  settingsLocale,
  settingsTimeZone,
  weekdayLabels,
  onSetField,
  onToggleDay,
  onUpdateDayTime,
  onRemove,
  t
}: {
  contract: UserContractInput;
  index: number;
  settingsLocale: string;
  settingsTimeZone: string;
  weekdayLabels: Record<ContractWeekday, string>;
  onSetField: (index: number, key: "startDate" | "endDate" | "paymentPerHour" | "annualVacationDays", value: string | number | null) => void;
  onToggleDay: (index: number, weekday: ContractWeekday, checked: boolean) => void;
  onUpdateDayTime: (index: number, weekday: ContractWeekday, key: "startTime" | "endTime", value: string) => void;
  onRemove: (index: number) => void;
  t: (key: string, options?: Record<string, string | number>) => string;
}) {
  const isOpenEnded = contract.endDate === null;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium text-foreground">{t("userEditor.contract", { index: index + 1 })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {getContractStatus(contract, t, settingsTimeZone)}
            </span>
            <span className="rounded-full border border-border bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
              {isOpenEnded ? t("userEditor.currentContractShort") : t("userEditor.currentContractClosedShort")}
            </span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700">
              {t("userEditor.hoursPerWeekValue", { value: formatHours(contract.hoursPerWeek) })}
            </span>
            <span className="rounded-full bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-700">
              {t("userEditor.vacationDaysValue", { value: formatHours(contract.annualVacationDays) })}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => onRemove(index)} type="button" aria-label={t("userEditor.remove")}>
          <Trash size={16} />
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <Field label={t("userEditor.currentContract")}>
          <div className="flex h-11 items-center justify-between rounded-md bg-muted/30 px-3">
            <span className="text-sm text-foreground">{isOpenEnded ? t("userEditor.currentContractShort") : t("userEditor.currentContractClosedShort")}</span>
            <Switch
              checked={isOpenEnded}
              onCheckedChange={(checked) =>
                onSetField(index, "endDate", checked ? null : getLocalNowSnapshot(new Date(), settingsTimeZone).localDay)
              }
            />
          </div>
        </Field>
        <Field label={t("userEditor.hoursPerWeek")}>
          <Input type="number" value={contract.hoursPerWeek} disabled className="disabled:cursor-default disabled:opacity-100" />
        </Field>
        <Field label={t("userEditor.startDate")}>
          <DateInput value={contract.startDate} locale={settingsLocale} onChange={(value) => onSetField(index, "startDate", value)} />
        </Field>
        {contract.endDate === null ? null : (
          <Field label={t("userEditor.endDate")}>
            <DateInput value={contract.endDate ?? ""} locale={settingsLocale} onChange={(value) => onSetField(index, "endDate", value || null)} />
          </Field>
        )}
        <Field label={t("userEditor.paymentPerHour")}>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="25"
            value={contract.paymentPerHour}
            onChange={(event) => onSetField(index, "paymentPerHour", Number(event.target.value))}
          />
        </Field>
        <Field label={t("userEditor.annualVacationDays")}>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="25"
            value={contract.annualVacationDays}
            onChange={(event) => onSetField(index, "annualVacationDays", Number(event.target.value))}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/70 pt-4">
        <div className="flex flex-col gap-1">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("userEditor.schedule")}</p>
            <p className="text-xs text-muted-foreground">{t("userEditor.scheduleDescriptionCompact")}</p>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground">{t("userEditor.autoCalculated")}</span>
        </div>

        <div className="flex flex-col gap-2">
          {contract.schedule.map((day) => (
            <div
              key={`${contract.id ?? "new"}-${day.weekday}`}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{weekdayLabels[day.weekday]}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                    {day.isWorkingDay && day.minutes > 0 ? t("userEditor.dayHoursShort", { value: formatHours(day.minutes / 60) }) : t("userEditor.offShort")}
                  </span>
                  <Switch checked={day.isWorkingDay} onCheckedChange={(checked) => onToggleDay(index, day.weekday, checked)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 max-[520px]:grid-cols-1">
                <CompactTimeInput
                  value={day.startTime ?? ""}
                  disabled={!day.isWorkingDay}
                  onChange={(value) => onUpdateDayTime(index, day.weekday, "startTime", value)}
                />
                <CompactTimeInput
                  value={day.endTime ?? ""}
                  disabled={!day.isWorkingDay}
                  onChange={(value) => onUpdateDayTime(index, day.weekday, "endTime", value)}
                />
              </div>
              {day.weekday === 7 ? null : <div className="border-t border-border/60" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UserContractsSection({
  contracts,
  settingsLocale,
  settingsTimeZone,
  weekdayLabels,
  onAdd,
  onSetField,
  onToggleDay,
  onUpdateDayTime,
  onRemove,
  t
}: {
  contracts: UserContractInput[];
  settingsLocale: string;
  settingsTimeZone: string;
  weekdayLabels: Record<ContractWeekday, string>;
  onAdd: () => void;
  onSetField: (index: number, key: "startDate" | "endDate" | "paymentPerHour" | "annualVacationDays", value: string | number | null) => void;
  onToggleDay: (index: number, weekday: ContractWeekday, checked: boolean) => void;
  onUpdateDayTime: (index: number, weekday: ContractWeekday, key: "startTime" | "endTime", value: string) => void;
  onRemove: (index: number) => void;
  t: (key: string, options?: Record<string, string | number>) => string;
}) {
  return (
    <FormSection>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{t("userEditor.contracts")}</p>
          <p className="text-xs text-muted-foreground">{t("userEditor.contractsDescription")}</p>
        </div>
        <Button variant="outline" className="h-8 px-3" onClick={onAdd} type="button">
          {t("userEditor.addContract")}
        </Button>
      </div>

      {contracts.length === 0 ? <p className="text-sm text-muted-foreground">{t("userEditor.noContracts")}</p> : null}

      <div className="flex flex-col gap-3">
        {contracts.map((contract, index) => (
          <ContractCard
            key={`${contract.id ?? "new"}-${index}`}
            contract={contract}
            index={index}
            settingsLocale={settingsLocale}
            settingsTimeZone={settingsTimeZone}
            weekdayLabels={weekdayLabels}
            onSetField={onSetField}
            onToggleDay={onToggleDay}
            onUpdateDayTime={onUpdateDayTime}
            onRemove={onRemove}
            t={t}
          />
        ))}
      </div>
    </FormSection>
  );
}

export function UserEditorPage({ mode }: UserEditorPageProps) {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { companySession, companyIdentity } = useAuth();
  const [settingsLocale, setSettingsLocale] = useState("en-GB");
  const [settingsTimeZone, setSettingsTimeZone] = useState("Europe/Vienna");
  const [form, setForm] = useState<UserFormState>(createEmptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const statusOptions = [
    { value: "active", label: t("userEditor.active") },
    { value: "inactive", label: t("userEditor.inactive") }
  ];
  const roleOptions = [
    { value: "admin", label: t("userEditor.admin") },
    { value: "manager", label: t("userEditor.manager") },
    { value: "employee", label: t("userEditor.employee") }
  ];
  const weekdayLabels = useMemo<Record<ContractWeekday, string>>(
    () => ({
      1: t("settings.monday"),
      2: t("settings.tuesday"),
      3: t("settings.wednesday"),
      4: t("settings.thursday"),
      5: t("settings.friday"),
      6: t("settings.saturday"),
      7: t("settings.sunday")
    }),
    [t]
  );

  const pageResource = usePageResource<{
    settingsLocale: string;
    settingsTimeZone: string;
    form: UserFormState;
  }>({
    enabled: Boolean(companySession) && (mode === "create" || Boolean(userId)),
    deps: [companySession?.token, mode, t, userId],
    load: async () => {
      if (!companySession) {
        return {
          settingsLocale: "en-GB",
          settingsTimeZone: "Europe/Vienna",
          form: createEmptyForm()
        };
      }

      try {
        const settingsResponse = await api.getSettings(companySession.token);
        if (mode !== "edit" || !userId) {
          return {
            settingsLocale: settingsResponse.settings.locale,
            settingsTimeZone: settingsResponse.settings.timeZone,
            form: createEmptyForm()
          };
        }

        const userResponse = await api.getUser(companySession.token, Number(userId));
        return {
          settingsLocale: settingsResponse.settings.locale,
          settingsTimeZone: settingsResponse.settings.timeZone,
          form: {
            fullName: userResponse.user.fullName,
            username: userResponse.user.username,
            password: "",
            role: userResponse.user.role,
            isActive: userResponse.user.isActive,
            pinCode: userResponse.user.pinCode,
            email: userResponse.user.email ?? "",
            contracts: userResponse.user.contracts.map((contract) =>
              normalizeContract({
                id: contract.id,
                hoursPerWeek: contract.hoursPerWeek,
                startDate: contract.startDate,
                endDate: contract.endDate,
                paymentPerHour: contract.paymentPerHour,
                annualVacationDays: contract.annualVacationDays,
                schedule: contract.schedule
              })
            )
          }
        };
      } catch (error) {
        toast({
          title: t("userEditor.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed"
        });
        throw error;
      }
    }
  });

  useEffect(() => {
    if (!pageResource.data) return;
    setSettingsLocale(pageResource.data.settingsLocale);
    setSettingsTimeZone(pageResource.data.settingsTimeZone);
    setForm(pageResource.data.form);
  }, [pageResource.data]);

  function setField<K extends keyof UserFormState>(key: K, value: UserFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateContract(index: number, updater: (contract: UserContractInput) => UserContractInput) {
    setForm((current) => ({
      ...current,
      contracts: current.contracts.map((contract, contractIndex) => (contractIndex === index ? normalizeContract(updater(contract)) : contract))
    }));
  }

  function setContractField(index: number, key: "startDate" | "endDate" | "paymentPerHour" | "annualVacationDays", value: string | number | null) {
    updateContract(index, (contract) => ({ ...contract, [key]: value }));
  }

  function setContractScheduleDay(index: number, weekday: ContractWeekday, updater: (day: UserContractScheduleDay) => UserContractScheduleDay) {
    updateContract(index, (contract) => ({
      ...contract,
      schedule: contract.schedule.map((day) => (day.weekday === weekday ? updater(day) : day))
    }));
  }

  function getSuggestedDayTiming(contract: UserContractInput, weekday: ContractWeekday) {
    const activeDay = contract.schedule.find((day) => day.weekday !== weekday && day.isWorkingDay && day.startTime && day.endTime);
    return {
      startTime: activeDay?.startTime ?? DEFAULT_START_TIME,
      endTime: activeDay?.endTime ?? DEFAULT_END_TIME
    };
  }

  function toggleContractDay(index: number, weekday: ContractWeekday, checked: boolean) {
    updateContract(index, (contract) => {
      const suggestion = getSuggestedDayTiming(contract, weekday);
      return {
        ...contract,
        schedule: contract.schedule.map((day) =>
          day.weekday !== weekday
            ? day
            : buildScheduleDay(weekday, checked, checked ? suggestion.startTime : null, checked ? suggestion.endTime : null)
        )
      };
    });
  }

  function updateContractDayTime(index: number, weekday: ContractWeekday, key: "startTime" | "endTime", value: string) {
    setContractScheduleDay(index, weekday, (day) =>
      buildScheduleDay(day.weekday, day.isWorkingDay, key === "startTime" ? value : day.startTime, key === "endTime" ? value : day.endTime)
    );
  }

  function addContract() {
    if (form.contracts.length >= 100) {
      toast({ title: t("userEditor.contractLimitReached"), description: t("userEditor.contractLimitDescription") });
      return;
    }
    setForm((current) => ({ ...current, contracts: [...current.contracts, createEmptyContract()] }));
  }

  function removeContract(index: number) {
    setForm((current) => ({
      ...current,
      contracts: current.contracts.filter((_, contractIndex) => contractIndex !== index)
    }));
  }

  async function handleSave() {
    if (!companySession) return;

    try {
      if (form.fullName.trim().length < 2) throw new Error(t("userEditor.fullNameRequired"));
      if (form.username.trim().length < 2) throw new Error(t("userEditor.usernameRequired"));
      if (mode === "create" && form.password.trim().length < 6) throw new Error(t("userEditor.passwordLength"));
      if (form.password.trim().length > 0 && form.password.trim().length < 6) throw new Error(t("userEditor.passwordLength"));
      if (!/^\d{4}$/.test(form.pinCode.trim())) throw new Error(t("userEditor.pinInvalid"));
      if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) throw new Error(t("userEditor.emailInvalid"));
      validateContracts(form.contracts, t, settingsTimeZone);

      setSaving(true);
      const payload = {
        fullName: form.fullName.trim(),
        username: form.username.trim(),
        password: form.password.trim(),
        role: form.role,
        isActive: form.isActive,
        pinCode: form.pinCode.trim(),
        email: form.email.trim() || null,
        contracts: form.contracts.map((contract) => {
          const normalized = normalizeContract(contract);
          return {
            id: normalized.id,
            hoursPerWeek: normalized.hoursPerWeek,
            startDate: normalized.startDate,
            endDate: normalized.endDate,
            paymentPerHour: Number(normalized.paymentPerHour),
            annualVacationDays: Number(normalized.annualVacationDays),
            schedule: normalized.schedule
          };
        })
      };

      if (mode === "create") {
        const response = await api.createUser(companySession.token, payload);
        toast({ title: t("userEditor.created") });
        navigate(`/users/${response.userId}/edit`);
      } else {
        await api.updateUser(companySession.token, { userId: Number(userId), ...payload, password: payload.password || undefined });
        toast({ title: t("userEditor.saved") });
      }
    } catch (error) {
      toast({
        title: t("userEditor.saveFailed"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!companySession || mode !== "edit" || !userId) return;
    if (!window.confirm(t("userEditor.deleteConfirm", { name: form.fullName }))) return;

    try {
      setDeleting(true);
      await api.deleteUser(companySession.token, { userId: Number(userId) });
      toast({ title: t("userEditor.deleted") });
      navigate("/users");
    } catch (error) {
      toast({
        title: t("userEditor.deleteFailed"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <>
            <PageBackAction to="/users" label={t("userEditor.back")} />
            <PageIntro>
              <PageLabel
                title={mode === "create" ? t("userEditor.createTitle") : t("userEditor.editTitle")}
                description={mode === "create" ? t("userEditor.createDescription") : t("userEditor.editDescription")}
              />
            </PageIntro>
          </>
        }
        loading={pageResource.isLoading}
        refreshing={pageResource.isRefreshing}
        skeleton={<PageLoadingState label={t("userEditor.loading")} />}
      >
        <FormPanel className="flex flex-col gap-5">
          <>
            <UserIdentityFields
              form={form}
              mode={mode}
              statusOptions={statusOptions}
              roleOptions={roleOptions}
              onFieldChange={setField}
              t={t}
            />

            <UserContractsSection
              contracts={form.contracts}
              settingsLocale={settingsLocale}
              settingsTimeZone={settingsTimeZone}
              weekdayLabels={weekdayLabels}
              onAdd={addContract}
              onSetField={setContractField}
              onToggleDay={toggleContractDay}
              onUpdateDayTime={updateContractDayTime}
              onRemove={removeContract}
              t={t}
            />

            <FormActions>
              {mode === "edit" ? (
                <Button
                  variant="ghost"
                  disabled={deleting || companyIdentity?.user.id === Number(userId)}
                  onClick={() => void handleDelete()}
                  type="button"
                >
                  {companyIdentity?.user.id === Number(userId) ? t("userEditor.activeUser") : deleting ? t("userEditor.deleting") : t("userEditor.delete")}
                </Button>
              ) : null}
              <Button disabled={saving || pageResource.isLoading} onClick={() => void handleSave()} type="button">
                {saving ? t("userEditor.saving") : t("userEditor.save")}
              </Button>
            </FormActions>
          </>
        </FormPanel>
      </PageLoadBoundary>
    </FormPage>
  );
}
