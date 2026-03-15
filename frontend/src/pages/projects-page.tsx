import { useEffect, useMemo, useState } from "react";
import type { ProjectRecord, TaskRecord } from "@shared/types/models";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function ProjectsPage() {
  const { companySession, companyIdentity } = useAuth();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskProjectId, setTaskProjectId] = useState("");

  async function load() {
    if (!companySession) return;
    try {
      const response = await api.listProjects(companySession.token);
      setProjects(response.projects);
      setTasks(response.tasks);
    } catch (error) {
      toast({
        title: "Could not load projects",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  useEffect(() => {
    void load();
  }, [companySession]);

  const isAdmin = companyIdentity?.user.role === "company_admin";
  const taskGroups = useMemo(
    () =>
      projects.map((project) => ({
        project,
        tasks: tasks.filter((task) => task.projectId === project.id)
      })),
    [projects, tasks]
  );

  async function createProject() {
    if (!companySession || !projectName.trim()) return;
    try {
      await api.createProject(companySession.token, { name: projectName, description: projectDescription });
      setProjectName("");
      setProjectDescription("");
      toast({ title: "Project created" });
      await load();
    } catch (error) {
      toast({
        title: "Could not create project",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  async function createTask() {
    if (!companySession || !taskTitle.trim() || !taskProjectId) return;
    try {
      await api.createTask(companySession.token, { projectId: Number(taskProjectId), title: taskTitle });
      setTaskTitle("");
      setTaskProjectId("");
      toast({ title: "Task created" });
      await load();
    } catch (error) {
      toast({
        title: "Could not create task",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Manage structure</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Create project</p>
              <Input placeholder="Project name" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              <Input placeholder="Description" value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} />
              <Button onClick={() => void createProject()}>Create project</Button>
            </div>
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Create task</p>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                value={taskProjectId}
                onChange={(event) => setTaskProjectId(event.target.value)}
              >
                <option value="">Select project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <Input placeholder="Task title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} />
              <Button variant="outline" onClick={() => void createTask()}>
                Create task
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Project map</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {taskGroups.map(({ project, tasks: projectTasks }) => (
            <div key={project.id} className="rounded-xl border border-border p-4">
              <p className="font-medium">{project.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{project.description || "No description"}</p>
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectTasks.length ? (
                    projectTasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell>{task.title}</TableCell>
                        <TableCell>{new Date(task.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell className="text-muted-foreground" colSpan={2}>
                        No tasks yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
