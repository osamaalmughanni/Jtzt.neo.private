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
export const SEO_DEFAULT_TITLE = "Jtzt | Working Hours Software for Companies";
export const SEO_DEFAULT_DESCRIPTION =
  "Jtzt is a fast, local-first working hours platform for companies that want clear tenant boundaries, clean administration, and reliable time tracking.";
export const SEO_DEFAULT_KEYWORDS =
  "working hours software, time tracking software, employee time tracking, company timesheets, local-first business software, tenant-based admin software";

export const seoEntries = new Map<string, SeoEntry>([
  [
    "/learn",
    {
      title: "Jtzt | Working Hours Software Built for Company Control",
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
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description:
          "A local-first working hours platform for companies that want fast performance, clean tenant boundaries, and straightforward administration.",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD"
        }
      }
    }
  ],
  [
    "/company",
    {
      title: "About Jtzt | Company Information",
      description:
        "Learn about the company behind Jtzt, a focused working hours platform built for businesses that want clarity, local control, and maintainable operations.",
      robots: "index, follow",
      canonicalPath: "/company",
      ogType: "website",
      keywords: "about Jtzt, Jtzt company, working hours software company",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Jtzt",
        url: "/company"
      }
    }
  ],
  [
    "/",
    {
      title: "Jtzt Login",
      description: "Sign in to Jtzt.",
      robots: "noindex, nofollow",
      canonicalPath: "/",
      ogType: "website"
    }
  ],
  [
    "/login",
    {
      title: "Jtzt Login",
      description: "Sign in to Jtzt.",
      robots: "noindex, nofollow",
      canonicalPath: "/login",
      ogType: "website"
    }
  ],
  [
    "/admin/login",
    {
      title: "Jtzt Admin Login",
      description: "Admin sign in for Jtzt.",
      robots: "noindex, nofollow",
      canonicalPath: "/admin/login",
      ogType: "website"
    }
  ]
]);

export function getSeoEntry(pathname: string): SeoEntry {
  if (pathname.startsWith("/admin") || pathname.startsWith("/settings") || pathname === "/menu" || pathname === "/dashboard" || pathname === "/time" || pathname === "/calendar" || pathname === "/projects") {
    return {
      title: "Jtzt App",
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
