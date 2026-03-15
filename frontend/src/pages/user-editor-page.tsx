import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getLocalNowSnapshot } from "@shared/utils/time";
import type { UserContractInput } from "@shared/types/api";
import type { UserRole } from "@shared/types/models";
import { FormActions, FormFields, FormPage, FormPanel, FormSection, Field, FieldCombobox } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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

function createEmptyContract(): UserContractInput {
  return { hoursPerWeek: 40, startDate: "", endDate: null, paymentPerHour: 0 };
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
  const sorted = [...contracts].sort((left, right) => left.startDate.localeCompare(right.startDate));
  for (let index = 0; index < sorted.length; index += 1) {
    const contract = sorted[index];
    if (!contract.startDate) throw new Error(t("userEditor.contractStartRequired"));
    if (contract.endDate !== null && contract.startDate > contract.endDate) throw new Error(t("userEditor.contractEndAfterStart"));
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

export function UserEditorPage({ mode }: UserEditorPageProps) {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { companySession, companyIdentity } = useAuth();
  const [settingsLocale, setSettingsLocale] = useState("en-GB");
  const [settingsTimeZone, setSettingsTimeZone] = useState("Europe/Vienna");
  const [form, setForm] = useState<UserFormState>(createEmptyForm);
  const [loading, setLoading] = useState(mode === "edit");
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

  useEffect(() => {
    if (!companySession) return;
    void api.getSettings(companySession.token).then((response) => {
      setSettingsLocale(response.settings.locale);
      setSettingsTimeZone(response.settings.timeZone);
    }).catch(() => undefined);
  }, [companySession]);

  useEffect(() => {
    if (mode !== "edit" || !companySession || !userId) return;
    setLoading(true);
    void api
      .getUser(companySession.token, Number(userId))
      .then((response) =>
        setForm({
          fullName: response.user.fullName,
          username: response.user.username,
          password: "",
          role: response.user.role,
          isActive: response.user.isActive,
          pinCode: response.user.pinCode,
          email: response.user.email ?? "",
          contracts: response.user.contracts.map((contract) => ({
            id: contract.id,
            hoursPerWeek: contract.hoursPerWeek,
            startDate: contract.startDate,
            endDate: contract.endDate,
            paymentPerHour: contract.paymentPerHour
          }))
        })
      )
      .catch((error) =>
        toast({
          title: t("userEditor.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed"
        })
      )
      .finally(() => setLoading(false));
  }, [companySession, mode, t, userId]);

  function setField<K extends keyof UserFormState>(key: K, value: UserFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setContractField(index: number, key: keyof UserContractInput, value: number | string | null) {
    setForm((current) => ({
      ...current,
      contracts: current.contracts.map((contract, contractIndex) =>
        contractIndex === index ? { ...contract, [key]: value } : contract
      )
    }));
  }

  function addContract() {
    if (form.contracts.length >= 100) {
      toast({ title: t("userEditor.contractLimitReached"), description: t("userEditor.contractLimitDescription") });
      return;
    }
    setForm((current) => ({ ...current, contracts: [...current.contracts, createEmptyContract()] }));
  }

  function addCurrentContract() {
    const today = getLocalNowSnapshot(new Date(), settingsTimeZone).localDay;
    setForm((current) => ({
      ...current,
      contracts: [
        ...current.contracts.map((contract) =>
          contract.endDate === null ? { ...contract, endDate: today } : contract
        ),
        { ...createEmptyContract(), startDate: today, endDate: null }
      ]
    }));
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
        contracts: form.contracts.map((contract) => ({
          id: contract.id,
          hoursPerWeek: Number(contract.hoursPerWeek),
          startDate: contract.startDate,
          endDate: contract.endDate,
          paymentPerHour: Number(contract.paymentPerHour)
        }))
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
      <PageBackAction to="/users" label={t("userEditor.back")} />
      <PageLabel
        title={mode === "create" ? t("userEditor.createTitle") : t("userEditor.editTitle")}
        description={mode === "create" ? t("userEditor.createDescription") : t("userEditor.editDescription")}
      />
      <FormPanel className="flex flex-col gap-6">
        {mode === "edit" && loading ? (
          <div className="flex min-h-[20rem] flex-col gap-4">
            <div className="h-10 rounded-xl bg-muted/60" />
            <div className="h-10 rounded-xl bg-muted/60" />
            <div className="h-10 rounded-xl bg-muted/60" />
            <div className="h-10 rounded-xl bg-muted/60" />
            <div className="h-28 rounded-2xl bg-muted/60" />
          </div>
        ) : (
          <>

            <FormSection>
              <FormFields>
                <Field label={t("userEditor.name")}>
                  <Input placeholder="Jane Doe" value={form.fullName} onChange={(event) => setField("fullName", event.target.value)} />
                </Field>
                <Field label={t("userEditor.email")}>
                  <Input placeholder="jane@company.com" type="email" value={form.email} onChange={(event) => setField("email", event.target.value)} />
                </Field>
                <Field label={t("userEditor.status")}>
                  <FieldCombobox
                    label="status"
                    value={form.isActive ? "active" : "inactive"}
                    onValueChange={(value) => setField("isActive", value === "active")}
                    items={statusOptions}
                  />
                </Field>
              </FormFields>
            </FormSection>

            <FormSection>
              <FormFields>
                <Field label={t("userEditor.username")}>
                  <Input placeholder="jane" value={form.username} onChange={(event) => setField("username", event.target.value)} />
                </Field>
                <Field label={t("userEditor.pin")}>
                  <Input
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="0000"
                    value={form.pinCode}
                    onChange={(event) => setField("pinCode", event.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </Field>
                <Field label={t("userEditor.password")}>
                  <Input
                    type="password"
                    placeholder={mode === "edit" ? t("userEditor.passwordPlaceholderEdit") : t("userEditor.passwordPlaceholderCreate")}
                    value={form.password}
                    onChange={(event) => setField("password", event.target.value)}
                  />
                </Field>
                <Field label={t("userEditor.role")}>
                  <FieldCombobox
                    label="role"
                    value={form.role}
                    onValueChange={(value) => setField("role", value as UserRole)}
                    items={roleOptions}
                  />
                </Field>
              </FormFields>
            </FormSection>

            <FormSection>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{t("userEditor.contracts")}</p>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={addCurrentContract} type="button">
                    {t("userEditor.newCurrent")}
                  </Button>
                  <Button variant="outline" onClick={addContract} type="button">
                    {t("userEditor.addContract")}
                  </Button>
                </div>
              </div>

              {form.contracts.length === 0 ? <p className="text-sm text-muted-foreground">{t("userEditor.noContracts")}</p> : null}

              <div className="flex flex-col gap-4">
                {form.contracts.map((contract, index) => (
                  <div key={`${contract.id ?? "new"}-${index}`} className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{t("userEditor.contract", { index: index + 1 })}</p>
                        <span className="rounded-full border border-border bg-muted px-2 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          {getContractStatus(contract, t, settingsTimeZone)}
                        </span>
                      </div>
                        <Button variant="ghost" onClick={() => removeContract(index)} type="button">
                          {t("userEditor.remove")}
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {contract.startDate || t("userEditor.noStartDate")} {contract.endDate ? `${t("userEditor.to")} ${contract.endDate}` : t("userEditor.openEnd")}
                    </p>
                    <FormFields>
                      <Field label={t("userEditor.currentContract")}>
                        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <p className="text-sm text-foreground">{t("userEditor.currentContractLabel")}</p>
                            <p className="text-xs text-muted-foreground">{t("userEditor.currentContractDescription")}</p>
                          </div>
                          <Switch
                            checked={contract.endDate === null}
                            onCheckedChange={(checked) =>
                              setContractField(index, "endDate", checked ? null : getLocalNowSnapshot(new Date(), settingsTimeZone).localDay)
                            }
                          />
                        </div>
                      </Field>
                      <Field label={t("userEditor.hoursPerWeek")}>
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          placeholder="40"
                          value={contract.hoursPerWeek}
                          onChange={(event) => setContractField(index, "hoursPerWeek", Number(event.target.value))}
                        />
                      </Field>
                      <Field label={t("userEditor.startDate")}>
                        <DateInput value={contract.startDate} locale={settingsLocale} onChange={(value) => setContractField(index, "startDate", value)} />
                      </Field>
                      {contract.endDate === null ? null : (
                        <Field label={t("userEditor.endDate")}>
                          <DateInput value={contract.endDate ?? ""} locale={settingsLocale} onChange={(value) => setContractField(index, "endDate", value || null)} />
                        </Field>
                      )}
                      <Field label={t("userEditor.paymentPerHour")}>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="25"
                          value={contract.paymentPerHour}
                          onChange={(event) => setContractField(index, "paymentPerHour", Number(event.target.value))}
                        />
                      </Field>
                    </FormFields>
                  </div>
                ))}
              </div>
            </FormSection>

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
              <Button disabled={saving || loading} onClick={() => void handleSave()} type="button">
                {saving ? t("userEditor.saving") : t("userEditor.save")}
              </Button>
            </FormActions>
          </>
        )}
      </FormPanel>
    </FormPage>
  );
}
