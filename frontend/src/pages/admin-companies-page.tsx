import { useMemo, useState } from "react";
import { Copy, Download, KeyRound, ShieldPlus, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InvitationCodeRecord, SystemStats } from "@shared/types/models";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { AppFullBleed } from "@/components/app-content-lane";
import { FormPage, FormPanel } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLabel } from "@/components/page-label";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePageResource } from "@/hooks/use-page-resource";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

function formatAdminDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getInvitationBadge(code: InvitationCodeRecord) {
  if (code.usedAt) {
    return { label: "Used", className: "bg-muted text-muted-foreground border-border" };
  }
  return { label: "Active", className: "bg-primary text-primary-foreground border-primary" };
}

function ImportSelectionSummary({ files }: { files: File[] }) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="flex max-h-32 min-w-0 flex-col gap-2 overflow-auto rounded-xl border border-border bg-muted/20 p-3">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Selected files</p>
      <div className="flex flex-col gap-1">
        {files.map((file) => (
          <p key={`${file.name}-${file.size}`} className="break-all text-xs text-foreground">
            {file.name}
          </p>
        ))}
      </div>
    </div>
  );
}

export function AdminCompaniesPage() {
  const { t } = useTranslation();
  const { adminSession } = useAuth();
  const [newCompany, setNewCompany] = useState({
    name: "",
    adminFullName: "",
    adminUsername: "",
    adminPassword: "",
  });
  const [createMigrationFiles, setCreateMigrationFiles] = useState<File[]>([]);
  const [createInvitationNote, setCreateInvitationNote] = useState("");
  const [newAdmin, setNewAdmin] = useState({ companyId: "", username: "", password: "", fullName: "" });
  const [importingCompanyId, setImportingCompanyId] = useState<string | null>(null);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [pendingDeleteCompany, setPendingDeleteCompany] = useState<{ id: string; name: string } | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [createAdminSubmitting, setCreateAdminSubmitting] = useState(false);
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [migrationSchema, setMigrationSchema] = useState<Awaited<ReturnType<typeof api.getCompanyMigrationSchema>>["schema"] | null>(null);

  const adminResource = usePageResource<{
    companies: Awaited<ReturnType<typeof api.listCompanies>>["companies"];
    stats: SystemStats | null;
    invitationCodes: InvitationCodeRecord[];
  }>({
    enabled: Boolean(adminSession),
    deps: [adminSession?.token, t],
    load: async () => {
      if (!adminSession) {
        return { companies: [], stats: null, invitationCodes: [] };
      }

      try {
        const [companyResponse, statsResponse, invitationCodesResponse] = await Promise.all([
          api.listCompanies(adminSession.token),
          api.getSystemStats(adminSession.token),
          api.listInvitationCodes(adminSession.token),
        ]);
        return {
          companies: companyResponse.companies,
          stats: statsResponse.stats,
          invitationCodes: invitationCodesResponse.invitationCodes,
        };
      } catch (error) {
        toast({
          title: "Admin workspace could not load",
          description: error instanceof Error ? error.message : "Request failed",
        });
        throw error;
      }
    },
  });

  const companies = adminResource.data?.companies ?? [];
  const stats = adminResource.data?.stats;
  const invitationCodes = adminResource.data?.invitationCodes ?? [];
  const activeInvitationCodes = useMemo(
    () => invitationCodes.filter((code) => !code.usedAt),
    [invitationCodes],
  );

  function downloadTextFile(fileName: string, content: string, contentType: string) {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  }

  async function reloadAdminData() {
    await adminResource.reload();
  }

  async function handleCreateCompany() {
    if (!adminSession) return;
    setCreateSubmitting(true);
    try {
      if (createMigrationFiles.length > 0) {
        if (newCompany.name.trim().length < 2) {
          throw new Error("Company name is required");
        }
        await api.createCompanyFromCsvPackage(adminSession.token, {
          name: newCompany.name.trim(),
          files: createMigrationFiles,
        });
      } else {
        if (newCompany.name.trim().length < 2) throw new Error("Company name is required");
        if (newCompany.adminFullName.trim().length < 2) throw new Error("Admin full name is required");
        if (newCompany.adminUsername.trim().length < 2) throw new Error("Admin username is required");
        if (newCompany.adminPassword.trim().length < 6) throw new Error("Admin password must be at least 6 characters");
        await api.createCompany(adminSession.token, {
          name: newCompany.name.trim(),
          adminFullName: newCompany.adminFullName.trim(),
          adminUsername: newCompany.adminUsername.trim(),
          adminPassword: newCompany.adminPassword,
        });
      }

      setNewCompany({ name: "", adminFullName: "", adminUsername: "", adminPassword: "" });
      setCreateMigrationFiles([]);
      toast({ title: "Company created" });
      await reloadAdminData();
    } catch (error) {
      toast({
        title: "Could not create company",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleCreateInvitationCode() {
    if (!adminSession) return;
    setInviteSubmitting(true);
    try {
      const response = await api.createInvitationCode(adminSession.token, {
        note: createInvitationNote.trim() || undefined,
      });
      setCreateInvitationNote("");
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(response.invitationCode.code);
      }
      toast({ title: "Invitation code created" });
      await reloadAdminData();
    } catch (error) {
      toast({
        title: "Could not create invitation code",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function handleDeleteInvitationCode(invitationCodeId: number) {
    if (!adminSession) return;
    try {
      await api.deleteInvitationCode(adminSession.token, { invitationCodeId });
      toast({ title: "Invitation code deleted" });
      await reloadAdminData();
    } catch (error) {
      toast({
        title: "Could not delete invitation code",
        description: error instanceof Error ? error.message : "Request failed",
      });
    }
  }

  async function handleCopyInvitationCode(code: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(code);
      toast({ title: "Invitation code copied" });
    } catch {
      toast({ title: "Clipboard is not available in this browser" });
    }
  }

  async function handleDeleteCompany(companyId: string) {
    if (!adminSession) return;
    setDeleteSubmitting(true);
    try {
      await api.deleteCompany(adminSession.token, { companyId });
      setPendingDeleteCompany(null);
      toast({ title: "Company deleted" });
      await reloadAdminData();
    } catch (error) {
      toast({
        title: "Could not delete company",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function handleDownloadCompanyCsvPackage(companyId: string, companyName: string) {
    if (!adminSession) return;
    try {
      const exported = await api.downloadCompanyCsvPackage(adminSession.token, companyId);
      const url = window.URL.createObjectURL(exported.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.fileName || `${companyName}.migration.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
      toast({ title: `CSV package exported for ${companyName}` });
    } catch (error) {
      toast({
        title: "Could not export CSV package",
        description: error instanceof Error ? error.message : "Request failed",
      });
    }
  }

  async function handleImportCompanyCsvPackage(companyId: string) {
    if (!adminSession || importFiles.length === 0) return;
    setImportingCompanyId(companyId);
    try {
      await api.importCompanyCsvPackage(adminSession.token, companyId, importFiles);
      setImportFiles([]);
      toast({ title: "CSV package imported" });
      await reloadAdminData();
    } catch (error) {
      toast({
        title: "Could not import CSV package",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setImportingCompanyId(null);
    }
  }

  async function handleLoadMigrationSchema() {
    if (!adminSession) return;
    setSchemaLoading(true);
    try {
      const response = await api.getCompanyMigrationSchema(adminSession.token);
      setMigrationSchema(response.schema);
    } catch (error) {
      toast({
        title: "Could not load migration schema",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSchemaLoading(false);
    }
  }

  async function handleCopyMigrationSchema() {
    if (!migrationSchema) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(JSON.stringify(migrationSchema, null, 2));
      toast({ title: "Migration schema copied" });
    } catch {
      toast({ title: "Clipboard is not available in this browser" });
    }
  }

  function handleDownloadMigrationSchema() {
    if (!migrationSchema) return;
    downloadTextFile("migration-schema.json", JSON.stringify(migrationSchema, null, 2), "application/json");
  }

  async function handleCreateCompanyAdmin() {
    if (!adminSession) return;
    setCreateAdminSubmitting(true);
    try {
      await api.createCompanyAdmin(adminSession.token, newAdmin);
      setNewAdmin({ companyId: "", username: "", password: "", fullName: "" });
      toast({ title: "Company admin created" });
      await reloadAdminData();
    } catch (error) {
      toast({
        title: "Could not create company admin",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setCreateAdminSubmitting(false);
    }
  }

  return (
    <FormPage className="h-full min-h-0">
      <PageLoadBoundary
        intro={
          <PageIntro>
            <PageLabel title="Admin" description="Manage companies, registration access, and system-level workspace setup." />
          </PageIntro>
        }
        loading={adminResource.isLoading}
        refreshing={adminResource.isRefreshing}
        className="min-h-0 flex-1"
        skeleton={<PageLoadingState label={t("common.loading", { defaultValue: "Loading..." })} minHeightClassName="min-h-[28rem]" />}
      >
        <AppFullBleed className="flex min-h-0 min-w-0 flex-1 xl:px-12 2xl:px-16">
          <div className="flex min-h-0 w-full flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <FormPanel className="gap-2 bg-background">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Companies</p>
                <p className="text-2xl font-semibold tracking-[-0.04em] text-foreground">{stats?.companyCount ?? 0}</p>
              </FormPanel>
              <FormPanel className="gap-2 bg-background">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Invitation codes</p>
                <p className="text-2xl font-semibold tracking-[-0.04em] text-foreground">{stats?.activeInvitationCodeCount ?? 0}</p>
              </FormPanel>
              <FormPanel className="gap-2 bg-background">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Users</p>
                <p className="text-2xl font-semibold tracking-[-0.04em] text-foreground">{stats?.totalUsers ?? 0}</p>
              </FormPanel>
              <FormPanel className="gap-2 bg-background">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Active timers</p>
                <p className="text-2xl font-semibold tracking-[-0.04em] text-foreground">{stats?.activeTimers ?? 0}</p>
              </FormPanel>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <FormPanel className="gap-4">
                <div className="flex flex-col gap-1">
                  <p className="text-lg font-semibold tracking-[-0.03em] text-foreground">Create company</p>
                  <p className="text-sm text-muted-foreground">Create a fresh workspace or seed one from a CSV migration package inside the same admin surface.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    value={newCompany.name}
                    onChange={(event) => setNewCompany((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Company name"
                  />
                  <Input
                    value={newCompany.adminFullName}
                    onChange={(event) => setNewCompany((current) => ({ ...current, adminFullName: event.target.value }))}
                    placeholder="Admin full name"
                    disabled={createMigrationFiles.length > 0}
                  />
                  <Input
                    value={newCompany.adminUsername}
                    onChange={(event) => setNewCompany((current) => ({ ...current, adminUsername: event.target.value }))}
                    placeholder="Admin username"
                    disabled={createMigrationFiles.length > 0}
                  />
                  <Input
                    type="password"
                    value={newCompany.adminPassword}
                    onChange={(event) => setNewCompany((current) => ({ ...current, adminPassword: event.target.value }))}
                    placeholder="Admin password"
                    disabled={createMigrationFiles.length > 0}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-foreground">Optional CSV package import</p>
                  <FileInput
                    files={createMigrationFiles}
                    multiple
                    accept=".zip,.csv"
                    placeholder="Upload one migration zip or company.csv plus all exported table CSV files"
                    buttonLabel="Select"
                    onFilesChange={setCreateMigrationFiles}
                  />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    {createMigrationFiles.length > 0 ? "The uploaded migration zip or unpacked CSV set will seed the company directly from the exported relational package." : "A standard company with one admin user will be created."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Dialog
                      open={schemaDialogOpen}
                      onOpenChange={(open) => {
                        setSchemaDialogOpen(open);
                        if (open && migrationSchema === null && !schemaLoading) {
                          void handleLoadMigrationSchema();
                        }
                      }}
                    >
                      <DialogTrigger asChild>
                        <Button type="button" variant="outline">
                          Schema support
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-5xl">
                        <DialogHeader>
                          <DialogTitle>Migration schema support</DialogTitle>
                          <DialogDescription>Live JSON contract for the CSV migration package, generated from the current company schema.</DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" onClick={() => void handleLoadMigrationSchema()} disabled={schemaLoading}>
                              {schemaLoading ? "Refreshing..." : "Refresh schema"}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => void handleCopyMigrationSchema()} disabled={!migrationSchema}>
                              <Copy className="mr-2 h-4 w-4" />
                              Copy JSON
                            </Button>
                            <Button type="button" variant="outline" onClick={handleDownloadMigrationSchema} disabled={!migrationSchema}>
                              <Download className="mr-2 h-4 w-4" />
                              Download JSON
                            </Button>
                          </div>
                          <Textarea
                            value={migrationSchema ? JSON.stringify(migrationSchema, null, 2) : (schemaLoading ? "Loading schema..." : "No schema loaded yet.")}
                            readOnly
                            className="min-h-[28rem] font-mono text-xs"
                          />
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Button type="button" onClick={() => void handleCreateCompany()} disabled={createSubmitting}>
                      {createSubmitting ? "Creating..." : "Create company"}
                    </Button>
                  </div>
                </div>
              </FormPanel>

              <FormPanel className="gap-4">
                <div className="flex flex-col gap-1">
                  <p className="text-lg font-semibold tracking-[-0.03em] text-foreground">Invitation codes</p>
                  <p className="text-sm text-muted-foreground">Registration now requires an invitation code. Generate, copy, and delete them here.</p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={createInvitationNote}
                    onChange={(event) => setCreateInvitationNote(event.target.value)}
                    placeholder="Optional note"
                  />
                  <Button type="button" onClick={() => void handleCreateInvitationCode()} disabled={inviteSubmitting}>
                    <KeyRound className="mr-2 h-4 w-4" />
                    {inviteSubmitting ? "Creating..." : "Generate code"}
                  </Button>
                </div>
                <div className="flex max-h-[26rem] flex-col gap-3 overflow-auto">
                  {invitationCodes.length === 0 ? (
                    <div className="border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                      No invitation codes created yet.
                    </div>
                  ) : (
                    invitationCodes.map((code) => {
                      const badge = getInvitationBadge(code);
                      return (
                        <div key={code.id} className="border border-border bg-background p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 flex-col gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-mono text-sm font-semibold tracking-[0.18em] text-foreground">{code.code}</p>
                                <Badge className={badge.className}>{badge.label}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{code.note || "No note"}</p>
                              <p className="text-xs text-muted-foreground">
                                Created {formatAdminDate(code.createdAt)}
                                {code.usedByCompanyName ? ` • Used by ${code.usedByCompanyName}` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => void handleCopyInvitationCode(code.code)} aria-label="Copy invitation code">
                                <Copy className="h-4 w-4" />
                              </Button>
                              {!code.usedAt ? (
                                <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive" onClick={() => void handleDeleteInvitationCode(code.id)} aria-label="Delete invitation code">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{activeInvitationCodes.length} active codes ready for registration.</p>
              </FormPanel>
            </div>

            <FormPanel className="gap-4">
                <div className="flex flex-col gap-1">
                  <p className="text-lg font-semibold tracking-[-0.03em] text-foreground">Companies</p>
                <p className="text-sm text-muted-foreground">Each company stays manageable from one card: CSV migration control, admin provisioning, and deletion.</p>
              </div>
              {companies.length === 0 ? (
                <div className="border border-dashed border-border bg-muted/20 px-4 py-10 text-sm text-muted-foreground">
                  No companies exist yet.
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                  {companies.map((company) => (
                    <div key={company.id} className="flex flex-col gap-4 border border-border bg-background p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex flex-col gap-2">
                          <p className="text-lg font-semibold tracking-[-0.03em] text-foreground">{company.name}</p>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{company.encryptionEnabled ? "Secure mode" : "Standard mode"}</Badge>
                            <Badge variant="outline">Created {formatAdminDate(company.createdAt)}</Badge>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 text-destructive"
                          onClick={() => setPendingDeleteCompany({ id: company.id, name: company.name })}
                          aria-label={`Delete ${company.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => void handleDownloadCompanyCsvPackage(company.id, company.name)}>
                          <Download className="mr-2 h-4 w-4" />
                          Export CSV
                        </Button>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              <Upload className="mr-2 h-4 w-4" />
                              Import CSV
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="w-[calc(100%-1rem)] max-w-[38rem] gap-5 overflow-hidden p-5 sm:p-6">
                            <DialogHeader>
                              <DialogTitle>Import CSV package</DialogTitle>
                              <DialogDescription className="max-w-full break-words pr-8">
                                Upload one migration zip or the unpacked CSV set to fully replace {company.name}.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="flex min-w-0 flex-col gap-4">
                              <FileInput
                                files={importFiles}
                                multiple
                                accept=".zip,.csv"
                                placeholder="Upload one migration zip or company.csv plus all exported table CSV files"
                                buttonLabel="Select"
                                onFilesChange={setImportFiles}
                              />
                              <ImportSelectionSummary files={importFiles} />
                              <Button type="button" onClick={() => void handleImportCompanyCsvPackage(company.id)} disabled={importFiles.length === 0 || importingCompanyId === company.id}>
                                {importingCompanyId === company.id ? "Importing..." : "Replace company from CSV"}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setNewAdmin((current) => ({ ...current, companyId: company.id }))}
                            >
                              <ShieldPlus className="mr-2 h-4 w-4" />
                              Add admin
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Add company admin</DialogTitle>
                              <DialogDescription>Create another admin inside {company.name}.</DialogDescription>
                            </DialogHeader>
                            <div className="flex flex-col gap-3">
                              <Input
                                value={newAdmin.fullName}
                                onChange={(event) => setNewAdmin((current) => ({ ...current, fullName: event.target.value }))}
                                placeholder="Full name"
                              />
                              <Input
                                value={newAdmin.username}
                                onChange={(event) => setNewAdmin((current) => ({ ...current, username: event.target.value }))}
                                placeholder="Username"
                              />
                              <Input
                                type="password"
                                value={newAdmin.password}
                                onChange={(event) => setNewAdmin((current) => ({ ...current, password: event.target.value }))}
                                placeholder="Password"
                              />
                              <Button type="button" onClick={() => void handleCreateCompanyAdmin()} disabled={createAdminSubmitting}>
                                {createAdminSubmitting ? "Creating..." : "Create company admin"}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </FormPanel>
            <AppConfirmDialog
              open={pendingDeleteCompany !== null}
              onOpenChange={(open) => {
                if (!open) {
                  setPendingDeleteCompany(null);
                }
              }}
              title={pendingDeleteCompany ? `Delete ${pendingDeleteCompany.name}?` : "Delete company?"}
              description="This permanently removes the company record and wipes its company database storage."
              confirmLabel="Delete company"
              destructive
              confirming={deleteSubmitting}
              onConfirm={() => {
                if (pendingDeleteCompany) {
                  void handleDeleteCompany(pendingDeleteCompany.id);
                }
              }}
            />
          </div>
        </AppFullBleed>
      </PageLoadBoundary>
    </FormPage>
  );
}
