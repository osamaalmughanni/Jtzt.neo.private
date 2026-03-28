import rawLearnPageEn from "../content/learn/jtzt.en.md?raw";
import rawLearnPageDe from "../content/learn/jtzt.de.md?raw";

export interface LearnPageContent {
  title: string;
  description?: string;
  body: string;
}

function parseFrontmatter(raw: string): LearnPageContent {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      title: "Learn",
      body: raw.trim()
    };
  }

  const [, frontmatter, body] = match;
  const attributes: Record<string, string> = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    attributes[key] = value;
  }

  return {
    title: attributes.title ?? "Learn",
    description: attributes.description,
    body: body.trim()
  };
}

const learnPages = {
  en: parseFrontmatter(rawLearnPageEn),
  de: parseFrontmatter(rawLearnPageDe),
} satisfies Record<"en" | "de", LearnPageContent>;

export function getLearnPage(language: string) {
  return language.startsWith("de") ? learnPages.de : learnPages.en;
}
