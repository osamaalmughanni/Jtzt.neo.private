import { useMemo, useState } from "react";
import { Copy, Download, KeyRound, MoreHorizontal, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CompanyMigrationImportReport } from "@shared/types/api";
import type { InvitationCodeRecord } from "@shared/types/models";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { PageActionBar, PageActionBarActions, PageActionButton } from "@/components/page-action-bar";
import { FormPage, FormSection } from "@/components/form-layout";
import { PageIntro } from "@/components/page-intro";
import { PageLabel } from "@/components/page-label";
import { PageLoadBoundary, PageLoadingState } from "@/components/page-load-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilePicker } from "@/components/ui/file-picker";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { usePageResource } from "@/hooks/use-page-resource";
import { ApiRequestError, api } from "@/lib/api";
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
    return { labelKey: "adminCompanies.usedInvitation", className: "bg-muted text-muted-foreground border-border" };
  }
  return { labelKey: "adminCompanies.activeInvitation", className: "bg-primary text-primary-foreground border-primary" };
}

function isMigrationImportReport(value: unknown): value is CompanyMigrationImportReport {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as CompanyMigrationImportReport).success === "boolean" &&
      Array.isArray((value as CompanyMigrationImportReport).errors) &&
      Array.isArray((value as CompanyMigrationImportReport).warnings)
  );
}

function getImportReportFromError(error: unknown) {
  if (error instanceof ApiRequestError) {
    const details = error.payload?.details;
    if (isMigrationImportReport(details)) {
      return details;
    }
  }
  return null;
}

function getImportReportJsonFromError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return JSON.stringify(
      error.payload?.details ?? error.payload ?? {
        error: error.message,
        status: error.status,
        method: error.method,
        path: error.path,
        requestId: error.requestId,
        runtime: error.runtime,
        env: error.env,
      },
      null,
      2,
    );
  }

  if (error instanceof Error) {
    return JSON.stringify({ error: error.message }, null, 2);
  }

  return JSON.stringify({ error: String(error) }, null, 2);
}

function formatImportProblemLocation(problem: CompanyMigrationImportReport["errors"][number]) {
  const parts: string[] = [problem.stage];
  if (problem.table) parts.push(problem.table);
  if (problem.rowId != null) parts.push(`row ${problem.rowId}`);
  if (problem.column) parts.push(problem.column);
  return parts.join(" · ");
}

function CompactCard({
  title,
  description,
  badges,
  onManage,
  onCopy,
  copyLabel,
  manageLabel,
}: {
  title: string;
  description?: string;
  badges: Array<{ label: string; className?: string }>;
  onManage: () => void;
  onCopy?: () => void;
  copyLabel?: string;
  manageLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          {description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onCopy ? (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onCopy} aria-label={copyLabel}>
              <Copy className="h-4 w-4" />
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onManage} aria-label={manageLabel}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {badges.map((badge) => (
          <Badge key={`${title}-${badge.label}`} variant="outline" className={badge.className}>
            {badge.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function AdminSectionCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-col gap-1.5 pb-4">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-3">
        {children}
      </div>
      {footer ? <div className="pt-3">{footer}</div> : null}
    </div>
  );
}

function AdminEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function AdminList({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-2xl border border-border bg-background divide-y divide-border">{children}</div>;
}

export function AdminCompaniesPage() {
  const { t } = useTranslation();
  const { adminSession } = useAuth();
  const [createCompanySheetOpen, setCreateCompanySheetOpen] = useState(false);
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [companySheetOpen, setCompanySheetOpen] = useState(false);
  const [invitationManageOpen, setInvitationManageOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedInvitation, setSelectedInvitation] = useState<InvitationCodeRecord | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [migrationFiles, setMigrationFiles] = useState<File[]>([]);
  const [invitationNote, setInvitationNote] = useState("");
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [rotateSubmitting, setRotateSubmitting] = useState(false);
  const [workspaceKeyValue, setWorkspaceKeyValue] = useState<string | null>(null);
  const [pendingDeleteCompany, setPendingDeleteCompany] = useState<{ id: string; name: string } | null>(null);
  const [migrationSchemaDialogOpen, setMigrationSchemaDialogOpen] = useState(false);
  const [migrationSchemaJson, setMigrationSchemaJson] = useState("");
  const [migrationSchemaSubmitting, setMigrationSchemaSubmitting] = useState(false);
  const [importReportOpen, setImportReportOpen] = useState(false);
  const [importReport, setImportReport] = useState<CompanyMigrationImportReport | null>(null);
  const [importReportJson, setImportReportJson] = useState("");

  const adminResource = usePageResource<{
    companies: Awaited<ReturnType<typeof api.listCompanies>>["companies"];
    invitationCodes: InvitationCodeRecord[];
  }>({
    enabled: Boolean(adminSession),
    deps: [adminSession?.token, t],
    load: async () => {
      if (!adminSession) {
        return { companies: [], invitationCodes: [] };
      }

      try {
        const [companyResponse, invitationCodesResponse] = await Promise.all([
          api.listCompanies(adminSession.token),
          api.listInvitationCodes(adminSession.token),
        ]);
        return {
          companies: companyResponse.companies,
          invitationCodes: invitationCodesResponse.invitationCodes,
        };
      } catch (error) {
        toast({
          title: t("adminCompanies.loadFailed"),
          description: error instanceof Error ? error.message : t("common.requestFailed"),
        });
        throw error;
      }
    },
  });

  const companies = adminResource.data?.companies ?? [];
  const invitationCodes = adminResource.data?.invitationCodes ?? [];
  const activeInvitationCodes = useMemo(() => invitationCodes.filter((code) => !code.usedAt), [invitationCodes]);
  const selectedCompany = useMemo(() => companies.find((company) => company.id === selectedCompanyId) ?? null, [companies, selectedCompanyId]);

  async function reloadAdminData() {
    await adminResource.reload();
  }

  async function handleCreateCompany() {
    if (!adminSession) return;
    setCreateSubmitting(true);
    try {
      if (companyName.trim().length < 2) {
        throw new Error(t("adminCompanies.companyNameRequired"));
      }

      if (migrationFiles.length > 0) {
        const migrationFile = migrationFiles[0];
        if (!migrationFile) {
          throw new Error(t("adminCompanies.sqliteImportRequired"));
        }
        const response = await api.createCompanyFromMigrationFile(adminSession.token, {
          name: companyName.trim(),
          file: migrationFile,
        });
        setImportReport(response.importReport);
        setImportReportJson(JSON.stringify(response.importReport, null, 2));
        setImportReportOpen(true);
      } else {
        await api.createCompany(adminSession.token, { name: companyName.trim() });
      }

      setCompanyName("");
      setMigrationFiles([]);
      setCreateCompanySheetOpen(false);
      toast({ title: t("adminCompanies.companyCreated") });
      await reloadAdminData();
    } catch (error) {
      const report = getImportReportFromError(error);
      if (report) {
        setImportReport(report);
        setImportReportJson(JSON.stringify(report, null, 2));
        setImportReportOpen(true);
      } else {
        setImportReport(null);
        setImportReportJson(getImportReportJsonFromError(error));
        setImportReportOpen(true);
      }
      toast({
        title: t("adminCompanies.companyCreateFailed"),
        description: error instanceof Error ? error.message : t("common.requestFailed"),
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
        note: invitationNote.trim() || undefined,
      });
      setInvitationNote("");
      setInviteSheetOpen(false);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(response.invitationCode.code);
      }
      toast({ title: t("adminCompanies.invitationCreated") });
      await reloadAdminData();
    } catch (error) {
      toast({
        title: t("adminCompanies.invitationCreateFailed"),
        description: error instanceof Error ? error.message : t("common.requestFailed"),
      });
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function handleDeleteInvitationCode(invitationCodeId: number) {
    if (!adminSession) return;
    try {
      await api.deleteInvitationCode(adminSession.token, { invitationCodeId });
      setInvitationManageOpen(false);
      setSelectedInvitation(null);
      toast({ title: t("adminCompanies.invitationDeleted") });
      await reloadAdminData();
    } catch (error) {
      toast({
        title: t("adminCompanies.invitationDeleteFailed"),
        description: error instanceof Error ? error.message : t("common.requestFailed"),
      });
    }
  }

  async function handleCopyInvitationCode(code: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error(t("common.clipboardUnavailable"));
      }
      await navigator.clipboard.writeText(code);
      toast({ title: t("adminCompanies.invitationCopied") });
    } catch {
      toast({ title: t("common.clipboardUnavailableMessage") });
    }
  }

  async function handleCopyWorkspaceKey() {
    try {
      if (!workspaceKeyValue) return;
      if (!navigator.clipboard?.writeText) {
        throw new Error(t("common.clipboardUnavailable"));
      }
      await navigator.clipboard.writeText(workspaceKeyValue);
      toast({ title: t("adminCompanies.workspaceKeyCopied") });
    } catch {
      toast({ title: t("common.clipboardUnavailableMessage") });
    }
  }

  async function handleDeleteCompany(companyId: string) {
    if (!adminSession) return;
    setDeleteSubmitting(true);
    try {
      await api.deleteCompany(adminSession.token, { companyId });
      setPendingDeleteCompany(null);
      setCompanySheetOpen(false);
      toast({ title: t("adminCompanies.companyDeleted") });
      await reloadAdminData();
    } catch (error) {
      toast({
        title: t("adminCompanies.companyDeleteFailed"),
        description: error instanceof Error ? error.message : t("common.requestFailed"),
      });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function handleOpenMigrationSchemaDialog() {
    if (!adminSession) return;
    try {
      setMigrationSchemaDialogOpen(true);
      setMigrationSchemaSubmitting(true);
      const response = await api.getCompanyMigrationSchema(adminSession.token);
      setMigrationSchemaJson(JSON.stringify(response.schema, null, 2));
    } catch (error) {
      toast({
        title: t("adminCompanies.migrationSchemaExportFailed"),
        description: error instanceof Error ? error.message : t("common.requestFailed"),
      });
      setMigrationSchemaDialogOpen(false);
      setMigrationSchemaJson("");
    } finally {
      setMigrationSchemaSubmitting(false);
    }
  }

  async function handleCopyMigrationSchema() {
    try {
      if (!migrationSchemaJson) return;
      if (!navigator.clipboard?.writeText) {
        throw new Error(t("common.clipboardUnavailable"));
      }
      await navigator.clipboard.writeText(migrationSchemaJson);
      toast({ title: t("adminCompanies.migrationSchemaCopied") });
    } catch {
      toast({ title: t("common.clipboardUnavailableMessage") });
    }
  }

  function handleDownloadMigrationSchemaJson() {
    if (!migrationSchemaJson) return;
    const blob = new Blob([migrationSchemaJson], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "company-migration-schema.json";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    toast({ title: t("adminCompanies.migrationSchemaExported") });
  }

  async function handleDownloadCompanyMigrationFile(companyId: string, companyName: string) {
    if (!adminSession) return;
    try {
      const exported = await api.downloadCompanyMigrationFile(adminSession.token, companyId);
      const url = window.URL.createObjectURL(exported.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.fileName || `${companyName}.migration.sqlite`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
      toast({ title: t("adminCompanies.companySqliteExported", { companyName }) });
    } catch (error) {
      toast({
        title: t("adminCompanies.companySqliteExportFailed"),
        description: error instanceof Error ? error.message : t("common.requestFailed"),
      });
    }
  }

  async function handleImportCompanyMigrationFile(companyId: string, companyName: string) {
    if (!adminSession || importFiles.length === 0) return;
    setImportSubmitting(true);
    try {
      const migrationFile = importFiles[0];
      if (!migrationFile) {
        throw new Error(t("adminCompanies.sqliteImportRequired"));
      }
      const response = await api.importCompanyMigrationFile(adminSession.token, companyId, migrationFile);
      setImportReport(response.importReport);
      setImportReportJson(JSON.stringify(response.importReport, null, 2));
      setImportReportOpen(true);
      setImportFiles([]);
      toast({ title: t("adminCompanies.companySqliteImported", { companyName }) });
      await reloadAdminData();
    } catch (error) {
      const report = getImportReportFromError(error);
      if (report) {
        setImportReport(report);
        setImportReportJson(JSON.stringify(report, null, 2));
        setImportReportOpen(true);
      } else {
        setImportReport(null);
        setImportReportJson(getImportReportJsonFromError(error));
        setImportReportOpen(true);
      }
      toast({
        title: t("adminCompanies.companySqliteImportFailed"),
        description: error instanceof Error ? error.message : t("common.requestFailed"),
      });
    } finally {
      setImportSubmitting(false);
    }
  }

  async function handleRotateWorkspaceKey(companyId: string, companyName: string) {
    if (!adminSession) return;
    setRotateSubmitting(true);
    try {
      const response = await api.rotateDeveloperAccessToken(adminSession.token, { companyId });
      setWorkspaceKeyValue(response.token);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(response.token);
        toast({ title: t("adminCompanies.workspaceKeyCopied") });
      }
      toast({ title: t("adminCompanies.workspaceKeyRotated", { companyName }) });
      await reloadAdminData();
    } catch (error) {
      toast({
        title: t("adminCompanies.workspaceKeyRotateFailed"),
        description: error instanceof Error ? error.message : t("common.requestFailed"),
      });
    } finally {
      setRotateSubmitting(false);
    }
  }

  return (
    <FormPage>
      <PageLoadBoundary
        intro={
          <PageIntro>
            <PageLabel title={t("adminCompanies.pageTitle")} description={t("adminCompanies.pageDescription")} />
            <PageActionBar>
              <PageActionBarActions>
                <PageActionButton type="button" onClick={() => void handleOpenMigrationSchemaDialog()}>
                  {t("adminCompanies.migrationSchemaButton")}
                </PageActionButton>
                <PageActionButton type="button" onClick={() => setInviteSheetOpen(true)}>
                  {t("adminCompanies.addInvitation")}
                </PageActionButton>
                <PageActionButton
                  type="button"
                  variant="default"
                  onClick={() => setCreateCompanySheetOpen(true)}
                >
                  {t("adminCompanies.addCompany")}
                </PageActionButton>
              </PageActionBarActions>
            </PageActionBar>
          </PageIntro>
        }
        loading={adminResource.isLoading}
        refreshing={adminResource.isRefreshing}
        skeleton={<PageLoadingState label={t("common.loading")} minHeightClassName="min-h-[28rem]" />}
      >
        <FormSection>
          <AdminSectionCard
            title={t("adminCompanies.companiesTitle")}
            description={t("adminCompanies.companiesDescription")}
          >
            {companies.length === 0 ? (
              <AdminEmptyState>{t("adminCompanies.noCompanies")}</AdminEmptyState>
            ) : (
              <AdminList>
                {companies.map((company) => (
                  <CompactCard
                    key={company.id}
                    title={company.name}
                    badges={[
                      { label: t("adminCompanies.createdAt", { value: formatAdminDate(company.createdAt) }) },
                    ]}
                    manageLabel={t("common.manage")}
                    onManage={() => {
                      setSelectedCompanyId(company.id);
                      setCompanySheetOpen(true);
                    }}
                  />
                ))}
              </AdminList>
            )}
          </AdminSectionCard>
        </FormSection>

        <FormSection>
          <AdminSectionCard
            title={t("adminCompanies.invitationsTitle")}
            description={t("adminCompanies.invitationsDescription")}
            footer={<p className="text-xs text-muted-foreground">{t("adminCompanies.activeInvitationCodes", { value: activeInvitationCodes.length })}</p>}
          >
            {invitationCodes.length === 0 ? (
              <AdminEmptyState>{t("adminCompanies.noInvitations")}</AdminEmptyState>
            ) : (
              <AdminList>
                {invitationCodes.map((code) => {
                  const badge = getInvitationBadge(code);
                  return (
                    <CompactCard
                      key={code.id}
                      title={code.code}
                      description={code.note || undefined}
                      badges={[
                        { label: t(badge.labelKey), className: badge.className },
                        { label: t("adminCompanies.createdAt", { value: formatAdminDate(code.createdAt) }) },
                      ]}
                      copyLabel={t("adminCompanies.copyInvitationCode")}
                      manageLabel={t("common.manage")}
                      onCopy={() => void handleCopyInvitationCode(code.code)}
                      onManage={() => {
                        setSelectedInvitation(code);
                        setInvitationManageOpen(true);
                      }}
                    />
                  );
                })}
              </AdminList>
            )}
          </AdminSectionCard>
        </FormSection>
      </PageLoadBoundary>

      <Sheet open={createCompanySheetOpen} onOpenChange={setCreateCompanySheetOpen}>
          <SheetContent side="right" className="w-[min(96vw,42rem)] max-w-none p-0">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-border px-6 py-5 pr-14">
                <SheetHeader>
                  <SheetTitle>{t("adminCompanies.createCompanySheetTitle")}</SheetTitle>
                  <SheetDescription>{t("adminCompanies.createCompanySheetDescription")}</SheetDescription>
                </SheetHeader>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-4">
                  <Input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder={t("adminCompanies.companyNamePlaceholder")} />
                  <FilePicker
                    label={t("adminCompanies.optionalSqliteImport")}
                    noSelectionLabel={t("adminCompanies.noFileSelected")}
                    multipleSelectionLabel={t("adminCompanies.filesSelected")}
                    buttonLabel={t("adminCompanies.attachFile")}
                    accept=".sqlite"
                    files={migrationFiles}
                    onFilesChange={setMigrationFiles}
                  />
                </div>
              </div>
              <div className="border-t border-border px-6 py-4">
                <SheetFooter className="flex w-full flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <SheetClose asChild>
                    <Button type="button" variant="outline" className="w-auto max-w-full">
                      {t("common.cancel")}
                    </Button>
                  </SheetClose>
                  <Button type="button" onClick={() => void handleCreateCompany()} disabled={createSubmitting} className="w-auto max-w-full">
                    {createSubmitting ? t("adminCompanies.creatingCompany") : t("adminCompanies.createCompany")}
                  </Button>
                </SheetFooter>
              </div>
            </div>
          </SheetContent>
      </Sheet>

      <Sheet open={inviteSheetOpen} onOpenChange={setInviteSheetOpen}>
          <SheetContent side="right" className="w-[min(96vw,40rem)] max-w-none p-0">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-border px-6 py-5 pr-14">
                <SheetHeader>
                  <SheetTitle>{t("adminCompanies.createInvitationSheetTitle")}</SheetTitle>
                  <SheetDescription>{t("adminCompanies.createInvitationSheetDescription")}</SheetDescription>
                </SheetHeader>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <Textarea
                  value={invitationNote}
                  onChange={(event) => setInvitationNote(event.target.value)}
                  placeholder={t("adminCompanies.optionalNotePlaceholder")}
                  className="min-h-28"
                />
              </div>
              <div className="border-t border-border px-6 py-4">
                <SheetFooter className="flex w-full flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <SheetClose asChild>
                    <Button type="button" variant="outline" className="w-auto max-w-full">
                      {t("common.cancel")}
                    </Button>
                  </SheetClose>
                  <Button type="button" onClick={() => void handleCreateInvitationCode()} disabled={inviteSubmitting} className="w-auto max-w-full">
                    {inviteSubmitting ? t("adminCompanies.creatingInvitation") : t("adminCompanies.generateInvitationCode")}
                  </Button>
                </SheetFooter>
              </div>
            </div>
          </SheetContent>
      </Sheet>

      <Sheet
          open={companySheetOpen}
          onOpenChange={(open) => {
            setCompanySheetOpen(open);
            if (!open) {
              setSelectedCompanyId(null);
              setImportFiles([]);
              setWorkspaceKeyValue(null);
            }
          }}
        >
          <SheetContent side="right" className="w-[min(96vw,42rem)] max-w-none p-0">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-border px-6 py-5 pr-14">
                <SheetHeader>
                  <SheetTitle>{selectedCompany?.name || t("adminCompanies.manageCompanySheetFallbackTitle")}</SheetTitle>
                  <SheetDescription>{t("adminCompanies.manageCompanySheetDescription")}</SheetDescription>
                </SheetHeader>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {selectedCompany ? (
                  <div className="flex flex-col gap-4">
                    <div className="rounded-lg border border-border bg-muted/20 p-4">
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-foreground">{t("adminCompanies.companySnapshotTitle")}</p>
                          <p className="text-xs text-muted-foreground">{t("adminCompanies.companySnapshotDescription")}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{t("adminCompanies.createdAt", { value: formatAdminDate(selectedCompany.createdAt) })}</Badge>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-background p-4">
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-foreground">{t("adminCompanies.workspaceKeyTitle")}</p>
                          <p className="text-xs text-muted-foreground">{t("adminCompanies.workspaceKeyDescription")}</p>
                        </div>
                        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
                          <div className="flex items-end gap-2">
                            <Input
                              readOnly
                              value={workspaceKeyValue ?? ""}
                              placeholder={t("adminCompanies.workspaceKeyPlaceholder")}
                              className="min-w-0 flex-1 font-mono text-xs"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className="shrink-0 gap-2 px-3"
                              onClick={() => void handleCopyWorkspaceKey()}
                              disabled={!workspaceKeyValue}
                              aria-label={t("adminCompanies.workspaceKeyCopyAriaLabel")}
                              title={t("adminCompanies.workspaceKeyCopyAriaLabel")}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="text-xs leading-5 text-muted-foreground">
                            {t("adminCompanies.workspaceKeyHint")}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="justify-start gap-2"
                          onClick={() => void handleRotateWorkspaceKey(selectedCompany.id, selectedCompany.name)}
                          disabled={rotateSubmitting}
                        >
                          <KeyRound className="h-4 w-4" />
                          {rotateSubmitting ? t("adminCompanies.rotatingWorkspaceKey") : t("adminCompanies.rotateWorkspaceKey")}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-background p-4">
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-foreground">{t("adminCompanies.sqlitePackageTitle")}</p>
                          <p className="text-xs text-muted-foreground">{t("adminCompanies.sqlitePackageDescription")}</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="justify-start gap-2"
                          onClick={() => void handleDownloadCompanyMigrationFile(selectedCompany.id, selectedCompany.name)}
                        >
                          <Download className="h-4 w-4" />
                          {t("adminCompanies.exportSqlite")}
                        </Button>
                        <FilePicker
                          label={t("adminCompanies.optionalSqliteImport")}
                          noSelectionLabel={t("adminCompanies.noFileSelected")}
                          multipleSelectionLabel={t("adminCompanies.filesSelected")}
                          buttonLabel={t("adminCompanies.attachFile")}
                          accept=".sqlite"
                          files={importFiles}
                          onFilesChange={setImportFiles}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="justify-start gap-2"
                          onClick={() => void handleImportCompanyMigrationFile(selectedCompany.id, selectedCompany.name)}
                          disabled={importFiles.length === 0 || importSubmitting}
                        >
                          <Upload className="h-4 w-4" />
                          {importSubmitting ? t("adminCompanies.importingSqlite") : t("adminCompanies.importSqlite")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="border-t border-border px-6 py-4">
                <SheetFooter className="flex w-full flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <SheetClose asChild>
                    <Button type="button" variant="outline" className="w-auto max-w-full">
                      {t("common.close")}
                    </Button>
                  </SheetClose>
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-auto max-w-full gap-2"
                    onClick={() => {
                      if (selectedCompany) {
                        setPendingDeleteCompany({ id: selectedCompany.id, name: selectedCompany.name });
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("adminCompanies.deleteCompany")}
                  </Button>
                </SheetFooter>
              </div>
            </div>
          </SheetContent>
      </Sheet>

      <Sheet
          open={invitationManageOpen}
          onOpenChange={(open) => {
            setInvitationManageOpen(open);
            if (!open) {
              setSelectedInvitation(null);
            }
          }}
        >
          <SheetContent side="right" className="w-[min(96vw,40rem)] max-w-none p-0">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-border px-6 py-5 pr-14">
                <SheetHeader>
                  <SheetTitle>{selectedInvitation ? selectedInvitation.code : t("adminCompanies.manageInvitationSheetFallbackTitle")}</SheetTitle>
                  <SheetDescription>{t("adminCompanies.manageInvitationSheetDescription")}</SheetDescription>
                </SheetHeader>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {selectedInvitation ? (
                  <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap gap-2">
                      <Badge className={getInvitationBadge(selectedInvitation).className}>{t(getInvitationBadge(selectedInvitation).labelKey)}</Badge>
                      <Badge variant="outline">{t("adminCompanies.createdAt", { value: formatAdminDate(selectedInvitation.createdAt) })}</Badge>
                    </div>
                    <Textarea readOnly value={selectedInvitation.note || t("adminCompanies.noInvitationNote")} className="min-h-28" />
                  </div>
                ) : null}
              </div>
              <div className="border-t border-border px-6 py-4">
                <SheetFooter className="flex w-full flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-auto max-w-full gap-2"
                    onClick={() => {
                      if (selectedInvitation) {
                        void handleDeleteInvitationCode(selectedInvitation.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("adminCompanies.deleteInvitation")}
                  </Button>
                  <SheetClose asChild>
                    <Button type="button" variant="outline" className="w-auto max-w-full">
                      {t("common.close")}
                    </Button>
                  </SheetClose>
                </SheetFooter>
              </div>
            </div>
          </SheetContent>
      </Sheet>

      <AppConfirmDialog
        open={pendingDeleteCompany !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteCompany(null);
          }
        }}
        title={pendingDeleteCompany ? t("adminCompanies.deleteCompanyConfirmTitle", { name: pendingDeleteCompany.name }) : t("adminCompanies.deleteCompanyConfirmFallbackTitle")}
        description={t("adminCompanies.deleteCompanyConfirmDescription")}
        confirmLabel={t("adminCompanies.deleteCompany")}
        destructive
        confirming={deleteSubmitting}
        onConfirm={() => {
          if (pendingDeleteCompany) {
            void handleDeleteCompany(pendingDeleteCompany.id);
          }
        }}
      />

      <Dialog
        open={migrationSchemaDialogOpen}
        onOpenChange={(open) => {
          setMigrationSchemaDialogOpen(open);
          if (!open) {
            setMigrationSchemaJson("");
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("adminCompanies.migrationSchemaTitle")}</DialogTitle>
            <DialogDescription>{t("adminCompanies.migrationSchemaDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Textarea
              readOnly
              value={migrationSchemaSubmitting ? t("adminCompanies.loadingMigrationSchema") : migrationSchemaJson}
              className="min-h-[24rem] font-mono text-xs leading-5"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="gap-2" onClick={() => void handleCopyMigrationSchema()} disabled={!migrationSchemaJson}>
              <Copy className="h-4 w-4" />
              {t("adminCompanies.copyJson")}
            </Button>
            <Button type="button" className="gap-2" onClick={handleDownloadMigrationSchemaJson} disabled={!migrationSchemaJson}>
              <Download className="h-4 w-4" />
              {t("adminCompanies.downloadJson")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importReportOpen}
        onOpenChange={(open) => {
          setImportReportOpen(open);
          if (!open) {
            setImportReport(null);
            setImportReportJson("");
          }
        }}
      >
        <DialogContent className="w-[min(96vw,56rem)] max-w-none">
          <DialogHeader>
            <DialogTitle>
              {importReport?.success
                ? t("adminCompanies.companySqliteImported", { companyName: importReport.companyName || "company" })
                : t("adminCompanies.companySqliteImportFailed")}
            </DialogTitle>
            <DialogDescription>
              {importReport?.success
                ? "Import completed. The full validation result is shown as JSON below."
                : "Import failed. The full report is shown as JSON below."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant={importReport?.success ? "outline" : "destructive"}>{importReport?.success ? "success" : "failed"}</Badge>
              <Badge variant="outline">{`tables: ${importReport?.tableCount ?? 0}`}</Badge>
              <Badge variant="outline">{`rows: ${importReport?.rowCount ?? 0}`}</Badge>
              <Badge variant="outline">{`warnings: ${importReport?.warnings.length ?? 0}`}</Badge>
              <Badge variant="outline">{`errors: ${importReport?.errors.length ?? 0}`}</Badge>
            </div>

            <Textarea
              readOnly
              value={importReportJson || (importReport ? JSON.stringify(importReport, null, 2) : "")}
              className="min-h-[30rem] font-mono text-xs leading-5"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={async () => {
                try {
                  if (!importReportJson) return;
                  if (!navigator.clipboard?.writeText) {
                    throw new Error(t("common.clipboardUnavailable"));
                  }
                  await navigator.clipboard.writeText(importReportJson);
                  toast({ title: t("adminCompanies.migrationSchemaCopied") });
                } catch {
                  toast({ title: t("common.clipboardUnavailableMessage") });
                }
              }}
              disabled={!importReportJson}
            >
              <Copy className="h-4 w-4" />
              {t("adminCompanies.copyJson")}
            </Button>
            <Button
              type="button"
              className="gap-2"
              onClick={() => {
                if (!importReportJson) return;
                const blob = new Blob([importReportJson], { type: "application/json" });
                const url = window.URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "company-migration-import-report.json";
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
                window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
              }}
              disabled={!importReportJson}
            >
              <Download className="h-4 w-4" />
              {t("adminCompanies.downloadJson")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </FormPage>
  );
}
