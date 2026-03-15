export type NavigationScope = "public" | "company" | "admin";

export function getHomePath(scope: NavigationScope): string {
  if (scope === "admin") {
    return "/admin/companies";
  }

  if (scope === "company") {
    return "/dashboard";
  }

  return "/";
}
