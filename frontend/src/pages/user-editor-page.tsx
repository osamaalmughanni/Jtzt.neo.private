import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { UserContractInput } from "@shared/types/api";
import type { UserRole } from "@shared/types/models";
import { FormActions, FormFields, FormPage, FormPanel, FormSection, Field, FieldCombobox } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
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

function validateContracts(contracts: UserContractInput[]) {
  if (contracts.length > 100) throw new Error("A user can have at most 100 contracts");
  const sorted = [...contracts].sort((left, right) => left.startDate.localeCompare(right.startDate));
  for (let index = 0; index < sorted.length; index += 1) {
    const contract = sorted[index];
    if (!contract.startDate) throw new Error("Each contract needs a start date");
    if (contract.endDate !== null && contract.startDate > contract.endDate) throw new Error("Contract end date must be after the start date");
    const previous = sorted[index - 1];
    if (previous && contract.startDate <= (previous.endDate ?? "9999-12-31")) throw new Error("Contracts cannot overlap");
  }

  const today = new Date().toISOString().slice(0, 10);
  const hasCurrentContract = sorted.some((contract) => contract.startDate <= today && (contract.endDate === null || contract.endDate >= today));
  if (!hasCurrentContract) throw new Error("A current active contract is required");
}

function isCurrentContract(contract: UserContractInput) {
  const today = new Date().toISOString().slice(0, 10);
  return contract.startDate <= today && (contract.endDate === null || contract.endDate >= today);
}

function getContractStatus(contract: UserContractInput) {
  const today = new Date().toISOString().slice(0, 10);
  if (!contract.startDate) return "Draft";
  if (contract.startDate > today) return "Upcoming";
  if (contract.endDate === null || contract.endDate >= today) return "Current";
  return "Past";
}

export function UserEditorPage({ mode }: UserEditorPageProps) {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { companySession, companyIdentity } = useAuth();
  const [form, setForm] = useState<UserFormState>(createEmptyForm);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const statusOptions = [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" }
  ];
  const roleOptions = [
    { value: "admin", label: "Admin" },
    { value: "manager", label: "Manager" },
    { value: "employee", label: "Employee" }
  ];

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
          title: "Could not load user",
          description: error instanceof Error ? error.message : "Request failed"
        })
      )
      .finally(() => setLoading(false));
  }, [companySession, mode, userId]);

  function setField<K extends keyof UserFormState>(key: K, value: UserFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setContractField(index: number, key: keyof UserContractInput, value: number | string) {
    setForm((current) => ({
      ...current,
      contracts: current.contracts.map((contract, contractIndex) =>
        contractIndex === index ? { ...contract, [key]: value } : contract
      )
    }));
  }

  function addContract() {
    if (form.contracts.length >= 100) {
      toast({ title: "Contract limit reached", description: "A user can have at most 100 contracts." });
      return;
    }
    setForm((current) => ({ ...current, contracts: [...current.contracts, createEmptyContract()] }));
  }

  function addCurrentContract() {
    const today = new Date().toISOString().slice(0, 10);
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
      if (form.fullName.trim().length < 2) throw new Error("Full name is required");
      if (form.username.trim().length < 2) throw new Error("Username is required");
      if (mode === "create" && form.password.trim().length < 6) throw new Error("Password must be at least 6 characters");
      if (form.password.trim().length > 0 && form.password.trim().length < 6) throw new Error("Password must be at least 6 characters");
      if (!/^\d{4}$/.test(form.pinCode.trim())) throw new Error("PIN code must be exactly 4 digits");
      if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) throw new Error("Enter a valid email");
      validateContracts(form.contracts);

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
        toast({ title: "User created" });
        navigate(`/users/${response.userId}/edit`);
      } else {
        await api.updateUser(companySession.token, { userId: Number(userId), ...payload, password: payload.password || undefined });
        toast({ title: "User saved" });
      }
    } catch (error) {
      toast({
        title: "Could not save user",
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!companySession || mode !== "edit" || !userId) return;
    if (!window.confirm(`Delete ${form.fullName}?`)) return;

    try {
      setDeleting(true);
      await api.deleteUser(companySession.token, { userId: Number(userId) });
      toast({ title: "User deleted" });
      navigate("/users");
    } catch (error) {
      toast({
        title: "Could not delete user",
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <FormPage>
      <PageBackAction to="/users" label="Back to users" />
      <PageLabel
        title={mode === "create" ? "Create user" : "Edit user"}
        description={mode === "create" ? "Create a user profile and contracts." : "Edit user profile, status, role, PIN, and contracts."}
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
                <Field label="Name">
                  <Input placeholder="Jane Doe" value={form.fullName} onChange={(event) => setField("fullName", event.target.value)} />
                </Field>
                <Field label="E-mail">
                  <Input placeholder="jane@company.com" type="email" value={form.email} onChange={(event) => setField("email", event.target.value)} />
                </Field>
                <Field label="Status">
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
                <Field label="Username">
                  <Input placeholder="jane" value={form.username} onChange={(event) => setField("username", event.target.value)} />
                </Field>
                <Field label="PIN code">
                  <Input
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="0000"
                    value={form.pinCode}
                    onChange={(event) => setField("pinCode", event.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </Field>
                <Field label="Password">
                  <Input
                    type="password"
                    placeholder={mode === "edit" ? "Leave blank to keep current password" : "At least 6 characters"}
                    value={form.password}
                    onChange={(event) => setField("password", event.target.value)}
                  />
                </Field>
                <Field label="Role">
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
                <p className="text-sm font-medium text-foreground">Contracts</p>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={addCurrentContract} type="button">
                    New current
                  </Button>
                  <Button variant="outline" onClick={addContract} type="button">
                    Add contract
                  </Button>
                </div>
              </div>

              {form.contracts.length === 0 ? <p className="text-sm text-muted-foreground">No contracts yet.</p> : null}

              <div className="flex flex-col gap-4">
                {form.contracts.map((contract, index) => (
                  <div key={`${contract.id ?? "new"}-${index}`} className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">Contract {index + 1}</p>
                        <span className="rounded-full border border-border bg-muted px-2 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          {getContractStatus(contract)}
                        </span>
                      </div>
                      <Button variant="ghost" onClick={() => removeContract(index)} type="button">
                        Remove
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {contract.startDate || "No start date"} {contract.endDate ? `to ${contract.endDate}` : "to open end"}
                    </p>
                    <FormFields>
                      <Field label="Current contract">
                        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <p className="text-sm text-foreground">Keep this contract open-ended</p>
                            <p className="text-xs text-muted-foreground">Turn this on to remove the end date and mark it as the active contract period.</p>
                          </div>
                          <Switch
                            checked={contract.endDate === null}
                            onCheckedChange={(checked) => setContractField(index, "endDate", checked ? null : new Date().toISOString().slice(0, 10))}
                          />
                        </div>
                      </Field>
                      <Field label="Hours per week">
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          placeholder="40"
                          value={contract.hoursPerWeek}
                          onChange={(event) => setContractField(index, "hoursPerWeek", Number(event.target.value))}
                        />
                      </Field>
                      <Field label="Start date">
                        <Input type="date" placeholder="Start date" value={contract.startDate} onChange={(event) => setContractField(index, "startDate", event.target.value)} />
                      </Field>
                      {contract.endDate === null ? null : (
                        <Field label="End date">
                          <Input
                            type="date"
                            placeholder="Contract end date"
                            value={contract.endDate ?? ""}
                            onChange={(event) => setContractField(index, "endDate", event.target.value || null)}
                          />
                        </Field>
                      )}
                      <Field label="Payment per hour">
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
                  {companyIdentity?.user.id === Number(userId) ? "Active user" : deleting ? "Deleting..." : "Delete"}
                </Button>
              ) : null}
              <Button disabled={saving || loading} onClick={() => void handleSave()} type="button">
                {saving ? "Saving..." : "Save"}
              </Button>
            </FormActions>
          </>
        )}
      </FormPanel>
    </FormPage>
  );
}
