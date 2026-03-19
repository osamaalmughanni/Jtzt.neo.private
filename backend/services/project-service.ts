import { taskService } from "./task-service";

export const projectService = {
  listProjects(companyId: string) {
    return taskService.listProjectData(companyId);
  }
};
