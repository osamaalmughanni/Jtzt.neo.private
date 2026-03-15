import { useEffect, useState } from "react";
import type { ProjectRecord, TimeEntryView } from "@shared/types/models";
import { formatMinutes } from "@shared/utils/time";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export function TimePage() {
  const { companySession } = useAuth();
  const [entries, setEntries] = useState<TimeEntryView[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [notes, setNotes] = useState("");
  const [projectId, setProjectId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  async function loadEntries() {
    if (!companySession) return;
    try {
      const response = await api.listTimeEntries(companySession.token, {
        from: fromDate ? new Date(fromDate).toISOString() : undefined
      });
      setEntries(response.entries);
    } catch (error) {
      toast({
        title: "Could not load entries",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  useEffect(() => {
    if (!companySession) return;
    void loadEntries();
    void api
      .listProjects(companySession.token)
      .then((response) => setProjects(response.projects))
      .catch((error) =>
        toast({
          title: "Could not load projects",
          description: error instanceof Error ? error.message : "Request failed"
        })
      );
  }, [companySession, fromDate]);

  const activeEntry = entries.find((entry) => !entry.endTime);

  async function handleStart() {
    if (!companySession) return;
    try {
      await api.startTimer(companySession.token, {
        notes,
        projectId: projectId ? Number(projectId) : null
      });
      setNotes("");
      setProjectId("");
      toast({ title: "Timer started" });
      await loadEntries();
    } catch (error) {
      toast({
        title: "Could not start timer",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  async function handleStop() {
    if (!companySession || !activeEntry) return;
    try {
      await api.stopTimer(companySession.token, { entryId: activeEntry.id, notes });
      setNotes("");
      toast({ title: "Timer stopped" });
      await loadEntries();
    } catch (error) {
      toast({
        title: "Could not stop timer",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  async function saveEntry(entry: TimeEntryView) {
    if (!companySession) return;
    try {
      await api.updateTimeEntry(companySession.token, {
        entryId: entry.id,
        startTime: entry.startTime,
        endTime: entry.endTime,
        notes: entry.notes,
        projectId: entry.projectId
      });
      setEditingId(null);
      toast({ title: "Entry updated" });
      await loadEntries();
    } catch (error) {
      toast({
        title: "Could not update entry",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  return (
    <div>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{activeEntry ? "Stop running timer" : "Start a new timer"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Project</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Notes</label>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What are you working on?" />
            </div>
            {activeEntry ? (
              <Button className="w-full" onClick={() => void handleStop()}>
                Stop timer
              </Button>
            ) : (
              <Button className="w-full" onClick={() => void handleStart()}>
                Start timer
              </Button>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="history" className="w-full">
          <TabsList>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
          </TabsList>
          <TabsContent value="history">
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Entries</CardTitle>
                <Input className="max-w-xs" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <Input
                            type="datetime-local"
                            value={entry.startTime.slice(0, 16)}
                            onChange={(event) =>
                              setEntries((current) =>
                                current.map((candidate) =>
                                  candidate.id === entry.id ? { ...candidate, startTime: new Date(event.target.value).toISOString() } : candidate
                                )
                              )
                            }
                            disabled={editingId !== entry.id}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="datetime-local"
                            value={entry.endTime ? entry.endTime.slice(0, 16) : ""}
                            onChange={(event) =>
                              setEntries((current) =>
                                current.map((candidate) =>
                                  candidate.id === entry.id
                                    ? { ...candidate, endTime: event.target.value ? new Date(event.target.value).toISOString() : null }
                                    : candidate
                                )
                              )
                            }
                            disabled={editingId !== entry.id}
                          />
                        </TableCell>
                        <TableCell>{entry.projectName ?? "Unassigned"}</TableCell>
                        <TableCell>
                          <Input
                            value={entry.notes}
                            onChange={(event) =>
                              setEntries((current) =>
                                current.map((candidate) => (candidate.id === entry.id ? { ...candidate, notes: event.target.value } : candidate))
                              )
                            }
                            disabled={editingId !== entry.id}
                          />
                        </TableCell>
                        <TableCell>{formatMinutes(entry.durationMinutes)}</TableCell>
                        <TableCell className="text-right">
                          {editingId === entry.id ? (
                            <Button size="sm" onClick={() => void saveEntry(entry)}>
                              Save
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setEditingId(entry.id)}>
                              Edit
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="active">
            <Card>
              <CardHeader>
                <CardTitle>Current status</CardTitle>
              </CardHeader>
              <CardContent>
                {activeEntry ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Started at {new Date(activeEntry.startTime).toLocaleString()}</p>
                    <p className="text-lg font-semibold">{activeEntry.notes || "Current session"}</p>
                    <p className="text-sm">Project: {activeEntry.projectName ?? "Unassigned"}</p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No timer is currently running.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
