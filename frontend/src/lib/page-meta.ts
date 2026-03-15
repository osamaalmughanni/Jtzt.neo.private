export interface PageMeta {
  title: string;
  description?: string;
}

const pageMetaEntries: Array<[string, PageMeta]> = [
  ["/dashboard", { title: "Overview", description: "Today, this week, and recent activity." }],
  ["/time", { title: "Time", description: "Track sessions, edit entries, and manage notes." }],
  ["/calendar", { title: "Calendar", description: "Daily totals for the selected month." }],
  ["/projects", { title: "Projects", description: "Projects and tasks for this company." }],
  ["/menu", { title: "Pages" }],
  ["/settings", { title: "Settings", description: "Users and project structure." }],
  ["/settings/users", { title: "Users", description: "All users in this company." }],
  ["/settings/users/create", { title: "Create", description: "Add an employee or company admin." }],
  ["/admin/menu", { title: "Pages" }],
  ["/admin/companies", { title: "Companies", description: "Manage tenant companies and system totals." }],
  ["/admin/company/create", { title: "Create", description: "Create a company database and initial admin." }]
];

export const pageMetaMap = new Map<string, PageMeta>(pageMetaEntries);

export function getPageMeta(pathname: string): PageMeta | null {
  return pageMetaMap.get(pathname) ?? null;
}
