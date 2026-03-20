export interface PageMeta {
  titleKey: string;
  descriptionKey?: string;
}

const pageMetaEntries: Array<[string, PageMeta]> = [
  ["/", { titleKey: "page.signIn.title", descriptionKey: "page.signIn.description" }],
  ["/login", { titleKey: "page.signIn.title", descriptionKey: "page.signIn.description" }],
  ["/register", { titleKey: "page.register.title", descriptionKey: "page.register.description" }],
  ["/dashboard", { titleKey: "page.overview.title", descriptionKey: "page.overview.description" }],
  ["/reports", { titleKey: "page.overview.title", descriptionKey: "page.overview.description" }],
  ["/users", { titleKey: "page.users.title", descriptionKey: "page.users.description" }],
  ["/fields", { titleKey: "page.settings.title", descriptionKey: "page.settings.description" }],
  ["/menu", { titleKey: "page.pages.title" }],
  ["/settings", { titleKey: "page.settings.title", descriptionKey: "page.settings.description" }],
  ["/admin", { titleKey: "page.companies.title", descriptionKey: "page.companies.description" }],
  ["/admin/menu", { titleKey: "page.pages.title" }],
  ["/admin/companies", { titleKey: "page.companies.title", descriptionKey: "page.companies.description" }],
];

export const pageMetaMap = new Map<string, PageMeta>(pageMetaEntries);

export function getPageMeta(pathname: string): PageMeta | null {
  if (
    pathname === "/menu" ||
    pathname === "/admin" ||
    pathname === "/admin/menu" ||
    pathname === "/admin/companies" ||
    pathname === "/dashboard" ||
    pathname === "/reports" ||
    pathname === "/reports/preview" ||
    pathname === "/dashboard/day" ||
    pathname === "/users" ||
    pathname === "/fields" ||
    pathname === "/settings"
  ) {
    return null;
  }

  if (pathname === "/users/create") {
    return null;
  }

  if (/^\/users\/[^/]+\/edit$/.test(pathname)) {
    return null;
  }

  return pageMetaMap.get(pathname) ?? null;
}
