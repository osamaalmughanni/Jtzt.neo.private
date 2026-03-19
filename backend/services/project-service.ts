import { taskService } from "./task-service";

export const projectService = {
  listProjects(db: import("../runtime/types").AppDatabase, companyId: string) {
    return taskService.listProjectData(db, companyId);
  }
};
