import { useEffect, useMemo, useState } from "react";
import type {
  CompanyOvertimeRule,
  CompanyOvertimeSettings,
  OvertimeCompensationType,
  OvertimeConflictResolution,
  OvertimePresetId,
  OvertimeRuleTriggerKind
} from "@shared/types/models";
import {
  createOvertimePreset,
  getOvertimePresetDescriptor,
  normalizeOvertimeSettings,
  overtimePresetDescriptors
} from "@shared/utils/overtime";
import { FormActions, FormPage, FormPanel, FormSection, Field, FieldCombobox } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageIntro } from "@/components/page-intro";
import { PageLabel } from "@/components/page-label";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TimeInput } from "@/components/ui/time-input";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

const hourOptions = Array.from({ length: 49 }, (_, index) => {
  const value = (index * 0.5).toFixed(1).replace(/\.0$/, "");
  return { value, label: `${value} h` };
});
const weeklyHourOptions = Array.from({ length: 337 }, (_, index) => {
  const value = (index * 0.5).toFixed(1).replace(/\.0$/, "");
  return { value, label: `${value} h` };
});
const weekOptions = Array.from({ length: 26 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} weeks` }));
const bonusOptions = [0, 15, 25, 30, 40, 50, 75, 100, 125, 150, 200].map((value) => ({ value: String(value), label: `+${value}%` }));
const compensationOptions = [
  { value: "cash", label: "Cash" },
  { value: "time_off", label: "Time Off" },
  { value: "cash_or_time_off", label: "Cash or Time Off" }
];
const payoutDecisionOptions = [
  { value: "company", label: "Company decides - payroll follows company policy" },
  { value: "employee", label: "Employee decides - employee always chooses payout" },
  { value: "conditional", label: "Conditional - employee chooses only after thresholds" }
];
const conflictOptions = [
  { value: "stack", label: "Stack them - overlapping bonuses are added together" },
  { value: "highest_only", label: "Take highest - only the highest bonus applies" }
];
const triggerOptions = [
  { value: "daily_after_hours", label: "Daily after specific hour" },
  { value: "weekly_after_hours", label: "Weekly after specific hour" },
  { value: "daily_overtime", label: "Daily overtime threshold" },
  { value: "weekly_overtime", label: "Weekly overtime threshold" },
  { value: "sunday_or_holiday", label: "Sunday / public holiday" },
  { value: "night_shift", label: "Night shift window" }
];

function getRuleByCategory(settings: CompanyOvertimeSettings, category: CompanyOvertimeRule["category"]) {
  return settings.rules.find((rule) => rule.category === category) ?? null;
}

function updateRuleById(settings: CompanyOvertimeSettings, ruleId: string, updater: (rule: CompanyOvertimeRule) => CompanyOvertimeRule) {
  return {
    ...settings,
    rules: settings.rules.map((rule) => (rule.id === ruleId ? updater(rule) : rule))
  };
}

function createSpecialRule(): CompanyOvertimeRule {
  return {
    id: crypto.randomUUID(),
    category: "special",
    triggerKind: "daily_after_hours",
    afterHours: 10,
    windowStart: null,
    windowEnd: null,
    multiplierPercent: 100,
    compensationType: "cash"
  };
}

function getRuleLabel(rule: CompanyOvertimeRule) {
  if (rule.category === "standard_overtime") return "Standard Overtime";
  if (rule.category === "sunday_holiday") return "Sundays / Holidays";
  if (rule.category === "night_shift") return "Night Shift";
  return "Special Rule";
}

function getPayoutSummary(settings: CompanyOvertimeSettings) {
  if (settings.payoutDecisionMode === "employee") {
    return "Employee chooses between cash and time off for applicable overtime.";
  }

  if (settings.payoutDecisionMode === "company") {
    return "Company policy decides how overtime is compensated.";
  }

  const daily = settings.employeeChoiceAfterDailyHours;
  const weekly = settings.employeeChoiceAfterWeeklyHours;
  if (daily !== null && weekly !== null) {
    return `Employee chooses after more than ${daily} daily hours or ${weekly} weekly hours.`;
  }
  if (daily !== null) {
    return `Employee chooses after more than ${daily} daily hours.`;
  }
  if (weekly !== null) {
    return `Employee chooses after more than ${weekly} weekly hours.`;
  }
  return "Employee choice activates only when the configured threshold is reached.";
}

function getLiveExample(settings: CompanyOvertimeSettings) {
  const standardRule = getRuleByCategory(settings, "standard_overtime");
  const triggerHours = standardRule?.triggerKind === "weekly_overtime"
    ? settings.weeklyOvertimeThresholdHours
    : settings.dailyOvertimeThresholdHours;
  const displayTriggerHours = standardRule?.afterHours ?? triggerHours;
  const overtimeHours = Math.max(0, 10 - Math.min(10, settings.dailyOvertimeThresholdHours));
  const multiplier = standardRule?.multiplierPercent ?? 50;

  return {
    baseHours: Math.min(10, settings.dailyOvertimeThresholdHours),
    overtimeHours,
    multiplier,
    displayTriggerHours,
    payout: getPayoutSummary(settings)
  };
}

export function OvertimeSettingsPage() {
  const { companySession } = useAuth();
  const [settings, setSettings] = useState<CompanyOvertimeSettings>(() => createOvertimePreset("at_default"));
  const [saving, setSaving] = useState(false);
  const pageResource = usePageResource<{ overtime: CompanyOvertimeSettings }>({
    enabled: Boolean(companySession),
    deps: [companySession?.token],
    load: async () => {
      if (!companySession) {
        return { overtime: createOvertimePreset("at_default") };
      }
      return api.getOvertimeSettings(companySession.token);
    }
  });

  useEffect(() => {
    if (!pageResource.data) return;
    setSettings(normalizeOvertimeSettings(pageResource.data.overtime));
  }, [pageResource.data]);

  const liveExample = useMemo(() => getLiveExample(settings), [settings]);
  const presetDescriptor = useMemo(() => getOvertimePresetDescriptor(settings.presetId), [settings.presetId]);
  const standardRule = getRuleByCategory(settings, "standard_overtime");
  const sundayRule = getRuleByCategory(settings, "sunday_holiday");
  const nightRule = getRuleByCategory(settings, "night_shift");
  const specialRules = settings.rules.filter((rule) => rule.category === "special");
  const presetOptions = overtimePresetDescriptors.map((preset) => ({
    value: preset.id,
    label: `${preset.title} - ${preset.subtitle}`
  }));

  function applyPreset(presetId: OvertimePresetId) {
    setSettings(createOvertimePreset(presetId));
  }

  function setRuleValue(ruleId: string, patch: Partial<CompanyOvertimeRule>) {
    setSettings((current) => updateRuleById(current, ruleId, (rule) => ({ ...rule, ...patch })));
  }

  async function handleSave() {
    if (!companySession) return;
    try {
      setSaving(true);
      const response = await api.updateOvertimeSettings(companySession.token, { overtime: settings });
      setSettings(normalizeOvertimeSettings(response.overtime));
      toast({ title: "Overtime settings saved" });
    } catch (error) {
      toast({
        title: "Could not save overtime settings",
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <>
            <PageBackAction to="/settings" label="Back to settings" />
            <PageIntro>
              <PageLabel title="Overtime Management" description="Preset-driven overtime storage with exact thresholds, overrideable surcharges, and a future-ready regulation model." />
            </PageIntro>
          </>
        }
        loading={pageResource.isLoading}
        refreshing={pageResource.isRefreshing}
        skeleton={<PageLoadingState label="Loading overtime settings..." />}
      >
        <div className="flex flex-col gap-5">
          <FormPanel className="gap-5">
              <FormSection>
                <Field label="Preset">
                  <FieldCombobox
                    label="overtime preset"
                    value={settings.presetId}
                    onValueChange={(value) => applyPreset(value as OvertimePresetId)}
                    items={presetOptions}
                  />
                </Field>
              </FormSection>

              <FormSection>
                <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/20 p-4">
                  <div className="rounded-2xl border border-border bg-background px-4 py-4">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Preset</p>
                    <p className="mt-2 text-sm font-medium text-foreground">{presetDescriptor.title}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {presetDescriptor.legalStatus === "statutory_baseline"
                        ? "Exact statutory baseline"
                        : presetDescriptor.legalStatus === "conservative_default"
                          ? "Conservative default"
                          : presetDescriptor.legalStatus === "reference_default"
                            ? "Reference default"
                            : "Custom template"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-background px-4 py-4">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Current payout</p>
                    <p className="mt-2 text-sm text-foreground">{getPayoutSummary(settings)}</p>
                  </div>
                  <div className="flex flex-col gap-3">
                    {presetDescriptor.highlights.slice(0, 2).map((item) => (
                      <div key={item} className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </FormSection>

              <FormSection>
                <div className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/20 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-foreground">Triggers</p>
                    <p className="text-sm text-muted-foreground">Control when overtime starts and whether averaging is active.</p>
                  </div>

                  <div className="flex flex-col gap-4">
                    <Field label="Daily overtime starts after">
                      <FieldCombobox
                        label="daily overtime threshold"
                        value={String(settings.dailyOvertimeThresholdHours)}
                        onValueChange={(value) => setSettings((current) => ({ ...current, dailyOvertimeThresholdHours: Number(value) }))}
                        items={hourOptions}
                      />
                    </Field>
                    <Field label="Weekly overtime starts after">
                      <FieldCombobox
                        label="weekly overtime threshold"
                        value={String(settings.weeklyOvertimeThresholdHours)}
                        onValueChange={(value) => setSettings((current) => ({ ...current, weeklyOvertimeThresholdHours: Number(value) }))}
                        items={weeklyHourOptions}
                      />
                    </Field>
                    <Field label="Flexitime / averaging">
                      <div className="flex h-11 items-center justify-between rounded-xl border border-input bg-background px-4">
                        <span className="text-sm text-foreground">{settings.averagingEnabled ? "Enabled" : "Disabled"}</span>
                        <Switch checked={settings.averagingEnabled} onCheckedChange={(checked) => setSettings((current) => ({ ...current, averagingEnabled: checked }))} />
                      </div>
                    </Field>
                    <Field label="Average over">
                      <FieldCombobox
                        label="averaging weeks"
                        value={String(settings.averagingWeeks)}
                        onValueChange={(value) => setSettings((current) => ({ ...current, averagingWeeks: Number(value) }))}
                        items={weekOptions}
                        disabled={!settings.averagingEnabled}
                      />
                    </Field>
                  </div>
                </div>
              </FormSection>

              <FormSection>
                <div className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/20 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-foreground">Surcharges</p>
                    <p className="text-sm text-muted-foreground">Configure standard overtime, Sundays or holidays, night windows, and additional custom rules.</p>
                  </div>

                  <div className="flex flex-col gap-3">
                    {[standardRule, sundayRule, nightRule].filter((rule): rule is CompanyOvertimeRule => rule !== null).map((rule) => (
                      <div key={rule.id} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-foreground">{getRuleLabel(rule)}</p>
                          <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">+{rule.multiplierPercent}%</span>
                        </div>

                        <div className="flex flex-col gap-3">
                          {rule.category === "standard_overtime" ? (
                            <Field label="Trigger">
                              <FieldCombobox
                                label="standard overtime trigger"
                                value={rule.triggerKind}
                                onValueChange={(value) => setRuleValue(rule.id, { triggerKind: value as OvertimeRuleTriggerKind })}
                                items={triggerOptions.filter((option) => option.value === "daily_overtime" || option.value === "weekly_overtime")}
                              />
                            </Field>
                          ) : null}
                          {rule.category === "night_shift" ? (
                            <>
                              <Field label="From">
                                <TimeInput
                                  value={rule.windowStart ?? ""}
                                  onChange={(value) => setRuleValue(rule.id, { windowStart: value })}
                                  showHelperButton={false}
                                />
                              </Field>
                              <Field label="To">
                                <TimeInput
                                  value={rule.windowEnd ?? ""}
                                  onChange={(value) => setRuleValue(rule.id, { windowEnd: value })}
                                  showHelperButton={false}
                                />
                              </Field>
                            </>
                          ) : null}
                          <Field label="Reward">
                            <FieldCombobox
                              label="multiplier percent"
                              value={String(rule.multiplierPercent)}
                              onValueChange={(value) => setRuleValue(rule.id, { multiplierPercent: Number(value) })}
                              items={bonusOptions}
                            />
                          </Field>
                          <Field label="Paid in">
                            <FieldCombobox
                              label="compensation type"
                              value={rule.compensationType}
                              onValueChange={(value) => setRuleValue(rule.id, { compensationType: value as OvertimeCompensationType })}
                              items={compensationOptions}
                            />
                          </Field>
                        </div>
                      </div>
                    ))}

                    {specialRules.map((rule) => (
                      <div key={rule.id} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
                        <div className="flex flex-col gap-2">
                          <p className="text-sm font-medium text-foreground">Special Rule</p>
                          <Button variant="ghost" className="h-8 w-fit px-2" onClick={() => setSettings((current) => ({ ...current, rules: current.rules.filter((currentRule) => currentRule.id !== rule.id) }))} type="button">
                            Remove
                          </Button>
                        </div>

                        <div className="flex flex-col gap-3">
                          <Field label="Event">
                            <FieldCombobox
                              label="special trigger"
                              value={rule.triggerKind}
                              onValueChange={(value) => setRuleValue(rule.id, { triggerKind: value as OvertimeRuleTriggerKind })}
                              items={triggerOptions}
                            />
                          </Field>
                          <Field label="After">
                            <FieldCombobox
                              label="special threshold"
                              value={String(rule.afterHours ?? 10)}
                              onValueChange={(value) => setRuleValue(rule.id, { afterHours: Number(value) })}
                              items={weeklyHourOptions}
                            />
                          </Field>
                          <Field label="Bonus">
                            <FieldCombobox
                              label="special multiplier"
                              value={String(rule.multiplierPercent)}
                              onValueChange={(value) => setRuleValue(rule.id, { multiplierPercent: Number(value) })}
                              items={bonusOptions}
                            />
                          </Field>
                          <Field label="Paid in">
                            <FieldCombobox
                              label="special compensation"
                              value={rule.compensationType}
                              onValueChange={(value) => setRuleValue(rule.id, { compensationType: value as OvertimeCompensationType })}
                              items={compensationOptions}
                            />
                          </Field>
                        </div>
                      </div>
                    ))}

                    <Button variant="outline" className="self-start" onClick={() => setSettings((current) => ({ ...current, rules: [...current.rules, createSpecialRule()] }))} type="button">
                      + Add Special Rule
                    </Button>
                  </div>
                </div>
              </FormSection>

              <FormSection>
                <div className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/20 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-foreground">Payout Choice</p>
                    <p className="text-sm text-muted-foreground">Choose payout control and thresholds.</p>
                  </div>

                  <Field label="Who decides payout">
                    <FieldCombobox
                      label="payout decision mode"
                      value={settings.payoutDecisionMode}
                      onValueChange={(value) => setSettings((current) => ({ ...current, payoutDecisionMode: value as CompanyOvertimeSettings["payoutDecisionMode"] }))}
                      items={payoutDecisionOptions}
                    />
                  </Field>

                  {settings.payoutDecisionMode === "conditional" ? (
                    <div className="flex flex-col gap-4">
                      <Field label="Employee chooses after daily hours">
                        <FieldCombobox
                          label="employee daily choice threshold"
                          value={String(settings.employeeChoiceAfterDailyHours ?? 10)}
                          onValueChange={(value) => setSettings((current) => ({ ...current, employeeChoiceAfterDailyHours: Number(value) }))}
                          items={hourOptions}
                        />
                      </Field>
                      <Field label="Employee chooses after weekly hours">
                        <FieldCombobox
                          label="employee weekly choice threshold"
                          value={String(settings.employeeChoiceAfterWeeklyHours ?? 50)}
                          onValueChange={(value) => setSettings((current) => ({ ...current, employeeChoiceAfterWeeklyHours: Number(value) }))}
                          items={weeklyHourOptions}
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              </FormSection>

              <FormSection>
                <div className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/20 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-foreground">Conflict Resolver</p>
                    <p className="text-sm text-muted-foreground">Define overlap handling.</p>
                  </div>

                  <Field label="If multiple bonuses overlap">
                    <FieldCombobox
                      label="conflict resolution"
                      value={settings.conflictResolution}
                      onValueChange={(value) => setSettings((current) => ({ ...current, conflictResolution: value as OvertimeConflictResolution }))}
                      items={conflictOptions}
                    />
                  </Field>
                </div>
              </FormSection>

              <FormActions>
                <Button disabled={saving} onClick={() => void handleSave()} type="button">
                  {saving ? "Saving..." : "Save Overtime Rules"}
                </Button>
              </FormActions>
          </FormPanel>

          <FormPanel className="gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">Live Example</p>
              <p className="text-sm text-muted-foreground">Instant preview.</p>
            </div>

            <div className="rounded-2xl bg-foreground px-5 py-5 text-background">
              <p className="text-xs uppercase tracking-[0.2em] text-background/65">Example employee</p>
              <p className="mt-2 text-lg font-semibold">Max works 10 hours on a Tuesday</p>
              <div className="mt-4 flex flex-col gap-2 text-sm">
                <p>{liveExample.baseHours} hours: Normal pay</p>
                <p>{liveExample.overtimeHours} hours: Overtime (+{liveExample.multiplier}%)</p>
              </div>
              <div className="mt-4 rounded-2xl bg-background/10 px-3 py-3 text-sm text-background/85">
                {liveExample.payout}
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/20 p-4 text-sm">
              <p className="font-medium text-foreground">Current profile</p>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Preset</span>
                <span className="text-foreground">{presetDescriptor.shortLabel}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Daily trigger</span>
                <span className="text-foreground">{settings.dailyOvertimeThresholdHours} h</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Weekly trigger</span>
                <span className="text-foreground">{settings.weeklyOvertimeThresholdHours} h</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Standard bonus</span>
                <span className="text-foreground">+{standardRule?.multiplierPercent ?? 0}%</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Overlap rule</span>
                <span className="text-foreground">{settings.conflictResolution === "stack" ? "Stack" : "Highest only"}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Austrian preset note</p>
              <p>Sunday, holiday, and night rules stay editable but neutral by default.</p>
            </div>
          </FormPanel>
        </div>
      </PageLoadBoundary>
    </FormPage>
  );
}
