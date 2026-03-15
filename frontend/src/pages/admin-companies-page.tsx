import { useEffect, useState } from "react";
import { Download, ShieldPlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CompanyRecord, SystemStats } from "@shared/types/models";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function AdminCompaniesPage() {
  const { t } = useTranslation();
  const { adminSession } = useAuth();
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [newAdmin, setNewAdmin] = useState({ companyId: 0, username: "", password: "", fullName: "" });
  const [pendingDeleteCompany, setPendingDeleteCompany] = useState<CompanyRecord | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const statItems = [
    { label: t("adminCompanies.stats.companies"), value: stats?.companyCount ?? 0 },
    { label: t("adminCompanies.stats.admins"), value: stats?.adminCount ?? 0 },
    { label: t("adminCompanies.stats.users"), value: stats?.totalUsers ?? 0 },
    { label: t("adminCompanies.stats.activeTimers"), value: stats?.activeTimers ?? 0 }
  ];

  async function load() {
    if (!adminSession) return;
    try {
      const [companyResponse, statsResponse] = await Promise.all([
        api.listCompanies(adminSession.token),
        api.getSystemStats(adminSession.token)
      ]);
      setCompanies(companyResponse.companies);
      setStats(statsResponse.stats);
    } catch (error) {
      toast({
        title: t("adminCompanies.loadFailed"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  useEffect(() => {
    void load();
  }, [adminSession]);

  async function removeCompany(companyId: number) {
    if (!adminSession) return;
    setDeleteSubmitting(true);
    try {
      await api.deleteCompany(adminSession.token, { companyId });
      setPendingDeleteCompany(null);
      toast({ title: t("adminCompanies.companyDeleted") });
      await load();
    } catch (error) {
      toast({
        title: t("adminCompanies.companyDeleteFailed"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function downloadCompanyDb(company: CompanyRecord) {
    if (!adminSession) return;
    try {
      const { blob, fileName } = await api.downloadCompanyDb(adminSession.token, company.id);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
      toast({ title: t("adminCompanies.databaseDownloaded") });
    } catch (error) {
      toast({
        title: t("adminCompanies.databaseDownloadFailed"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  async function createAdmin() {
    if (!adminSession) return;
    try {
      await api.createCompanyAdmin(adminSession.token, newAdmin);
      setNewAdmin({ companyId: 0, username: "", password: "", fullName: "" });
      toast({ title: t("adminCompanies.companyAdminCreated") });
    } catch (error) {
      toast({
        title: t("adminCompanies.companyAdminCreateFailed"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  return (
    <div className="space-y-6">
      <Dialog open={pendingDeleteCompany !== null} onOpenChange={(open) => !open && setPendingDeleteCompany(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminCompanies.deleteDialogTitle")}</DialogTitle>
            <DialogDescription>
              {pendingDeleteCompany
                ? t("adminCompanies.deleteDialogDescription", { name: pendingDeleteCompany.name })
                : t("adminCompanies.deleteDialogTitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setPendingDeleteCompany(null)} disabled={deleteSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDeleteCompany && void removeCompany(pendingDeleteCompany.id)}
              disabled={deleteSubmitting}
            >
              {deleteSubmitting ? t("adminCompanies.deleting") : t("common.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/80 bg-muted/30">
          <CardTitle>{t("adminCompanies.overviewTitle")}</CardTitle>
          <CardDescription>{t("adminCompanies.overviewDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
          {statItems.map((item) => (
            <div key={item.label} className="flex items-baseline gap-1.5 text-xs">
              <p className="truncate text-[10px] text-muted-foreground">{item.label}</p>
              <p className="text-sm font-semibold tracking-[-0.02em] text-foreground">{item.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("adminCompanies.managementTitle")}</CardTitle>
          <CardDescription>{t("adminCompanies.managementDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {companies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground">
              {t("adminCompanies.noCompanies")}
            </div>
          ) : (
            <TooltipProvider delayDuration={120}>
              {companies.map((company) => (
                <div
                  key={company.id}
                  className="flex items-center gap-2 rounded-xl border border-border bg-muted/15 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="truncate text-xs font-semibold tracking-[-0.02em] text-foreground sm:text-sm">{company.name}</h3>
                      <p className="shrink-0 text-[10px] text-muted-foreground">{t("adminCompanies.createdAt", { value: new Date(company.createdAt).toLocaleString() })}</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                          onClick={() => void downloadCompanyDb(company)}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("adminCompanies.downloadDatabase")}</TooltipContent>
                    </Tooltip>

                    <Dialog>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                              onClick={() => setNewAdmin((current) => ({ ...current, companyId: company.id }))}
                            >
                              <ShieldPlus className="h-3.5 w-3.5" />
                            </Button>
                          </DialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent>{t("adminCompanies.addAdmin")}</TooltipContent>
                      </Tooltip>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("adminCompanies.createCompanyAdmin")}</DialogTitle>
                          <DialogDescription>{t("adminCompanies.createCompanyAdminDescription")}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <Input placeholder={t("common.fullName")} value={newAdmin.fullName} onChange={(event) => setNewAdmin((current) => ({ ...current, fullName: event.target.value }))} />
                          <Input placeholder={t("common.username")} value={newAdmin.username} onChange={(event) => setNewAdmin((current) => ({ ...current, username: event.target.value }))} />
                          <Input type="password" placeholder={t("common.password")} value={newAdmin.password} onChange={(event) => setNewAdmin((current) => ({ ...current, password: event.target.value }))} />
                          <Button className="w-full" onClick={() => void createAdmin()}>
                            {t("adminCompanies.createAdmin")}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-full text-destructive hover:text-destructive"
                          onClick={() => setPendingDeleteCompany(company)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("common.delete")}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
