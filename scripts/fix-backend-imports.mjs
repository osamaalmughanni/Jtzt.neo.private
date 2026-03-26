import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendOutDir = path.join(root, "dist", "backend", "backend");
const sharedOutDir = path.join(root, "dist", "backend", "shared");

const relativeImportPattern = /(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g;
const dynamicImportPattern = /(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g;
const exportPattern = /(export\s+\*\s+from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g;
const namedExportPattern = /(export\s+\{[^}]+\}\s+from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g;

function addJsExtension(specifier) {
  if (/\.(?:js|json|node)$/.test(specifier)) {
    return specifier;
  }
  return `${specifier}.js`;
}

function rewriteSource(source) {
  return source
    .replace(relativeImportPattern, (_, prefix, specifier, suffix) => `${prefix}${addJsExtension(specifier)}${suffix}`)
    .replace(dynamicImportPattern, (_, prefix, specifier, suffix) => `${prefix}${addJsExtension(specifier)}${suffix}`)
    .replace(exportPattern, (_, prefix, specifier, suffix) => `${prefix}${addJsExtension(specifier)}${suffix}`)
    .replace(namedExportPattern, (_, prefix, specifier, suffix) => `${prefix}${addJsExtension(specifier)}${suffix}`);
}

async function rewriteDirectory(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteDirectory(fullPath);
      continue;
    }
    if (!entry.isFile() || !fullPath.endsWith(".js")) {
      continue;
    }
    const original = await readFile(fullPath, "utf8");
    const rewritten = rewriteSource(original);
    if (rewritten !== original) {
      await writeFile(fullPath, rewritten, "utf8");
    }
  }
}

await rewriteDirectory(backendOutDir);
await rewriteDirectory(sharedOutDir);
