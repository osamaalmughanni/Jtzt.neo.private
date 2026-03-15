import { taskService } from "./task-service";

export const projectService = {
  listProjects(databasePath: string) {
    return taskService.listProjectData(databasePath);
  }
};
