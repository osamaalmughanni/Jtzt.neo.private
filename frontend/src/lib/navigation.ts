export type NavigationScope = "public" | "company" | "admin" | "tablet";

export function getHomePath(scope: NavigationScope): string {
  if (scope === "admin") {
    return "/admin";
  }

  if (scope === "company") {
    return "/dashboard";
  }

  if (scope === "tablet") {
    return "/dashboard";
  }

  return "/";
}
