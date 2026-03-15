import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CompanyRecord, SystemStats } from "@shared/types/models";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function AdminCompaniesPage() {
  const { t } = useTranslation();
  const { adminSession } = useAuth();
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [newAdmin, setNewAdmin] = useState({ companyId: 0, username: "", password: "", fullName: "" });
  const [pendingResetCompany, setPendingResetCompany] = useState<CompanyRecord | null>(null);
  const [pendingDeleteCompany, setPendingDeleteCompany] = useState<CompanyRecord | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
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

  async function resetCompany(companyId: number) {
    if (!adminSession) return;
    setResetSubmitting(true);
    try {
      await api.resetCompany(adminSession.token, { companyId });
      setPendingResetCompany(null);
      toast({ title: t("adminCompanies.companyReset") });
      await load();
    } catch (error) {
      toast({
        title: t("adminCompanies.companyResetFailed"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setResetSubmitting(false);
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
      <Dialog open={pendingResetCompany !== null} onOpenChange={(open) => !open && setPendingResetCompany(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminCompanies.resetDialogTitle")}</DialogTitle>
            <DialogDescription>
              {pendingResetCompany
                ? t("adminCompanies.resetDialogDescription", { name: pendingResetCompany.name })
                : t("adminCompanies.resetDialogTitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setPendingResetCompany(null)} disabled={resetSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => pendingResetCompany && void resetCompany(pendingResetCompany.id)}
              disabled={resetSubmitting}
            >
              {resetSubmitting ? t("adminCompanies.resetting") : t("common.resetDb")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
        <CardContent className="grid p-0 sm:grid-cols-2 xl:grid-cols-4">
          {statItems.map((item, index) => (
            <div
              key={item.label}
              className={`flex min-h-[88px] flex-col justify-between px-4 py-3 sm:px-5 sm:py-4 ${
                index < statItems.length - 1 ? "border-b border-border/70 xl:border-b-0 xl:border-r" : ""
              } ${index === 1 ? "sm:border-b-0 sm:border-r xl:border-r" : ""} ${index === 2 ? "xl:border-r" : ""}`}
            >
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{item.label}</span>
              <span className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{item.value}</span>
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
            companies.map((company) => (
              <div
                key={company.id}
                className="rounded-xl border border-border bg-muted/15 p-3 sm:p-4"
              >
                <div className="space-y-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold tracking-[-0.02em] sm:text-base">{company.name}</h3>
                    <p className="text-[11px] text-muted-foreground">{t("adminCompanies.createdAt", { value: new Date(company.createdAt).toLocaleString() })}</p>
                  </div>

                  <div className="rounded-lg border border-border/80 bg-background px-3 py-2">
                    <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("adminCompanies.databasePath")}</p>
                    <p className="mt-1 break-all text-[11px] leading-5 text-foreground sm:text-xs">{company.databasePath}</p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-full justify-center rounded-lg px-3 text-[11px] sm:text-xs"
                          onClick={() => setNewAdmin((current) => ({ ...current, companyId: company.id }))}
                        >
                          {t("adminCompanies.addAdmin")}
                        </Button>
                      </DialogTrigger>
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
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-full justify-center rounded-lg px-3 text-[11px] sm:text-xs"
                      onClick={() => setPendingResetCompany(company)}
                    >
                      {t("common.resetDb")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8 w-full justify-center rounded-lg px-3 text-[11px] sm:text-xs"
                      onClick={() => setPendingDeleteCompany(company)}
                    >
                      {t("common.delete")}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
