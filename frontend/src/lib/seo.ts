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
  const privateTitles = new Map<string, string>([
    ["/menu", pageTitle("Pages")],
    ["/dashboard", pageTitle("Overview")],
    ["/users", pageTitle("Users")],
    ["/settings", pageTitle("Settings")],
    ["/admin/menu", pageTitle("Pages")],
    ["/admin/companies", pageTitle("Companies")],
    ["/admin/company/create", pageTitle("Create")]
  ]);

  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/settings") ||
    pathname === "/menu" ||
    pathname === "/dashboard" ||
    pathname.startsWith("/users")
  ) {
    return {
      title: privateTitles.get(pathname) ?? pageTitle("App"),
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
