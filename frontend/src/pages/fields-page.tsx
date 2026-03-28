import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CompanyCustomField, CompanyCustomFieldOption, CompanyCustomFieldTarget, CompanyCustomFieldType, CompanySettings, CustomFieldTargetScope, TimeEntryType } from "@shared/types/models";
import { normalizeCustomField } from "@shared/utils/custom-fields";
import { createDefaultOvertimeSettings } from "@shared/utils/overtime";
import { PageActionBar, PageActionBarActions, PageActionButton } from "@/components/page-action-bar";
import { Field, FieldCombobox, FormFields, FormPage, FormSection } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Stack } from "@/components/stack";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PencilSimple, Plus, Trash } from "phosphor-react";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCompanySettings } from "@/lib/company-settings";
import { toast } from "@/lib/toast";
import {
  DEFAULT_COMPANY_DATE_TIME_FORMAT,
  DEFAULT_COMPANY_LOCALE,
  DEFAULT_COMPANY_TIME_ZONE,
  DEFAULT_COMPANY_WEEKEND_DAYS,
} from "@shared/utils/company-locale";

const defaultSettings: CompanySettings = {
  currency: "EUR",
  locale: DEFAULT_COMPANY_LOCALE,
  timeZone: DEFAULT_COMPANY_TIME_ZONE,
  dateTimeFormat: DEFAULT_COMPANY_DATE_TIME_FORMAT,
  firstDayOfWeek: 1,
  weekendDays: [...DEFAULT_COMPANY_WEEKEND_DAYS],
  editDaysLimit: 30,
  insertDaysLimit: 30,
  allowOneRecordPerDay: false,
  allowIntersectingRecords: false,
  allowRecordsOnHolidays: true,
  allowRecordsOnWeekends: true,
  allowFutureRecords: false,
  country: "AT",
  tabletIdleTimeoutSeconds: 10,
  autoBreakAfterMinutes: 300,
  autoBreakDurationMinutes: 30,
  projectsEnabled: false,
  tasksEnabled: false,
  customFields: [],
  overtime: createDefaultOvertimeSettings(),
};

function createField(): CompanyCustomField {
  return {
    id: crypto.randomUUID(),
    label: "",
    type: "text",
    targets: [{ scope: "time_entry", entryTypes: ["work"] }],
    required: false,
    placeholder: null,
    options: [],
  };
}

function createOption(): CompanyCustomFieldOption {
  const id = crypto.randomUUID();
  return {
    id,
    label: "",
    value: id,
  };
}

function cloneField(field: CompanyCustomField): CompanyCustomField {
  return {
    ...field,
    targets: field.targets.map((target) =>
      target.scope === "time_entry"
        ? { scope: "time_entry" as const, entryTypes: [...(target.entryTypes ?? ["work"])] }
        : { scope: target.scope }
    ),
    options: field.options.map((option) => ({ ...option })),
  };
}

function FieldSummaryCard({
  field,
  index,
  onEdit,
  onRemove,
  summaryLabel,
  t
}: {
  field: CompanyCustomField;
  index: number;
  summaryLabel: string;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  t: (key: string, options?: Record<string, string | number>) => string;
}) {
  return (
    <div className="flex flex-col gap-2 border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{field.label.trim() || t("fields.field", { index: index + 1 })}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(index)} type="button" aria-label={t("fields.editField")}>
          <PencilSimple size={16} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRemove(index)} type="button" aria-label={t("fields.removeField")}>
          <Trash size={16} />
        </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Badge variant="outline" className="max-w-[8rem] overflow-hidden rounded-none border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
          <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {field.type === "select" ? t("fields.selectWithOptions") : t("fields.typeValue", { value: field.type })}
          </span>
        </Badge>
        <Badge variant="outline" className="max-w-[18rem] overflow-hidden rounded-none border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
          <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{summaryLabel}</span>
        </Badge>
        {field.required ? (
          <Badge variant="outline" className="rounded-none border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
            {t("fields.required")}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function FieldEditorSheet({
  open,
  mode,
  field,
  onOpenChange,
  onFieldChange,
  onToggleTargetScope,
  onToggleTimeEntryType,
  onAddOption,
  onRemoveOption,
  onOptionChange,
  onSave,
  saving,
  fieldTypeOptions,
  targetOptions,
  timeEntryTargetOptions,
  getTimeEntryTarget,
  hasTargetScope,
  getFieldTargetSummary,
  t
}: {
  open: boolean;
  mode: "create" | "edit" | null;
  field: CompanyCustomField | null;
  onOpenChange: (open: boolean) => void;
  onFieldChange: (nextField: CompanyCustomField) => void;
  onToggleTargetScope: (scope: CustomFieldTargetScope) => void;
  onToggleTimeEntryType: (entryType: TimeEntryType) => void;
  onAddOption: () => void;
  onRemoveOption: (optionIndex: number) => void;
  onOptionChange: (optionIndex: number, nextOption: CompanyCustomFieldOption) => void;
  onSave: () => void;
  saving: boolean;
  fieldTypeOptions: Array<{ value: string; label: string }>;
  targetOptions: Array<{ value: CustomFieldTargetScope; label: string }>;
  timeEntryTargetOptions: Array<{ value: TimeEntryType; label: string }>;
  getTimeEntryTarget: (field: CompanyCustomField) => CompanyCustomFieldTarget;
  hasTargetScope: (field: CompanyCustomField, scope: CustomFieldTargetScope) => boolean;
  getFieldTargetSummary: (field: CompanyCustomField) => string;
  t: (key: string, options?: Record<string, string | number>) => string;
}) {
  if (!field || mode === null) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(96vw,72rem)] max-w-none p-0">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-border px-6 py-5 pr-14">
            <SheetHeader>
              <SheetTitle>{mode === "create" ? t("fields.addField") : t("fields.editField")}</SheetTitle>
              <SheetDescription>{t("fields.description")}</SheetDescription>
            </SheetHeader>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <div className="flex flex-col gap-6">
              <FormFields className="grid gap-4">
                <Field label={t("fields.label")}>
                  <Input
                    placeholder={t("fields.labelPlaceholder")}
                    value={field.label}
                    onChange={(event) => onFieldChange({ ...field, label: event.target.value })}
                  />
                </Field>
                <Field label={t("fields.type")}>
                  <FieldCombobox
                    label={t("fields.type")}
                    value={field.type}
                    onValueChange={(value) => {
                      const nextType = value as CompanyCustomField["type"];
                      onFieldChange({
                        ...field,
                        type: nextType,
                        options: nextType === "select" ? (field.options.length > 0 ? field.options : [createOption()]) : [],
                      });
                    }}
                    items={fieldTypeOptions}
                  />
                </Field>
                <Field label={t("fields.placeholder")}>
                  <Input
                    placeholder={t("fields.placeholderPlaceholder")}
                    value={field.placeholder ?? ""}
                    onChange={(event) => onFieldChange({ ...field, placeholder: event.target.value || null })}
                  />
                </Field>
                <Field label={t("fields.required")}>
                  <div className="flex items-center justify-between border border-border bg-transparent px-3 py-3">
                    <span className="text-sm text-foreground">{t("fields.requiredDescription")}</span>
                    <Switch checked={field.required} onCheckedChange={(checked) => onFieldChange({ ...field, required: checked })} />
                  </div>
                </Field>
                <Field label={t("fields.appliesTo")}>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      {targetOptions.map((target) => (
                        <Button
                          key={target.value}
                          variant={hasTargetScope(field, target.value) ? "default" : "outline"}
                          onClick={() => onToggleTargetScope(target.value)}
                          type="button"
                        >
                          {target.label}
                        </Button>
                      ))}
                    </div>
                    {hasTargetScope(field, "time_entry") ? (
                      <div className="flex flex-wrap gap-2 border border-border bg-muted/20 p-3">
                        {timeEntryTargetOptions.map((target) => {
                          const timeEntryTarget = getTimeEntryTarget(field);
                          const active = timeEntryTarget.entryTypes?.includes(target.value) ?? false;
                          return (
                            <Button
                              key={target.value}
                              variant={active ? "default" : "outline"}
                              onClick={() => onToggleTimeEntryType(target.value)}
                              type="button"
                            >
                              {target.label}
                            </Button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </Field>
              </FormFields>

              {field.type === "select" ? (
                <div className="border border-border bg-background">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <p className="text-sm font-medium text-foreground">{t("fields.options")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 p-3">
                    {field.options.map((option, optionIndex) => (
                      <div key={option.id} className="flex min-w-[14rem] flex-1 items-center gap-2 px-0 py-0">
                        <Input
                          placeholder={t("fields.optionLabelPlaceholder")}
                          value={option.label}
                          onChange={(event) => onOptionChange(optionIndex, { ...option, label: event.target.value })}
                        />
                        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => onRemoveOption(optionIndex)} type="button" aria-label={t("fields.removeOption")}>
                          <Trash size={16} />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" className="min-w-[10rem] flex-1 justify-start gap-2 border-dashed" onClick={onAddOption} type="button">
                      <Plus size={14} />
                      {t("fields.addOption")}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {getFieldTargetSummary(field)}
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
              <Button type="button" onClick={onSave} disabled={saving}>
                {saving ? t("fields.saving") : t("fields.save")}
              </Button>
            </SheetFooter>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function FieldsPage() {
  const { t } = useTranslation();
  const { companySession } = useAuth();
  const { settings: companySettings, setSettings: setCompanySettings } = useCompanySettings();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteFieldIndex, setConfirmDeleteFieldIndex] = useState<number | null>(null);
  const [fieldEditorOpen, setFieldEditorOpen] = useState(false);
  const [fieldEditorMode, setFieldEditorMode] = useState<"create" | "edit" | null>(null);
  const [fieldEditorIndex, setFieldEditorIndex] = useState<number | null>(null);
  const [fieldDraft, setFieldDraft] = useState<CompanyCustomField | null>(null);
  const fieldEditorCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldEditorHadOpenedRef = useRef(false);
  const pageResource = {
    data: companySettings ?? defaultSettings,
    isLoading: false,
    isRefreshing: false,
  };
  const fieldTypeOptions = [
    { value: "text", label: t("fields.typeText") },
    { value: "number", label: t("fields.typeNumber") },
    { value: "date", label: t("fields.typeDate") },
    { value: "boolean", label: t("fields.typeBoolean") },
    { value: "select", label: t("fields.typeSelect") },
  ];
  const targetOptions: Array<{ value: CustomFieldTargetScope; label: string }> = [
    { value: "time_entry", label: t("fields.targetTimeEntry") },
    { value: "user", label: t("fields.targetUser") },
    { value: "project", label: t("fields.targetProject") },
    { value: "task", label: t("fields.targetTask") },
  ];
  const timeEntryTargetOptions: Array<{ value: TimeEntryType; label: string }> = [
    { value: "work", label: t("fields.targetWork") },
    { value: "vacation", label: t("fields.targetVacation") },
    { value: "time_off_in_lieu", label: t("fields.targetTimeOffInLieu") },
    { value: "sick_leave", label: t("fields.targetSickLeave") },
  ];

  useEffect(() => {
    if (companySettings) {
      setSettings(companySettings);
    }
  }, [companySettings]);

  useEffect(() => {
    if (fieldEditorCleanupRef.current) {
      clearTimeout(fieldEditorCleanupRef.current);
      fieldEditorCleanupRef.current = null;
    }

    if (fieldEditorOpen) {
      fieldEditorHadOpenedRef.current = true;
      return;
    }

    if (!fieldEditorHadOpenedRef.current) {
      return;
    }

    fieldEditorCleanupRef.current = setTimeout(() => {
      setFieldEditorMode(null);
      setFieldEditorIndex(null);
      setFieldDraft(null);
      fieldEditorCleanupRef.current = null;
    }, 220);

    return () => {
      if (fieldEditorCleanupRef.current) {
        clearTimeout(fieldEditorCleanupRef.current);
        fieldEditorCleanupRef.current = null;
      }
    };
  }, [fieldEditorOpen]);

  function setField(index: number, nextField: CompanyCustomField) {
    setSettings((current) => ({
      ...current,
      customFields: current.customFields.map((field, fieldIndex) => (fieldIndex === index ? nextField : field)),
    }));
  }

  function toggleTargetScope(index: number, scope: CustomFieldTargetScope) {
    const field = settings.customFields[index];
    const hasTarget = field.targets.some((target) => target.scope === scope);
    const nextTargets = hasTarget
      ? field.targets.filter((target) => target.scope !== scope)
      : [
          ...field.targets,
          scope === "time_entry"
            ? ({ scope: "time_entry" as const, entryTypes: ["work"] as TimeEntryType[] })
            : ({ scope } as CompanyCustomFieldTarget),
        ];
    setField(index, {
      ...field,
      targets: nextTargets,
    });
  }

  function toggleTimeEntryType(index: number, entryType: TimeEntryType) {
    const field = settings.customFields[index];
    const currentTarget = field.targets.find((target) => target.scope === "time_entry");
    const currentEntryTypes = currentTarget?.entryTypes ?? [];
    const nextEntryTypes = currentEntryTypes.includes(entryType)
      ? currentEntryTypes.filter((value) => value !== entryType)
      : [...currentEntryTypes, entryType];

    const normalizedEntryTypes: TimeEntryType[] = nextEntryTypes.length > 0 ? nextEntryTypes : ["work"];
    const nextTargets = field.targets.some((target) => target.scope === "time_entry")
      ? field.targets.map((target) => target.scope === "time_entry" ? { scope: "time_entry" as const, entryTypes: normalizedEntryTypes } : target)
      : [...field.targets, { scope: "time_entry" as const, entryTypes: normalizedEntryTypes }];

    setField(index, {
      ...field,
      targets: nextTargets,
    });
  }

  function hasTargetScope(field: CompanyCustomField, scope: CustomFieldTargetScope) {
    return field.targets.some((target) => target.scope === scope);
  }

  function getTimeEntryTarget(field: CompanyCustomField) {
    return field.targets.find((target) => target.scope === "time_entry") ?? { scope: "time_entry" as const, entryTypes: ["work"] };
  }

  function getFieldTargetSummary(field: CompanyCustomField) {
    const timeEntryLabelMap: Record<TimeEntryType, string> = {
      work: t("fields.targetWork"),
      vacation: t("fields.targetVacation"),
      sick_leave: t("fields.targetSickLeave"),
      time_off_in_lieu: t("fields.targetTimeOffInLieu"),
    };

    return field.targets
      .map((target) => {
        if (target.scope === "time_entry") {
          const categories: TimeEntryType[] = target.entryTypes?.length ? target.entryTypes : ["work"];
          return `${t("fields.targetTimeEntry")}: ${categories.map((entryType) => timeEntryLabelMap[entryType]).join(", ")}`;
        }
        if (target.scope === "user") return t("fields.targetUser");
        if (target.scope === "project") return t("fields.targetProject");
        return t("fields.targetTask");
      })
      .join(" · ");
  }

  function setOption(fieldIndex: number, optionIndex: number, nextOption: CompanyCustomFieldOption) {
    const field = settings.customFields[fieldIndex];
    setField(fieldIndex, {
      ...field,
      options: field.options.map((option, currentIndex) => (currentIndex === optionIndex ? nextOption : option)),
    });
  }

  async function removeField(index: number) {
    await persistCustomFields(settings.customFields.filter((_, fieldIndex) => fieldIndex !== index));
  }

  function validateCustomFields(fields: CompanySettings["customFields"]) {
    return fields.map((field) => {
      const normalizedField = normalizeCustomField(field);

      if (normalizedField.label.length < 2) {
        throw new Error(t("fields.labelRequired"));
      }

      if (normalizedField.targets.length === 0) {
        throw new Error(t("fields.targetRequired", { label: normalizedField.label }));
      }

      if (normalizedField.type === "select") {
        const validOptions = normalizedField.options.filter((option) => option.label.length > 0);
        if (validOptions.length === 0) {
          throw new Error(t("fields.optionRequired", { label: normalizedField.label }));
        }
        normalizedField.options = validOptions.map((option) => ({ ...option, value: option.id }));
      }

      return normalizedField;
    });
  }

  async function persistCustomFields(nextFields: CompanySettings["customFields"]) {
    if (!companySession) return;

    const cleanedFields = validateCustomFields(nextFields);

    try {
      setSaving(true);
      const response = await api.updateSettings(companySession.token, {
        ...settings,
        customFields: cleanedFields,
      });
      setSettings(response.settings);
      setCompanySettings(response.settings);
      toast({ title: t("fields.saved") });
    } catch (error) {
      toast({
        title: t("fields.saveFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
      throw error;
    } finally {
      setSaving(false);
    }
  }

  function setFieldDraftValue(nextField: CompanyCustomField) {
    setFieldDraft(normalizeCustomField(nextField));
  }

  function toggleDraftTargetScope(scope: CustomFieldTargetScope) {
    if (!fieldDraft) return;
    const hasTarget = fieldDraft.targets.some((target) => target.scope === scope);
    const nextTargets = hasTarget
      ? fieldDraft.targets.filter((target) => target.scope !== scope)
      : [
          ...fieldDraft.targets,
          scope === "time_entry"
            ? ({ scope: "time_entry" as const, entryTypes: ["work"] as TimeEntryType[] })
            : ({ scope } as CompanyCustomFieldTarget),
        ];
    setFieldDraftValue({ ...fieldDraft, targets: nextTargets });
  }

  function toggleDraftTimeEntryType(entryType: TimeEntryType) {
    if (!fieldDraft) return;
    const currentTarget = fieldDraft.targets.find((target) => target.scope === "time_entry");
    const currentEntryTypes = currentTarget?.entryTypes ?? [];
    const nextEntryTypes = currentEntryTypes.includes(entryType)
      ? currentEntryTypes.filter((value) => value !== entryType)
      : [...currentEntryTypes, entryType];
    const normalizedEntryTypes: TimeEntryType[] = nextEntryTypes.length > 0 ? nextEntryTypes : ["work"];
    const nextTargets = fieldDraft.targets.some((target) => target.scope === "time_entry")
      ? fieldDraft.targets.map((target) => target.scope === "time_entry" ? { scope: "time_entry" as const, entryTypes: normalizedEntryTypes } : target)
      : [...fieldDraft.targets, { scope: "time_entry" as const, entryTypes: normalizedEntryTypes }];
    setFieldDraftValue({ ...fieldDraft, targets: nextTargets });
  }

  function addDraftOption() {
    if (!fieldDraft) return;
    setFieldDraftValue({ ...fieldDraft, options: [...fieldDraft.options, createOption()] });
  }

  function removeDraftOption(optionIndex: number) {
    if (!fieldDraft) return;
    setFieldDraftValue({ ...fieldDraft, options: fieldDraft.options.filter((_, currentIndex) => currentIndex !== optionIndex) });
  }

  function updateDraftOption(optionIndex: number, nextOption: CompanyCustomFieldOption) {
    if (!fieldDraft) return;
    setFieldDraftValue({
      ...fieldDraft,
      options: fieldDraft.options.map((option, currentIndex) => (currentIndex === optionIndex ? nextOption : option)),
    });
  }

  function openCreateField() {
    setFieldEditorMode("create");
    setFieldEditorIndex(null);
    setFieldDraft(createField());
    setFieldEditorOpen(true);
  }

  function openEditField(index: number) {
    const field = settings.customFields[index];
    if (!field) return;
    setFieldEditorMode("edit");
    setFieldEditorIndex(index);
    setFieldDraft(cloneField(field));
    setFieldEditorOpen(true);
  }

  function closeFieldEditor(open: boolean) {
    setFieldEditorOpen(open);
  }

  async function saveFieldDraft() {
    if (!fieldDraft || !fieldEditorMode) return;
    const normalizedField = normalizeCustomField(fieldDraft);
    const nextFields =
      fieldEditorMode === "create"
        ? [...settings.customFields, normalizedField]
        : fieldEditorIndex !== null
          ? settings.customFields.map((field, index) => (index === fieldEditorIndex ? normalizedField : field))
          : settings.customFields;

    await persistCustomFields(nextFields);
    setFieldEditorOpen(false);
  }

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <PageIntro>
            <PageLabel title={t("fields.title")} description={t("fields.description")} />
            <PageActionBar>
              <PageActionBarActions>
                <PageActionButton
                  onClick={openCreateField}
                  type="button"
                >
                  {t("fields.addField")}
                </PageActionButton>
              </PageActionBarActions>
            </PageActionBar>
          </PageIntro>
        }
        loading={pageResource.isLoading}
        refreshing={pageResource.isRefreshing}
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} />}
      >
        <FormSection>
          <Stack gap="sm">
            {settings.customFields.map((field, index) => (
              <FieldSummaryCard
                key={field.id}
                field={field}
                index={index}
                summaryLabel={getFieldTargetSummary(field)}
                onEdit={openEditField}
                onRemove={setConfirmDeleteFieldIndex}
                t={t}
              />
            ))}

            {settings.customFields.length === 0 ? (
              <div className="border border-border bg-card px-4 py-3">
                <p className="text-sm text-muted-foreground">{t("fields.empty")}</p>
              </div>
            ) : null}
          </Stack>
        </FormSection>

        <FieldEditorSheet
          open={fieldEditorOpen}
          mode={fieldEditorMode}
          field={fieldDraft}
          onOpenChange={closeFieldEditor}
          onFieldChange={setFieldDraftValue}
          onToggleTargetScope={toggleDraftTargetScope}
          onToggleTimeEntryType={toggleDraftTimeEntryType}
          onAddOption={addDraftOption}
          onRemoveOption={removeDraftOption}
          onOptionChange={updateDraftOption}
          onSave={saveFieldDraft}
          saving={saving}
          fieldTypeOptions={fieldTypeOptions}
          targetOptions={targetOptions}
          timeEntryTargetOptions={timeEntryTargetOptions}
          getTimeEntryTarget={getTimeEntryTarget}
          hasTargetScope={hasTargetScope}
          getFieldTargetSummary={getFieldTargetSummary}
          t={t}
        />

      </PageLoadBoundary>
      <AppConfirmDialog
        open={confirmDeleteFieldIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDeleteFieldIndex(null);
          }
        }}
        title={t("fields.removeFieldTitle")}
        description={
          confirmDeleteFieldIndex !== null
            ? t("fields.removeFieldDescription", {
                label: settings.customFields[confirmDeleteFieldIndex]?.label.trim() || t("fields.field", { index: confirmDeleteFieldIndex + 1 })
              })
            : undefined
        }
        confirmLabel={t("fields.removeFieldConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (confirmDeleteFieldIndex === null) return;
          void removeField(confirmDeleteFieldIndex);
          setConfirmDeleteFieldIndex(null);
        }}
      />
    </FormPage>
  );
}
