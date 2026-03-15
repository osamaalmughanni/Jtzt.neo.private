import { useEffect, useMemo, useState } from "react";
import { formatMinutes } from "@shared/utils/time";
import type { TimeEntryView } from "@shared/types/models";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function toDayKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

export function CalendarPage() {
  const { companySession } = useAuth();
  const [entries, setEntries] = useState<TimeEntryView[]>([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    if (!companySession) return;
    const [year, monthPart] = month.split("-").map(Number);
    const from = new Date(year, monthPart - 1, 1).toISOString();
    const to = new Date(year, monthPart, 0, 23, 59, 59).toISOString();
    void api.listTimeEntries(companySession.token, { from, to }).then((response) => setEntries(response.entries));
  }, [companySession, month]);

  const summary = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      const key = toDayKey(entry.startTime);
      map.set(key, (map.get(key) ?? 0) + entry.durationMinutes);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Month</CardTitle>
        </CardHeader>
        <CardContent>
          <input
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Daily totals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {summary.length ? (
            summary.map(([day, minutes]) => (
              <div key={day} className="flex items-center justify-between rounded-xl border border-border p-4">
                <span>{day}</span>
                <span className="font-medium">{formatMinutes(minutes)}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No entries for this month.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
