import type { CompanySettings } from "@shared/types/models";

export interface TimerSetupRequirement {
  kind: "project" | "task" | "custom_field";
  label: string;
  fieldId?: string;
}

export interface EvaluateTimerSetupRequirementsInput {
  settings: Pick<CompanySettings, "projectsEnabled" | "tasksEnabled">;
  projectId: string;
  taskId: string;
  selectedProjectExists: boolean;
  selectedTaskExists: boolean;
  requiredCustomFields: Array<{ id: string; label: string }>;
  customFieldValues: Record<string, string | number | boolean>;
}

function hasRenderableCustomFieldValue(value: string | number | boolean | undefined) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  return false;
}

export function evaluateTimerSetupRequirements(input: EvaluateTimerSetupRequirementsInput) {
  const requirements: TimerSetupRequirement[] = [];

  if (input.settings.projectsEnabled && !input.projectId.trim()) {
    requirements.push({ kind: "project", label: "Project" });
  } else if (input.settings.projectsEnabled && !input.selectedProjectExists) {
    requirements.push({ kind: "project", label: "Project" });
  }

  if (input.settings.tasksEnabled && !input.taskId.trim()) {
    requirements.push({ kind: "task", label: "Task" });
  } else if (input.settings.tasksEnabled && !input.selectedTaskExists) {
    requirements.push({ kind: "task", label: "Task" });
  }

  for (const field of input.requiredCustomFields) {
    const value = input.customFieldValues[field.id];
    if (!hasRenderableCustomFieldValue(value)) {
      requirements.push({
        kind: "custom_field",
        fieldId: field.id,
        label: field.label,
      });
    }
  }

  return {
    ready: requirements.length === 0,
    requirements,
  };
}
