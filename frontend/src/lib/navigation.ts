export type NavigationScope = "public" | "company" | "admin" | "tablet";

export function getHomePath(scope: NavigationScope): string {
  if (scope === "admin") {
    return "/admin/companies";
  }

  if (scope === "company") {
    return "/dashboard";
  }

  if (scope === "tablet") {
    return "/dashboard";
  }

  return "/";
}
