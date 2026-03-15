import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  CompanySettings,
  CompanyUserListItem,
  ProjectRecord,
  PublicHolidayRecord,
  SickLeaveAttachment,
  TaskRecord,
  TimeEntryType,
} from "@shared/types/models";
import { Field, FieldCombobox, FormActions, FormFields, FormPage, FormPanel, FormSection } from "@/components/form-layout";
import { PageBackAction } from "@/components/page-back-action";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimeInput } from "@/components/ui/time-input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

const defaultSettings: CompanySettings = {
  trackingMode: "time",
  recordType: "start_finish",
  currency: "EUR",
  locale: "en-GB",
  firstDayOfWeek: 1,
  editDaysLimit: 30,
  insertDaysLimit: 30,
  country: "AT",
};

const entryTypeTabs: Array<{ value: TimeEntryType; label: string }> = [
  { value: "work", label: "Working" },
  { value: "vacation", label: "Vacation" },
  { value: "sick_leave", label: "Sick leave" },
];

function combineDateAndTime(day: string, timeValue: string) {
  const [hours, minutes] = timeValue.split(":").map(Number);
  const next = new Date(`${day}T00:00:00`);
  next.setHours(hours, minutes, 0, 0);
  return next.toISOString();
}

function toTimeInputValue(isoValue: string | null) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function canManageOtherUsers(role: string | undefined) {
  return role === "admin" || role === "manager";
}

function parseDayParam(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date().toISOString().slice(0, 10);
  return value;
}

function enumerateYears(startDate: string, endDate: string) {
  const years = new Set<number>();
  let year = Number(startDate.slice(0, 4));
  const finalYear = Number(endDate.slice(0, 4));
  while (year <= finalYear) {
    years.add(year);
    year += 1;
  }
  return Array.from(years);
}

function findHolidayInRange(holidays: PublicHolidayRecord[], startDate: string, endDate: string) {
  return holidays.find((holiday) => holiday.date >= startDate && holiday.date <= endDate) ?? null;
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function compressImageFile(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not load image"));
    image.src = dataUrl;
  });

  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process image");
  context.drawImage(image, 0, 0, width, height);
  const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  if (compressedDataUrl.length > 8_000_000) {
    throw new Error("Compressed image is still too large");
  }

  return {
    fileName: file.name.replace(/\.[^.]+$/, ".jpg"),
    mimeType: "image/jpeg",
    dataUrl: compressedDataUrl
  };
}

async function prepareSickLeaveAttachment(file: File): Promise<SickLeaveAttachment> {
  if (file.type.startsWith("image/")) {
    return compressImageFile(file);
  }

  if (file.size > 6 * 1024 * 1024) {
    throw new Error("PDF must be 6 MB or smaller");
  }

  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    dataUrl: await readFileAsDataUrl(file)
  };
}

interface DashboardRecordEditorPageProps {
  mode: "create" | "edit";
}

export function DashboardRecordEditorPage({ mode }: DashboardRecordEditorPageProps) {
  const navigate = useNavigate();
  const { entryId } = useParams();
  const { companySession, companyIdentity } = useAuth();
  const [searchParams] = useSearchParams();
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
  const [users, setUsers] = useState<CompanyUserListItem[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [entryType, setEntryType] = useState<TimeEntryType>("work");
  const [startDate, setStartDate] = useState(parseDayParam(searchParams.get("day")));
  const [endDate, setEndDate] = useState(parseDayParam(searchParams.get("day")));
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [notes, setNotes] = useState("");
  const [sickLeaveAttachment, setSickLeaveAttachment] = useState<SickLeaveAttachment | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(mode === "edit");
  const [holidays, setHolidays] = useState<PublicHolidayRecord[]>([]);

  const canSwitchUser = canManageOtherUsers(companyIdentity?.user.role);
  const selectedDay = parseDayParam(searchParams.get("day"));
  const effectiveUserId = Number(searchParams.get("user") ?? companyIdentity?.user.id ?? 0) || companyIdentity?.user.id || 0;
  const backTo = `/dashboard?user=${effectiveUserId}&day=${selectedDay}`;
  const showProjectField = entryType === "work" && (settings.trackingMode === "project" || settings.trackingMode === "project_and_tasks");
  const showTaskField = entryType === "work" && settings.trackingMode === "project_and_tasks";
  const usesDateRange = entryType === "vacation" || entryType === "sick_leave";

  const filteredTasks = useMemo(
    () => tasks.filter((task) => (projectId ? task.projectId === Number(projectId) : true)),
    [projectId, tasks],
  );

  const selectedUserName =
    users.find((user) => user.id === effectiveUserId)?.fullName ?? companyIdentity?.user.fullName ?? "User";
  const projectOptions = projects.map((project) => ({ value: String(project.id), label: project.name }));
  const taskOptions = filteredTasks.map((task) => ({ value: String(task.id), label: task.title }));
  const resolvedEndDate = usesDateRange ? endDate : startDate;
  const rangeHoliday = findHolidayInRange(holidays, startDate, resolvedEndDate);

  useEffect(() => {
    if (!companySession) return;

    void api.getSettings(companySession.token).then((response) => setSettings(response.settings)).catch(() => undefined);
    void api
      .listProjects(companySession.token)
      .then((response) => {
        setProjects(response.projects);
        setTasks(response.tasks);
      })
      .catch(() => undefined);

    if (!canSwitchUser) return;
    void api.listUsers(companySession.token).then((response) => setUsers(response.users)).catch(() => undefined);
  }, [canSwitchUser, companySession]);

  useEffect(() => {
    if (!companySession || settings.country.length !== 2) return;
    const nextYears = enumerateYears(startDate, resolvedEndDate);
    void Promise.all(nextYears.map((year) => api.getPublicHolidays(companySession.token, settings.country, year)))
      .then((responses) => setHolidays(responses.flatMap((response) => response.holidays)))
      .catch(() => setHolidays([]));
  }, [companySession, resolvedEndDate, settings.country, startDate]);

  useEffect(() => {
    if (mode !== "edit" || !companySession || !entryId || !effectiveUserId) return;

    setLoading(true);
    void api
      .getTimeEntry(companySession.token, Number(entryId), canSwitchUser ? effectiveUserId : undefined)
      .then((response) => {
        setEntryType(response.entry.entryType);
        setStartDate(response.entry.entryDate);
        setEndDate(response.entry.endDate ?? response.entry.entryDate);
        setStartTime(toTimeInputValue(response.entry.startTime));
        setEndTime(toTimeInputValue(response.entry.endTime));
        setProjectId(response.entry.projectId ? String(response.entry.projectId) : "");
        setTaskId(response.entry.taskId ? String(response.entry.taskId) : "");
        setNotes(response.entry.notes);
        setSickLeaveAttachment(response.entry.sickLeaveAttachment);
      })
      .catch((error) =>
        toast({
          title: "Could not load record",
          description: error instanceof Error ? error.message : "Request failed",
        }),
      )
      .finally(() => setLoading(false));
  }, [canSwitchUser, companySession, effectiveUserId, entryId, mode]);

  useEffect(() => {
    if (entryType !== "work") {
      setProjectId("");
      setTaskId("");
      setStartTime("");
      setEndTime("");
    }

    if (entryType !== "sick_leave") {
      setSickLeaveAttachment(null);
    }

    if (!usesDateRange) {
      setEndDate(startDate);
    }
  }, [entryType, startDate, usesDateRange]);

  async function handleSave() {
    if (!companySession || !effectiveUserId) return;

    try {
      if (resolvedEndDate < startDate) throw new Error("End date must be on or after start date");
      if (rangeHoliday) throw new Error(`Records are not allowed on ${rangeHoliday.localName} (${rangeHoliday.date})`);
      if (entryType === "work") {
        if (!startTime) throw new Error("Start time is required");
        if (!endTime) throw new Error("End time is required");
      }

      const payload =
        entryType === "work"
          ? {
              entryType,
              startDate,
              endDate: null,
              startTime: combineDateAndTime(startDate, startTime),
              endTime: combineDateAndTime(startDate, endTime),
              notes,
              projectId: showProjectField && projectId ? Number(projectId) : null,
              taskId: showTaskField && taskId ? Number(taskId) : null,
              sickLeaveAttachment: null,
            }
          : {
              entryType,
              startDate,
              endDate: usesDateRange ? resolvedEndDate : null,
              startTime: null,
              endTime: null,
              notes,
              projectId: null,
              taskId: null,
              sickLeaveAttachment: entryType === "sick_leave" ? sickLeaveAttachment : null,
            };

      setSaving(true);

      if (mode === "create") {
        await api.createManualTimeEntry(companySession.token, {
          targetUserId: canSwitchUser ? effectiveUserId : undefined,
          ...payload,
        });
        toast({ title: "Entry added" });
      } else {
        await api.updateTimeEntry(companySession.token, {
          entryId: Number(entryId),
          targetUserId: canSwitchUser ? effectiveUserId : undefined,
          ...payload,
        });
        toast({ title: "Entry saved" });
      }

      navigate(backTo);
    } catch (error) {
      toast({
        title: mode === "create" ? "Could not add entry" : "Could not save entry",
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleAttachmentChange(file: File | null) {
    if (!file) return;
    try {
      const nextAttachment = await prepareSickLeaveAttachment(file);
      setSickLeaveAttachment(nextAttachment);
    } catch (error) {
      toast({
        title: "Could not prepare attachment",
        description: error instanceof Error ? error.message : "Request failed",
      });
    }
  }

  return (
    <FormPage>
      <PageBackAction to={backTo} label="Back to overview" />
      <PageLabel title={mode === "create" ? "Add entry" : "Edit entry"} description={`${selectedUserName} in overview context`} />
      <FormPanel>
        {loading ? <p className="text-sm text-muted-foreground">Loading entry...</p> : null}
        {rangeHoliday ? (
          <div className="rounded-2xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            {rangeHoliday.localName} on {rangeHoliday.date}. Entries are blocked on public holidays.
          </div>
        ) : null}

        <FormSection>
          <Tabs value={entryType} onValueChange={(value) => setEntryType(value as TimeEntryType)}>
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-2xl bg-muted p-1">
              {entryTypeTabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="rounded-xl px-3 py-2">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </FormSection>

        <FormSection>
          <FormFields>
            <Field label={usesDateRange ? "From date" : "Date"}>
              <DateInput value={startDate} locale={settings.locale} onChange={setStartDate} />
            </Field>
            {usesDateRange ? (
              <Field label="To date">
                <DateInput value={endDate} locale={settings.locale} onChange={setEndDate} />
              </Field>
            ) : null}
            {entryType === "work" ? (
              <>
                <Field label="Start time">
                  <TimeInput
                    placeholder="08:00"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    onNowClick={setStartTime}
                  />
                </Field>
                <Field label="End time">
                  <TimeInput
                    placeholder="16:30"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    onNowClick={setEndTime}
                  />
                </Field>
                {showProjectField ? (
                  <Field label="Project">
                    <FieldCombobox
                      label="project"
                      value={projectId}
                      onValueChange={(value) => {
                        setProjectId(value);
                        setTaskId("");
                      }}
                      items={projectOptions}
                    />
                  </Field>
                ) : null}
                {showTaskField ? (
                  <Field label="Task">
                    <FieldCombobox label="task" value={taskId} onValueChange={setTaskId} items={taskOptions} />
                  </Field>
                ) : null}
              </>
            ) : null}
            {entryType === "sick_leave" ? (
              <Field label="Document">
                <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4">
                  <input
                    className="sr-only"
                    id="sick-leave-document"
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(event) => void handleAttachmentChange(event.target.files?.[0] ?? null)}
                  />
                  <label
                    htmlFor="sick-leave-document"
                    className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-input bg-[hsl(var(--input))] px-3 text-sm text-foreground"
                  >
                    Upload doctor approval
                  </label>
                  {sickLeaveAttachment ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{sickLeaveAttachment.fileName}</p>
                        <p className="text-xs text-muted-foreground">{sickLeaveAttachment.mimeType}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button asChild variant="ghost" type="button">
                          <a href={sickLeaveAttachment.dataUrl} download={sickLeaveAttachment.fileName}>
                            Open
                          </a>
                        </Button>
                        <Button variant="ghost" onClick={() => setSickLeaveAttachment(null)} type="button">
                          Remove
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Optional: upload a doctor approval PDF or image for this sick leave period.</p>
                  )}
                </div>
              </Field>
            ) : null}
            <Field label="Notes">
              <Textarea
                placeholder={
                  entryType === "work"
                    ? "Describe the work"
                    : entryType === "vacation"
                      ? "Add context for the vacation"
                      : "Add context for the absence"
                }
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </FormFields>
        </FormSection>

        <FormActions>
          <Button variant="ghost" onClick={() => navigate(backTo)} type="button">
            Cancel
          </Button>
          <Button disabled={saving || loading} onClick={() => void handleSave()} type="button">
            {saving ? "Saving..." : mode === "create" ? "Add entry" : "Save"}
          </Button>
        </FormActions>
      </FormPanel>
    </FormPage>
  );
}
