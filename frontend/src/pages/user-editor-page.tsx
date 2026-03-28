import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { diffClockTimeMinutes, getLocalNowSnapshot } from "@shared/utils/time";
import type { CompanyCustomField, CompanySettings, CompanyCustomFieldTarget, TimeEntryType } from "@shared/types/models";
import type { UserContractInput } from "@shared/types/api";
import type { ContractWeekday, UserContractScheduleBlock, UserContractScheduleDay, UserRole } from "@shared/types/models";
import { PencilSimple, Plus, Trash } from "phosphor-react";
import { FormActions, FormFields, FormPage, FormPanel, FormSection, Field, FieldCombobox } from "@/components/form-layout";
import { CustomFieldInput } from "@/components/custom-field-input";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/ui/time-input";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getCustomFieldsForTarget } from "@shared/utils/custom-fields";
import { formatCompanyDateRange } from "@/lib/locale-format";
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
  customFieldValues: Record<string, string | number | boolean>;
  contracts: UserContractInput[];
}

const CONTRACT_WEEKDAYS: ContractWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "17:00";

function buildScheduleBlock(startTime: string, endTime: string): UserContractScheduleBlock {
  const minutes = startTime && endTime ? diffClockTimeMinutes(startTime, endTime) ?? 0 : 0;
  return {
    startTime,
    endTime,
    minutes
  };
}

function buildScheduleDay(weekday: ContractWeekday, blocks: UserContractScheduleBlock[]): UserContractScheduleDay {
  const sortedBlocks = [...blocks].sort((left, right) => left.startTime.localeCompare(right.startTime));
  const minutes = sortedBlocks.reduce((sum, block) => sum + block.minutes, 0);
  return {
    weekday,
    isWorkingDay: sortedBlocks.length > 0,
    blocks: sortedBlocks,
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
    .map((day) => buildScheduleDay(day.weekday, day.blocks));

  return {
    ...contract,
    schedule,
    hoursPerWeek: computeScheduleHoursPerWeek(schedule)
  };
}

function createDefaultSchedule() {
  return CONTRACT_WEEKDAYS.map((weekday) =>
    weekday <= 5
      ? buildScheduleDay(weekday, [buildScheduleBlock(DEFAULT_START_TIME, DEFAULT_END_TIME)])
      : buildScheduleDay(weekday, [])
  );
}

function createEmptyContract(): UserContractInput {
  return normalizeContract({
    hoursPerWeek: 40,
    startDate: "",
    endDate: null,
    paymentPerHour: 0,
    annualVacationDays: 25,
    schedule: createDefaultSchedule()
  });
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
    customFieldValues: {},
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
    if (!contract.schedule.some((day) => day.blocks.length > 0)) throw new Error(t("userEditor.workingDayRequired"));

    for (const day of contract.schedule) {
      if (day.blocks.length === 0) continue;

      let previousEnd = "";
      for (const block of day.blocks) {
        if (!block.startTime || !block.endTime) throw new Error(t("userEditor.dayTimeRequired"));
        if ((diffClockTimeMinutes(block.startTime, block.endTime) ?? 0) <= 0) throw new Error(t("userEditor.dayTimeOrder"));
        if (previousEnd && block.startTime < previousEnd) throw new Error(t("userEditor.dayTimeOverlap"));
        previousEnd = block.endTime;
      }
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
  if (contract.startDate > today) return t("userEditor.scheduled");
  if (contract.endDate === null || contract.endDate >= today) return t("userEditor.ongoing");
  return t("userEditor.ended");
}

function getContractStatusKey(contract: UserContractInput, timeZone: string) {
  const today = getLocalNowSnapshot(new Date(), timeZone).localDay;
  if (!contract.startDate) return "draft";
  if (contract.startDate > today) return "scheduled";
  if (contract.endDate === null || contract.endDate >= today) return "ongoing";
  return "ended";
}

function formatHours(hours: number) {
  return hours.toFixed(2).replace(/\.00$/, "");
}

function formatBlockRange(block: UserContractScheduleBlock) {
  return `${block.startTime} - ${block.endTime}`;
}

function createBlankBlock(): UserContractScheduleBlock {
  return buildScheduleBlock("", "");
}

function createSuggestedBlocks(contract: UserContractInput, weekday: ContractWeekday) {
  const activeBlock = contract.schedule
    .filter((day) => day.weekday !== weekday)
    .flatMap((day) => day.blocks)
    .find((block) => block.startTime && block.endTime);

  return activeBlock ? [buildScheduleBlock(activeBlock.startTime, activeBlock.endTime)] : [buildScheduleBlock(DEFAULT_START_TIME, DEFAULT_END_TIME)];
}

function CompactTimeInput({
  value,
  onChange
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <TimeInput
      value={value}
      showHelperButton={false}
      className="w-full"
      onChange={onChange}
    />
  );
}

function ContractSummaryCard({
  contract,
  index,
  settingsLocale,
  settingsTimeZone,
  onEdit,
  onRemove,
  t
}: {
  contract: UserContractInput;
  index: number;
  settingsLocale: string;
  settingsTimeZone: string;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  t: (key: string, options?: Record<string, string | number>) => string;
}) {
  const statusKey = getContractStatusKey(contract, settingsTimeZone);
  const periodLabel = contract.startDate
    ? formatCompanyDateRange(contract.startDate, contract.endDate, settingsLocale)
    : t("userEditor.noStartDate");
  const statusLabel = getContractStatus(contract, t, settingsTimeZone);

  return (
    <div className="flex flex-col gap-2 border border-border bg-background px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{t("userEditor.contract", { index: index + 1 })}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(index)} type="button" aria-label={t("userEditor.editContract")}>
            <PencilSimple size={16} />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRemove(index)} type="button" aria-label={t("userEditor.remove")}>
            <Trash size={16} />
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap gap-1.5">
        <Badge
          variant="outline"
          title={statusLabel}
          className={`max-w-[6.5rem] shrink-0 overflow-hidden rounded-none px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
            statusKey === "ongoing"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
              : statusKey === "scheduled"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                : statusKey === "draft"
                  ? "border-sky-500/30 bg-sky-500/10 text-sky-700"
                  : "border-border bg-muted/40 text-muted-foreground"
          }`}
        >
          <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{statusLabel}</span>
        </Badge>
        <Badge
          variant="outline"
          title={periodLabel}
          className="max-w-[10rem] min-w-0 flex-1 shrink-0 overflow-hidden rounded-none border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap"
        >
          <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{periodLabel}</span>
        </Badge>
        <Badge
          variant="outline"
          title={t("userEditor.hoursPerWeekValue", { value: formatHours(contract.hoursPerWeek) })}
          className="max-w-[5.5rem] shrink-0 overflow-hidden rounded-none border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap"
        >
          <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{t("userEditor.hoursPerWeekValue", { value: formatHours(contract.hoursPerWeek) })}</span>
        </Badge>
      </div>
    </div>
  );
}

function ContractEditorSheet({
  open,
  contract,
  contractIndex,
  title,
  settingsLocale,
  settingsTimeZone,
  weekdayLabels,
  onOpenChange,
  onSetField,
  onToggleDay,
  onAddBlock,
  onRemoveBlock,
  onUpdateBlockTime,
  showSaveButton = false,
  onSave,
  t
}: {
  open: boolean;
  contract: UserContractInput | null;
  contractIndex: number | null;
  title: string;
  settingsLocale: string;
  settingsTimeZone: string;
  weekdayLabels: Record<ContractWeekday, string>;
  onOpenChange: (open: boolean) => void;
  onSetField: (index: number, key: "startDate" | "endDate" | "paymentPerHour" | "annualVacationDays", value: string | number | null) => void;
  onToggleDay: (index: number, weekday: ContractWeekday, checked: boolean) => void;
  onAddBlock: (index: number, weekday: ContractWeekday) => void;
  onRemoveBlock: (index: number, weekday: ContractWeekday, blockIndex: number) => void;
  onUpdateBlockTime: (index: number, weekday: ContractWeekday, blockIndex: number, key: "startTime" | "endTime", value: string) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  t: (key: string, options?: Record<string, string | number>) => string;
}) {
  if (!contract || contractIndex === null) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(96vw,96rem)] max-w-none p-0">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-border px-6 py-5 pr-14">
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{t("userEditor.contractEditorDescription")}</SheetDescription>
            </SheetHeader>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <div className="flex flex-col gap-6">
              <FormSection>
                <div className="flex flex-col gap-4">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{t("userEditor.currentContract")}</p>
                        <p className="text-xs text-muted-foreground">
                          {contract.endDate === null ? t("userEditor.currentContractShort") : t("userEditor.currentContractClosedShort")}
                        </p>
                      </div>
                      <Switch
                        checked={contract.endDate === null}
                        onCheckedChange={(checked) =>
                          onSetField(contractIndex, "endDate", checked ? null : getLocalNowSnapshot(new Date(), settingsTimeZone).localDay)
                        }
                      />
                    </div>
                  </div>
                  <Field label={t("userEditor.hoursPerWeek")}>
                    <Input type="number" value={contract.hoursPerWeek} disabled className="disabled:cursor-default disabled:opacity-100" />
                  </Field>
                  <Field label={t("userEditor.startDate")}>
                    <DateInput value={contract.startDate} locale={settingsLocale} onChange={(value) => onSetField(contractIndex, "startDate", value)} />
                  </Field>
                  {contract.endDate === null ? null : (
                    <Field label={t("userEditor.endDate")}>
                      <DateInput value={contract.endDate ?? ""} locale={settingsLocale} onChange={(value) => onSetField(contractIndex, "endDate", value || null)} />
                    </Field>
                  )}
                  <Field label={t("userEditor.paymentPerHour")}>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="25"
                      value={contract.paymentPerHour}
                      onChange={(event) => onSetField(contractIndex, "paymentPerHour", Number(event.target.value))}
                    />
                  </Field>
                  <Field label={t("userEditor.annualVacationDays")}>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="25"
                      value={contract.annualVacationDays}
                      onChange={(event) => onSetField(contractIndex, "annualVacationDays", Number(event.target.value))}
                    />
                  </Field>
                </div>
              </FormSection>

              <div className="flex flex-col gap-4">
                {contract.schedule.map((day) => (
                  <div key={`${contract.id ?? "new"}-${day.weekday}`} className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{weekdayLabels[day.weekday]}</p>
                        <p className="text-xs text-muted-foreground">
                          {day.blocks.length > 0 ? t("userEditor.dayBlocksValue", { value: day.blocks.length }) : t("userEditor.dayOff")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                          {day.blocks.length > 0 ? t("userEditor.dayHoursShort", { value: formatHours(day.minutes / 60) }) : t("userEditor.offShort")}
                        </span>
                        <Switch checked={day.blocks.length > 0} onCheckedChange={(checked) => onToggleDay(contractIndex, day.weekday, checked)} />
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      {day.blocks.length > 0 ? (
                        day.blocks.map((block, blockIndex) => (
                          <div key={`${contract.id ?? "new"}-${day.weekday}-${blockIndex}`} className="flex flex-col gap-2">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                              <CompactTimeInput
                                value={block.startTime}
                                onChange={(value) => onUpdateBlockTime(contractIndex, day.weekday, blockIndex, "startTime", value)}
                              />
                              <CompactTimeInput
                                value={block.endTime}
                                onChange={(value) => onUpdateBlockTime(contractIndex, day.weekday, blockIndex, "endTime", value)}
                              />
                              <Button
                                variant="ghost"
                                type="button"
                                className="h-11 w-full shrink-0 px-3 sm:w-11"
                                onClick={() => onRemoveBlock(contractIndex, day.weekday, blockIndex)}
                                aria-label={t("userEditor.removeBlock")}
                              >
                                <Trash size={16} />
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : null}

                      {day.blocks.length > 0 ? (
                        <Button
                          variant="outline"
                          type="button"
                          className="h-10 justify-start gap-2"
                          onClick={() => onAddBlock(contractIndex, day.weekday)}
                        >
                          <Plus size={14} />
                          {t("userEditor.addBlock")}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          type="button"
                          className="h-10 justify-start gap-2"
                          onClick={() => onToggleDay(contractIndex, day.weekday, true)}
                        >
                          <Plus size={14} />
                          {t("userEditor.addWorkingBlock")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-border px-6 py-4">
            <SheetFooter>
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  {t("common.cancel")}
                </Button>
              </SheetClose>
              {showSaveButton && onSave ? (
                <Button type="button" onClick={onSave}>
                  {t("userEditor.save")}
                </Button>
              ) : null}
            </SheetFooter>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function UserContractsSection({
  contracts,
  settingsLocale,
  settingsTimeZone,
  weekdayLabels,
  onAdd,
  onEdit,
  onRemove,
  t
}: {
  contracts: UserContractInput[];
  settingsLocale: string;
  settingsTimeZone: string;
  weekdayLabels: Record<ContractWeekday, string>;
  onAdd: () => void;
  onEdit: (index: number) => void;
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
          <ContractSummaryCard
            key={`${contract.id ?? "new"}-${index}`}
            contract={contract}
            index={index}
            settingsLocale={settingsLocale}
            settingsTimeZone={settingsTimeZone}
            onEdit={onEdit}
            onRemove={onRemove}
            t={t}
          />
        ))}
      </div>
    </FormSection>
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

export function UserEditorPage({ mode }: UserEditorPageProps) {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { companySession, companyIdentity } = useAuth();
  const [settingsLocale, setSettingsLocale] = useState("en-GB");
  const [settingsTimeZone, setSettingsTimeZone] = useState("Europe/Vienna");
  const [settingsCustomFields, setSettingsCustomFields] = useState<CompanyCustomField[]>([]);
  const [form, setForm] = useState<UserFormState>(createEmptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmContractDeleteIndex, setConfirmContractDeleteIndex] = useState<number | null>(null);
  const [contractEditorMode, setContractEditorMode] = useState<"create" | "edit" | null>(null);
  const [contractEditorOpen, setContractEditorOpen] = useState(false);
  const [selectedContractIndex, setSelectedContractIndex] = useState<number | null>(null);
  const [contractDraft, setContractDraft] = useState<UserContractInput | null>(null);
  const contractEditorCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contractEditorOpenedOnceRef = useRef(false);
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
    settingsCustomFields: CompanyCustomField[];
    form: UserFormState;
  }>({
    enabled: Boolean(companySession) && (mode === "create" || Boolean(userId)),
    deps: [companySession?.token, mode, t, userId],
    load: async () => {
      if (!companySession) {
        return {
          settingsLocale: "en-GB",
          settingsTimeZone: "Europe/Vienna",
          settingsCustomFields: [],
          form: createEmptyForm()
        };
      }

      try {
        const settingsResponse = await api.getSettings(companySession.token);
        if (mode !== "edit" || !userId) {
          return {
            settingsLocale: settingsResponse.settings.locale,
            settingsTimeZone: settingsResponse.settings.timeZone,
            settingsCustomFields: settingsResponse.settings.customFields,
            form: createEmptyForm()
          };
        }

        const userResponse = await api.getUser(companySession.token, Number(userId));
        return {
          settingsLocale: settingsResponse.settings.locale,
          settingsTimeZone: settingsResponse.settings.timeZone,
          settingsCustomFields: settingsResponse.settings.customFields,
          form: {
            fullName: userResponse.user.fullName,
            username: userResponse.user.username,
            password: "",
            role: userResponse.user.role,
            isActive: userResponse.user.isActive,
            pinCode: userResponse.user.pinCode,
            email: userResponse.user.email ?? "",
            customFieldValues: userResponse.user.customFieldValues ?? {},
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
    setSettingsCustomFields(pageResource.data.settingsCustomFields);
    setForm(pageResource.data.form);
  }, [pageResource.data]);

  useEffect(() => {
    if (contractEditorCleanupRef.current) {
      clearTimeout(contractEditorCleanupRef.current);
      contractEditorCleanupRef.current = null;
    }

    if (contractEditorOpen) {
      contractEditorOpenedOnceRef.current = true;
      return;
    }

    if (!contractEditorOpenedOnceRef.current) {
      return;
    }

    contractEditorCleanupRef.current = setTimeout(() => {
      setContractEditorMode(null);
      setSelectedContractIndex(null);
      setContractDraft(null);
      contractEditorCleanupRef.current = null;
    }, 220);

    return () => {
      if (contractEditorCleanupRef.current) {
        clearTimeout(contractEditorCleanupRef.current);
        contractEditorCleanupRef.current = null;
      }
    };
  }, [contractEditorOpen]);

  const userCustomFields = useMemo(
    () => getCustomFieldsForTarget(settingsCustomFields, { scope: "user" }),
    [settingsCustomFields],
  );

  function setField<K extends keyof UserFormState>(key: K, value: UserFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setCustomFieldValue(fieldId: string, nextValue: string | number | boolean | undefined) {
    setForm((current) => ({
      ...current,
      customFieldValues: {
        ...current.customFieldValues,
        [fieldId]: nextValue ?? "",
      },
    }));
  }

  function updateContract(index: number, updater: (contract: UserContractInput) => UserContractInput) {
    setForm((current) => ({
      ...current,
      contracts: current.contracts.map((contract, contractIndex) => (contractIndex === index ? normalizeContract(updater(contract)) : contract))
    }));
  }

  function updateContractDraft(updater: (contract: UserContractInput) => UserContractInput) {
    setContractDraft((current) => (current ? normalizeContract(updater(current)) : current));
  }

  function setContractField(index: number, key: "startDate" | "endDate" | "paymentPerHour" | "annualVacationDays", value: string | number | null) {
    updateContract(index, (contract) => ({ ...contract, [key]: value }));
  }

  function getSuggestedBlocks(contract: UserContractInput, weekday: ContractWeekday) {
    return createSuggestedBlocks(contract, weekday);
  }

  function toggleContractDay(index: number, weekday: ContractWeekday, checked: boolean) {
    updateContract(index, (contract) => {
      const suggestion = getSuggestedBlocks(contract, weekday);
      return {
        ...contract,
        schedule: contract.schedule.map((day) =>
          day.weekday !== weekday
            ? day
            : buildScheduleDay(weekday, checked ? suggestion : [])
        )
      };
    });
  }

  function addContractBlock(index: number, weekday: ContractWeekday) {
    updateContract(index, (contract) => ({
      ...contract,
      schedule: contract.schedule.map((day) =>
        day.weekday === weekday
          ? buildScheduleDay(weekday, [...day.blocks, createBlankBlock()])
          : day
      )
    }));
  }

  function removeContractBlock(index: number, weekday: ContractWeekday, blockIndex: number) {
    updateContract(index, (contract) => ({
      ...contract,
      schedule: contract.schedule.map((day) =>
        day.weekday === weekday
          ? buildScheduleDay(weekday, day.blocks.filter((_, currentIndex) => currentIndex !== blockIndex))
          : day
      )
    }));
  }

  function updateContractBlockTime(index: number, weekday: ContractWeekday, blockIndex: number, key: "startTime" | "endTime", value: string) {
    updateContract(index, (contract) => ({
      ...contract,
      schedule: contract.schedule.map((day) => {
        if (day.weekday !== weekday) {
          return day;
        }
        const nextBlocks = day.blocks.map((block, currentIndex) =>
          currentIndex === blockIndex
            ? buildScheduleBlock(key === "startTime" ? value : block.startTime, key === "endTime" ? value : block.endTime)
            : block
        );
        return buildScheduleDay(weekday, nextBlocks);
      })
    }));
  }

  function setDraftContractField(key: "startDate" | "endDate" | "paymentPerHour" | "annualVacationDays", value: string | number | null) {
    updateContractDraft((contract) => ({ ...contract, [key]: value }));
  }

  function toggleDraftContractDay(weekday: ContractWeekday, checked: boolean) {
    updateContractDraft((contract) => {
      const suggestion = getSuggestedBlocks(contract, weekday);
      return {
        ...contract,
        schedule: contract.schedule.map((day) =>
          day.weekday !== weekday
            ? day
            : buildScheduleDay(weekday, checked ? suggestion : [])
        )
      };
    });
  }

  function addDraftContractBlock(weekday: ContractWeekday) {
    updateContractDraft((contract) => ({
      ...contract,
      schedule: contract.schedule.map((day) =>
        day.weekday === weekday
          ? buildScheduleDay(weekday, [...day.blocks, createBlankBlock()])
          : day
      )
    }));
  }

  function removeDraftContractBlock(weekday: ContractWeekday, blockIndex: number) {
    updateContractDraft((contract) => ({
      ...contract,
      schedule: contract.schedule.map((day) =>
        day.weekday === weekday
          ? buildScheduleDay(weekday, day.blocks.filter((_, currentIndex) => currentIndex !== blockIndex))
          : day
      )
    }));
  }

  function updateDraftContractBlockTime(weekday: ContractWeekday, blockIndex: number, key: "startTime" | "endTime", value: string) {
    updateContractDraft((contract) => ({
      ...contract,
      schedule: contract.schedule.map((day) => {
        if (day.weekday !== weekday) {
          return day;
        }
        const nextBlocks = day.blocks.map((block, currentIndex) =>
          currentIndex === blockIndex
            ? buildScheduleBlock(key === "startTime" ? value : block.startTime, key === "endTime" ? value : block.endTime)
            : block
        );
        return buildScheduleDay(weekday, nextBlocks);
      })
    }));
  }

  function addContract() {
    if (form.contracts.length >= 100) {
      toast({ title: t("userEditor.contractLimitReached"), description: t("userEditor.contractLimitDescription") });
      return;
    }
    setSelectedContractIndex(null);
    setContractEditorMode("create");
    setContractDraft(createEmptyContract());
    setContractEditorOpen(true);
  }

  function removeContract(index: number) {
    setForm((current) => ({
      ...current,
      contracts: current.contracts.filter((_, contractIndex) => contractIndex !== index)
    }));
    if (selectedContractIndex === index) {
      setSelectedContractIndex(null);
      setContractEditorOpen(false);
    } else if (selectedContractIndex !== null && selectedContractIndex > index) {
      setSelectedContractIndex(selectedContractIndex - 1);
    }
  }

  function requestRemoveContract(index: number) {
    setConfirmContractDeleteIndex(index);
  }

  function openContractEditor(index: number) {
    const contract = form.contracts[index];
    if (!contract) {
      return;
    }
    setContractEditorMode("edit");
    setSelectedContractIndex(index);
    setContractDraft(normalizeContract({
      ...contract,
      schedule: contract.schedule.map((day) => ({
        ...day,
        blocks: day.blocks.map((block) => ({ ...block }))
      }))
    }));
    setContractEditorOpen(true);
  }

  function saveDraftContract() {
    if (!contractDraft) {
      return;
    }

    try {
      const normalizedDraft = normalizeContract(contractDraft);
      if (contractEditorMode === "create") {
        validateContracts([...form.contracts, normalizedDraft], t, settingsTimeZone);
        setForm((current) => ({ ...current, contracts: [...current.contracts, normalizedDraft] }));
        setContractEditorOpen(false);
      } else if (selectedContractIndex !== null) {
        const nextContracts = form.contracts.map((contract, index) => (index === selectedContractIndex ? normalizedDraft : contract));
        validateContracts(nextContracts, t, settingsTimeZone);
        setForm((current) => ({
          ...current,
          contracts: current.contracts.map((contract, index) => (index === selectedContractIndex ? normalizedDraft : contract))
        }));
        setContractEditorOpen(false);
      }
    } catch (error) {
      toast({
        title: t("userEditor.saveFailed"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  const draftContract = contractDraft;

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
        customFieldValues: form.customFieldValues,
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

            {userCustomFields.length > 0 ? (
              <FormSection>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">{t("userEditor.customFields")}</p>
                  <p className="text-xs text-muted-foreground">{t("userEditor.customFieldsDescription")}</p>
                </div>
                <FormFields className="flex flex-col gap-4">
                  {userCustomFields.map((field) => (
                    <Field key={field.id} label={field.label}>
                      <CustomFieldInput
                        field={field}
                        value={form.customFieldValues[field.id]}
                        locale={settingsLocale}
                        onValueChange={(value) => setCustomFieldValue(field.id, value)}
                        booleanLabels={{ yes: t("recordEditor.yes"), no: t("recordEditor.no") }}
                      />
                    </Field>
                  ))}
                </FormFields>
              </FormSection>
            ) : null}

            <UserContractsSection
              contracts={form.contracts}
              settingsLocale={settingsLocale}
              settingsTimeZone={settingsTimeZone}
              weekdayLabels={weekdayLabels}
              onAdd={addContract}
              onEdit={openContractEditor}
              onRemove={requestRemoveContract}
              t={t}
            />

            <ContractEditorSheet
              open={contractEditorOpen}
              contract={draftContract}
              contractIndex={selectedContractIndex ?? 0}
              title={contractEditorMode === "create" ? t("userEditor.addContract") : t("userEditor.editContract")}
              settingsLocale={settingsLocale}
              settingsTimeZone={settingsTimeZone}
              weekdayLabels={weekdayLabels}
              onOpenChange={(open) => {
                setContractEditorOpen(open);
              }}
              onSetField={(_index, key, value) => setDraftContractField(key, value)}
              onToggleDay={(_index, weekday, checked) => toggleDraftContractDay(weekday, checked)}
              onAddBlock={(_index, weekday) => addDraftContractBlock(weekday)}
              onRemoveBlock={(_index, weekday, blockIndex) => removeDraftContractBlock(weekday, blockIndex)}
              onUpdateBlockTime={(_index, weekday, blockIndex, key, value) => updateDraftContractBlockTime(weekday, blockIndex, key, value)}
              showSaveButton
              onSave={saveDraftContract}
              t={t}
            />

            <FormActions>
              {mode === "edit" ? (
                <Button
                  variant="ghost"
                  disabled={deleting || companyIdentity?.user.id === Number(userId)}
                  onClick={() => setConfirmDeleteOpen(true)}
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
      <AppConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setConfirmDeleteOpen(false);
          }
        }}
        title={t("userEditor.deleteConfirmTitle")}
        description={t("userEditor.deleteConfirm", { name: form.fullName })}
        confirmLabel={t("userEditor.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        confirming={deleting}
        onConfirm={() => void handleDelete()}
      />
      <AppConfirmDialog
        open={confirmContractDeleteIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmContractDeleteIndex(null);
          }
        }}
        title={t("userEditor.deleteContractTitle")}
        description={
          confirmContractDeleteIndex !== null
            ? t("userEditor.deleteContractConfirm", { index: confirmContractDeleteIndex + 1 })
            : undefined
        }
        confirmLabel={t("userEditor.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (confirmContractDeleteIndex === null) return;
          removeContract(confirmContractDeleteIndex);
          setConfirmContractDeleteIndex(null);
        }}
      />
    </FormPage>
  );
}
