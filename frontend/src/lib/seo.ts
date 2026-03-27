export interface SeoEntry {
  title: string;
  description: string;
  robots: string;
  canonicalPath: string;
  ogType?: "website" | "article";
  keywords?: string;
  structuredData?: Record<string, unknown> | Array<Record<string, unknown>>;
}

export const SEO_SITE_NAME = "Jtzt";
export const SEO_DEFAULT_TITLE = "Jtzt | Time Tracking for Companies";
export const SEO_DEFAULT_DESCRIPTION =
  "Jtzt is a fast, local-first working hours platform for companies that want clear tenant boundaries, clean administration, and reliable time tracking.";
export const SEO_DEFAULT_KEYWORDS =
  "working hours software, time tracking software, employee time tracking, company timesheets, local-first business software, tenant-based admin software";

function pageTitle(label: string) {
  return `${label} | ${SEO_SITE_NAME}`;
}

function resolvePrivateTitle(pathname: string) {
  if (pathname === "/menu" || pathname === "/admin/menu") return pageTitle("Pages");
  if (pathname === "/dashboard") return pageTitle("Overview");
  if (pathname === "/dashboard/day") return pageTitle("Select Day");
  if (pathname === "/dashboard/records/create") return pageTitle("Add Entry");
  if (pathname.startsWith("/dashboard/records/") && pathname.endsWith("/edit")) return pageTitle("Edit Entry");
  if (pathname === "/reports") return pageTitle("Reports");
  if (pathname === "/reports/preview") return pageTitle("Report Preview");
  if (pathname === "/users") return pageTitle("Users");
  if (pathname === "/users/create") return pageTitle("Create User");
  if (pathname.startsWith("/users/") && pathname.endsWith("/edit")) return pageTitle("Edit User");
  if (pathname === "/fields") return pageTitle("Fields");
  if (pathname === "/calculations") return pageTitle("Calculations");
  if (pathname === "/calculations/create") return pageTitle("Create Calculation");
  if (pathname.startsWith("/calculations/") && pathname.endsWith("/preview")) return pageTitle("Preview Calculation");
  if (pathname.startsWith("/calculations/") && pathname.endsWith("/edit")) return pageTitle("Edit Calculation");
  if (pathname === "/projects") return pageTitle("Projects");
  if (pathname === "/projects/create") return pageTitle("Create Project");
  if (pathname.startsWith("/projects/") && pathname.endsWith("/edit")) return pageTitle("Edit Project");
  if (pathname === "/tasks") return pageTitle("Tasks");
  if (pathname === "/tasks/create") return pageTitle("Create Task");
  if (pathname.startsWith("/tasks/") && pathname.endsWith("/edit")) return pageTitle("Edit Task");
  if (pathname === "/settings") return pageTitle("Settings");
  if (pathname === "/settings/overtime") return pageTitle("Overtime Management");
  if (pathname === "/api-access") return pageTitle("API Access");
  if (pathname === "/tablet") return pageTitle("Tablet");
  if (pathname === "/tablet/pin") return pageTitle("PIN");
  if (pathname === "/admin") return pageTitle("Companies");
  if (pathname === "/admin/companies") return pageTitle("Companies");
  return null;
}

export const seoEntries = new Map<string, SeoEntry>([
  [
    "/learn",
    {
      title: pageTitle("Learn More"),
      description:
        "Jtzt helps companies track working hours with a fast local-first architecture, clear tenant separation, and clean internal administration.",
      robots: "index, follow",
      canonicalPath: "/learn",
      ogType: "website",
      keywords:
        "working hours software, company time tracking, employee hours tracking, internal business software, local-first time tracking",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Jtzt",
        url: "https://jtzt.com",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description:
          "A local-first working hours platform for companies that want fast performance, clean tenant boundaries, and straightforward administration.",
        creator: {
          "@type": "Organization",
          name: "DI Osama Almughanni, BSc",
          url: "https://jtzt.com",
          address: {
            "@type": "PostalAddress",
            streetAddress: "Doblergasse 3/3/8",
            postalCode: "1070",
            addressLocality: "Wien",
            addressCountry: "AT"
          }
        },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD"
        }
      }
    }
  ],
  [
    "/",
    {
      title: pageTitle("Sign In"),
      description: "Sign in to Jtzt.",
      robots: "noindex, nofollow",
      canonicalPath: "/",
      ogType: "website"
    }
  ],
  [
    "/register",
    {
      title: pageTitle("Register"),
      description: "Create your company workspace in Jtzt and start evaluating time tracking, tenant isolation, and secure access controls.",
      robots: "index, follow",
      canonicalPath: "/register",
      ogType: "website"
    }
  ],
  [
    "/login",
    {
      title: pageTitle("Sign In"),
      description: "Sign in to Jtzt.",
      robots: "noindex, nofollow",
      canonicalPath: "/login",
      ogType: "website"
    }
  ],
  [
    "/admin/login",
    {
      title: pageTitle("Admin Sign In"),
      description: "Admin sign in for Jtzt.",
      robots: "noindex, nofollow",
      canonicalPath: "/admin/login",
      ogType: "website"
    }
  ]
]);

export function getSeoEntry(pathname: string): SeoEntry {
  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/tablet") ||
    pathname.startsWith("/reports") ||
    pathname.startsWith("/projects") ||
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/dashboard/records") ||
    pathname.startsWith("/users") ||
    pathname.startsWith("/fields") ||
    pathname.startsWith("/calculations") ||
    pathname === "/menu" ||
    pathname === "/dashboard" ||
    pathname === "/dashboard/day"
  ) {
    const title = resolvePrivateTitle(pathname);
    if (!title) {
      const message = `Missing private page title for route: ${pathname}`;
      if (import.meta.env.DEV) {
        throw new Error(message);
      }
      console.error(message);
    }

    return {
      title: title ?? pageTitle("App"),
      description: "Private application area for authenticated Jtzt users.",
      robots: "noindex, nofollow",
      canonicalPath: pathname,
      ogType: "website"
    };
  }

  return (
    seoEntries.get(pathname) ?? {
      title: SEO_DEFAULT_TITLE,
      description: SEO_DEFAULT_DESCRIPTION,
      robots: "index, follow",
      canonicalPath: pathname,
      ogType: "website",
      keywords: SEO_DEFAULT_KEYWORDS
    }
  );
}
