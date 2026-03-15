import { useEffect, useState } from "react";
import type { DashboardSummary } from "@shared/types/models";
import { formatMinutes } from "@shared/utils/time";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function DashboardPage() {
  const { companySession } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    if (!companySession) return;
    void api.getDashboard(companySession.token).then((response) => setSummary(response.summary));
  }, [companySession]);

  return (
    <div>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardDescription>Today</CardDescription>
            <CardTitle>{summary ? formatMinutes(summary.todayMinutes) : "--"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>This week</CardDescription>
            <CardTitle>{summary ? formatMinutes(summary.weekMinutes) : "--"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Active timer</CardDescription>
            <CardTitle>{summary?.activeEntry ? "Running" : "Stopped"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {summary?.activeEntry ? summary.activeEntry.notes || "Current session" : "No active session"}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent entries</CardTitle>
          <CardDescription>Your latest tracked sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary?.recentEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{new Date(entry.startTime).toLocaleString()}</TableCell>
                  <TableCell>{entry.endTime ? new Date(entry.endTime).toLocaleString() : "Running"}</TableCell>
                  <TableCell>{entry.projectName ?? "Unassigned"}</TableCell>
                  <TableCell>{formatMinutes(entry.durationMinutes)}</TableCell>
                  <TableCell>{entry.notes || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
