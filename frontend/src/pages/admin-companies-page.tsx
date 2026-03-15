import { useEffect, useState } from "react";
import type { CompanyRecord, SystemStats } from "@shared/types/models";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function AdminCompaniesPage() {
  const { adminSession } = useAuth();
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [newAdmin, setNewAdmin] = useState({ companyId: 0, username: "", password: "", fullName: "" });

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
    <div>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>{stats?.companyCount ?? 0}</CardTitle></CardHeader>
          <CardContent>Companies</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{stats?.adminCount ?? 0}</CardTitle></CardHeader>
          <CardContent>System admins</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{stats?.totalUsers ?? 0}</CardTitle></CardHeader>
          <CardContent>Company users</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{stats?.activeTimers ?? 0}</CardTitle></CardHeader>
          <CardContent>Active timers</CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Companies</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Database path</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>{company.name}</TableCell>
                  <TableCell className="max-w-xs truncate">{company.databasePath}</TableCell>
                  <TableCell>{new Date(company.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" onClick={() => setNewAdmin((current) => ({ ...current, companyId: company.id }))}>
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
                          <Button onClick={() => void createAdmin()}>Create admin</Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Button size="sm" variant="secondary" onClick={() => void resetCompany(company.id)}>
                      Reset DB
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => void removeCompany(company.id)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
