import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CompanyCustomField, CompanyCustomFieldOption, CompanySettings, TimeEntryType } from "@shared/types/models";
import { createDefaultOvertimeSettings } from "@shared/utils/overtime";
import { PageActionBar, PageActionBarActions, PageActionButton } from "@/components/page-action-bar";
import { Field, FieldCombobox, FormActions, FormFields, FormPage, FormSection } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { PageLabel } from "@/components/page-label";
import { Stack } from "@/components/stack";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

const defaultSettings: CompanySettings = {
  currency: "EUR",
  locale: "en-GB",
  timeZone: "Europe/Vienna",
  dateTimeFormat: "g",
  firstDayOfWeek: 1,
  editDaysLimit: 30,
  insertDaysLimit: 30,
  allowOneRecordPerDay: false,
  allowIntersectingRecords: false,
  allowRecordsOnHolidays: true,
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
    targets: ["work"],
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

export function FieldsPage() {
  const { t } = useTranslation();
  const { companySession } = useAuth();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteFieldIndex, setConfirmDeleteFieldIndex] = useState<number | null>(null);
  const pageResource = usePageResource<CompanySettings>({
    enabled: Boolean(companySession),
    deps: [companySession?.token, t],
    load: async () => {
      if (!companySession) {
        return defaultSettings;
      }

      try {
        const response = await api.getSettings(companySession.token);
        return response.settings;
      } catch (error) {
        toast({
          title: t("fields.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed",
        });
        throw error;
      }
    }
  });
  const fieldTypeOptions = [
    { value: "text", label: t("fields.typeText") },
    { value: "number", label: t("fields.typeNumber") },
    { value: "date", label: t("fields.typeDate") },
    { value: "boolean", label: t("fields.typeBoolean") },
    { value: "select", label: t("fields.typeSelect") },
  ];
  const targetOptions: Array<{ value: TimeEntryType; label: string }> = [
    { value: "work", label: t("fields.targetWork") },
    { value: "vacation", label: t("fields.targetVacation") },
    { value: "time_off_in_lieu", label: t("fields.targetTimeOffInLieu") },
    { value: "sick_leave", label: t("fields.targetSickLeave") },
  ];

  useEffect(() => {
    if (pageResource.data) {
      setSettings(pageResource.data);
    }
  }, [pageResource.data]);

  function setField(index: number, nextField: CompanyCustomField) {
    setSettings((current) => ({
      ...current,
      customFields: current.customFields.map((field, fieldIndex) => (fieldIndex === index ? nextField : field)),
    }));
  }

  function toggleTarget(index: number, target: TimeEntryType) {
    const field = settings.customFields[index];
    const nextTargets = field.targets.includes(target)
      ? field.targets.filter((value) => value !== target)
      : [...field.targets, target];

    setField(index, {
      ...field,
      targets: nextTargets.length > 0 ? nextTargets : [target],
    });
  }

  function setOption(fieldIndex: number, optionIndex: number, nextOption: CompanyCustomFieldOption) {
    const field = settings.customFields[fieldIndex];
    setField(fieldIndex, {
      ...field,
      options: field.options.map((option, currentIndex) => (currentIndex === optionIndex ? nextOption : option)),
    });
  }

  function removeField(index: number) {
    setSettings((current) => ({
      ...current,
      customFields: current.customFields.filter((_, fieldIndex) => fieldIndex !== index),
    }));
  }

  async function handleSave() {
    if (!companySession) return;

    try {
      const cleanedFields = settings.customFields.map((field) => {
        const normalizedField = {
          ...field,
          label: field.label.trim(),
          placeholder: field.placeholder?.trim() || null,
          targets: Array.from(new Set(field.targets)),
          options: field.type === "select"
            ? field.options.map((option) => ({
                ...option,
                label: option.label.trim(),
                value: option.id,
              }))
            : [],
        };

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

      setSaving(true);
      const response = await api.updateSettings(companySession.token, {
        ...settings,
        customFields: cleanedFields,
      });
      setSettings(response.settings);
      toast({ title: t("fields.saved") });
    } catch (error) {
      toast({
        title: t("fields.saveFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
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
                  onClick={() => setSettings((current) => ({ ...current, customFields: [...current.customFields, createField()] }))}
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
          <Stack gap="md">
            {settings.customFields.map((field, index) => (
              <Stack key={field.id} gap="md" className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <Stack gap="xs">
                  <p className="text-sm font-medium text-foreground">
                    {field.label.trim() || t("fields.field", { index: index + 1 })}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {field.type === "select" ? t("fields.selectWithOptions") : t("fields.typeValue", { value: field.type })}
                  </p>
                </Stack>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmDeleteFieldIndex(index)}
                  type="button"
                >
                  {t("fields.removeField")}
                </Button>
              </div>

              <FormFields>
                <Field label={t("fields.label")}>
                  <Input placeholder={t("fields.labelPlaceholder")} value={field.label} onChange={(event) => setField(index, { ...field, label: event.target.value })} />
                </Field>
                <Field label={t("fields.type")}>
                  <FieldCombobox
                    label={t("fields.type")}
                    value={field.type}
                    onValueChange={(value) => {
                      const nextType = value as CompanyCustomField["type"];
                      setField(index, {
                        ...field,
                        type: nextType,
                        options: nextType === "select" ? (field.options.length > 0 ? field.options : [createOption()]) : [],
                      });
                    }}
                    items={fieldTypeOptions}
                  />
                </Field>
                <Field label={t("fields.placeholder")}>
                  <Input placeholder={t("fields.placeholderPlaceholder")} value={field.placeholder ?? ""} onChange={(event) => setField(index, { ...field, placeholder: event.target.value || null })} />
                </Field>
                <Field label={t("fields.required")}>
                  <div className="flex items-center justify-between rounded-xl border border-border bg-transparent px-3 py-3">
                    <span className="text-sm text-foreground">{t("fields.requiredDescription")}</span>
                    <Switch checked={field.required} onCheckedChange={(checked) => setField(index, { ...field, required: checked })} />
                  </div>
                </Field>
                <Field label={t("fields.appliesTo")}>
                  <div className="flex flex-wrap gap-2">
                    {targetOptions.map((target) => (
                      <Button
                        key={target.value}
                        variant={field.targets.includes(target.value) ? "default" : "outline"}
                        onClick={() => toggleTarget(index, target.value)}
                        type="button"
                      >
                        {target.label}
                      </Button>
                    ))}
                  </div>
                </Field>
              </FormFields>

              {field.type === "select" ? (
                <Stack gap="sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{t("fields.options")}</p>
                    <Button
                      variant="ghost"
                      onClick={() => setField(index, { ...field, options: [...field.options, createOption()] })}
                      type="button"
                    >
                      {t("fields.addOption")}
                    </Button>
                  </div>
                  <Stack gap="sm">
                    {field.options.map((option, optionIndex) => (
                      <Stack key={option.id} gap="sm" className="rounded-xl border border-border bg-background p-4">
                        <FormFields>
                          <Field label={t("fields.optionLabel")}>
                            <Input placeholder={t("fields.optionLabelPlaceholder")} value={option.label} onChange={(event) => setOption(index, optionIndex, { ...option, label: event.target.value })} />
                          </Field>
                          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                            {t("fields.storedValueAuto", { value: option.id })}
                          </div>
                        </FormFields>
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            onClick={() => setField(index, { ...field, options: field.options.filter((_, currentIndex) => currentIndex !== optionIndex) })}
                            type="button"
                          >
                            {t("fields.removeOption")}
                          </Button>
                        </div>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              ) : null}
              </Stack>
            ))}

            {settings.customFields.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="text-sm text-muted-foreground">{t("fields.empty")}</p>
              </div>
            ) : null}
          </Stack>
        </FormSection>

        <FormActions>
          <Button disabled={saving} onClick={() => void handleSave()} type="button">
            {saving ? t("fields.saving") : t("fields.save")}
          </Button>
        </FormActions>
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
          removeField(confirmDeleteFieldIndex);
          setConfirmDeleteFieldIndex(null);
        }}
      />
    </FormPage>
  );
}
