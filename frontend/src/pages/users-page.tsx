import { useEffect, useState } from "react";
import type { CompanyUserListItem } from "@shared/types/models";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function UsersPage() {
  const { companySession } = useAuth();
  const [users, setUsers] = useState<CompanyUserListItem[]>([]);

  useEffect(() => {
    if (!companySession) return;
    void api
      .listUsers(companySession.token)
      .then((response) => setUsers(response.users))
      .catch((error) =>
        toast({
          title: "Could not load users",
          description: error instanceof Error ? error.message : "Request failed"
        })
      );
  }, [companySession]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>User list</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.fullName}</TableCell>
                  <TableCell>{user.username}</TableCell>
                  <TableCell>{user.role}</TableCell>
                  <TableCell>{new Date(user.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
