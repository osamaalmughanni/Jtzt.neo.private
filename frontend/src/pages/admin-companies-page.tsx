import { useEffect, useState } from "react";
import type { CompanyRecord, SystemStats } from "@shared/types/models";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function AdminCompaniesPage() {
  const { adminSession } = useAuth();
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [newAdmin, setNewAdmin] = useState({ companyId: 0, username: "", password: "", fullName: "" });
  const statItems = [
    { label: "Companies", value: stats?.companyCount ?? 0 },
    { label: "System admins", value: stats?.adminCount ?? 0 },
    { label: "Company users", value: stats?.totalUsers ?? 0 },
    { label: "Active timers", value: stats?.activeTimers ?? 0 }
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
        title: "Could not load companies",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  useEffect(() => {
    void load();
  }, [adminSession]);

  async function removeCompany(companyId: number) {
    if (!adminSession) return;
    try {
      await api.deleteCompany(adminSession.token, { companyId });
      toast({ title: "Company deleted" });
      await load();
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  async function resetCompany(companyId: number) {
    if (!adminSession) return;
    try {
      await api.resetCompany(adminSession.token, { companyId });
      toast({ title: "Company database reset" });
      await load();
    } catch (error) {
      toast({
        title: "Reset failed",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  function confirmReset(company: CompanyRecord) {
    const confirmed = window.confirm(`Reset the database for "${company.name}"? This will remove company data and cannot be undone.`);
    if (!confirmed) return;
    void resetCompany(company.id);
  }

  function confirmDelete(company: CompanyRecord) {
    const confirmed = window.confirm(`Delete "${company.name}"? This action cannot be undone.`);
    if (!confirmed) return;
    void removeCompany(company.id);
  }

  async function createAdmin() {
    if (!adminSession) return;
    try {
      await api.createCompanyAdmin(adminSession.token, newAdmin);
      setNewAdmin({ companyId: 0, username: "", password: "", fullName: "" });
      toast({ title: "Company admin created" });
    } catch (error) {
      toast({
        title: "Could not create company admin",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/80 bg-muted/30">
          <CardTitle>System overview</CardTitle>
          <CardDescription>All company totals in one place, without splitting the page into separate stat boxes.</CardDescription>
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
          <CardTitle>Companies management</CardTitle>
          <CardDescription>Simple vertical cards with actions grouped under each company for easier scanning on desktop and mobile.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {companies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground">
              No companies available yet.
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
                    <p className="text-[11px] text-muted-foreground">Created {new Date(company.createdAt).toLocaleString()}</p>
                  </div>

                  <div className="rounded-lg border border-border/80 bg-background px-3 py-2">
                    <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Database path</p>
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
                          Add admin
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Create company admin</DialogTitle>
                          <DialogDescription>Add another company-level administrator for this tenant.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <Input placeholder="Full name" value={newAdmin.fullName} onChange={(event) => setNewAdmin((current) => ({ ...current, fullName: event.target.value }))} />
                          <Input placeholder="Username" value={newAdmin.username} onChange={(event) => setNewAdmin((current) => ({ ...current, username: event.target.value }))} />
                          <Input type="password" placeholder="Password" value={newAdmin.password} onChange={(event) => setNewAdmin((current) => ({ ...current, password: event.target.value }))} />
                          <Button className="w-full" onClick={() => void createAdmin()}>
                            Create admin
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-full justify-center rounded-lg px-3 text-[11px] sm:text-xs"
                      onClick={() => confirmReset(company)}
                    >
                      Reset DB
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8 w-full justify-center rounded-lg px-3 text-[11px] sm:text-xs"
                      onClick={() => confirmDelete(company)}
                    >
                      Delete
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
