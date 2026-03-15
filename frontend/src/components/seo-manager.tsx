import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SEO_DEFAULT_DESCRIPTION, SEO_DEFAULT_KEYWORDS, SEO_SITE_NAME, getSeoEntry } from "@/lib/seo";

function upsertMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector(selector) as HTMLMetaElement | null;

  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element?.setAttribute(key, value);
  });
}

function upsertLink(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector(selector) as HTMLLinkElement | null;

  if (!element) {
    element = document.createElement("link");
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element?.setAttribute(key, value);
  });
}

export function SeoManager() {
  const location = useLocation();

  useEffect(() => {
    const seo = getSeoEntry(location.pathname);
    const origin = window.location.origin;
    const canonicalUrl = new URL(seo.canonicalPath, origin).toString();
    const faviconUrl = new URL("/favicon.svg", origin).toString();
    const structuredData = seo.structuredData
      ? Array.isArray(seo.structuredData)
        ? seo.structuredData
        : [seo.structuredData]
      : [];

    document.documentElement.lang = "en";
    document.title = seo.title;

    upsertLink("link[rel='canonical']", { rel: "canonical", href: canonicalUrl });
    upsertLink("link[rel='icon']", { rel: "icon", type: "image/svg+xml", href: faviconUrl });

    upsertMeta("meta[name='description']", { name: "description", content: seo.description || SEO_DEFAULT_DESCRIPTION });
    upsertMeta("meta[name='keywords']", { name: "keywords", content: seo.keywords || SEO_DEFAULT_KEYWORDS });
    upsertMeta("meta[name='robots']", { name: "robots", content: seo.robots });
    upsertMeta("meta[name='author']", { name: "author", content: SEO_SITE_NAME });
    upsertMeta("meta[name='application-name']", { name: "application-name", content: SEO_SITE_NAME });
    upsertMeta("meta[property='og:site_name']", { property: "og:site_name", content: SEO_SITE_NAME });
    upsertMeta("meta[property='og:title']", { property: "og:title", content: seo.title });
    upsertMeta("meta[property='og:description']", { property: "og:description", content: seo.description });
    upsertMeta("meta[property='og:type']", { property: "og:type", content: seo.ogType ?? "website" });
    upsertMeta("meta[property='og:url']", { property: "og:url", content: canonicalUrl });
    upsertMeta("meta[name='twitter:card']", { name: "twitter:card", content: "summary" });
    upsertMeta("meta[name='twitter:title']", { name: "twitter:title", content: seo.title });
    upsertMeta("meta[name='twitter:description']", { name: "twitter:description", content: seo.description });
    upsertMeta("meta[name='theme-color']", { name: "theme-color", content: "#000000" });

    const existingScripts = document.head.querySelectorAll("script[data-jtzt-seo='structured-data']");
    existingScripts.forEach((script) => script.remove());

    structuredData.forEach((entry) => {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.jtztSeo = "structured-data";
      script.text = JSON.stringify(entry);
      document.head.appendChild(script);
    });
  }, [location.pathname]);

  return null;
}
