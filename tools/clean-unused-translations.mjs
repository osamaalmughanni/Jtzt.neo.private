import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const repoRoot = process.cwd();
const frontendSrcDir = path.join(repoRoot, "frontend", "src");
const localePath = path.join(frontendSrcDir, "lib", "locales.ts");
const writeMode = process.argv.includes("--write");
const dryRunMode = !writeMode || process.argv.includes("--dry-run");

function isSourceFile(filePath) {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);
}

function shouldSkipDir(dirName) {
  return dirName === "node_modules" || dirName === "dist" || dirName === ".git";
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }
      if (entry.isFile() && isSourceFile(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function getPropertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function collectLeafKeysFromObject(objectLiteral, prefix = "", out = new Set()) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      continue;
    }

    const propertyName = ts.isShorthandPropertyAssignment(property)
      ? property.name.text
      : getPropertyNameText(property.name);
    if (!propertyName) {
      continue;
    }

    const nextPath = prefix ? `${prefix}.${propertyName}` : propertyName;
    const initializer = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;

    if (ts.isObjectLiteralExpression(initializer)) {
      collectLeafKeysFromObject(initializer, nextPath, out);
      continue;
    }

    out.add(nextPath);
  }

  return out;
}

function findResourcesObject(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "resources") continue;
      if (!declaration.initializer) continue;
      if (ts.isObjectLiteralExpression(declaration.initializer)) return declaration.initializer;
      if (ts.isAsExpression(declaration.initializer) && ts.isObjectLiteralExpression(declaration.initializer.expression)) {
        return declaration.initializer.expression;
      }
    }
  }
  return null;
}

function collectTranslationNamespaces(resourcesObject) {
  const namespaces = new Map();

  for (const localeProperty of resourcesObject.properties) {
    if (!ts.isPropertyAssignment(localeProperty)) continue;
    const localeName = getPropertyNameText(localeProperty.name);
    if (!localeName || !ts.isObjectLiteralExpression(localeProperty.initializer)) continue;

    const translationProperty = localeProperty.initializer.properties.find((property) => {
      if (!ts.isPropertyAssignment(property)) return false;
      return getPropertyNameText(property.name) === "translation" && ts.isObjectLiteralExpression(property.initializer);
    });

    if (translationProperty && ts.isPropertyAssignment(translationProperty) && ts.isObjectLiteralExpression(translationProperty.initializer)) {
      namespaces.set(localeName, translationProperty.initializer);
    }
  }

  return namespaces;
}

function collectUsedTranslationKeys(sourceFiles, knownKeys) {
  const used = new Set();

  for (const filePath of sourceFiles) {
    if (path.resolve(filePath) === path.resolve(localePath)) continue;
    const sourceText = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (knownKeys.has(node.text)) {
          used.add(node.text);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return used;
}

function pruneObjectLiteral(objectLiteral, usedKeys, prefix = "") {
  const keptProperties = [];

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      keptProperties.push(property);
      continue;
    }

    const propertyName = ts.isShorthandPropertyAssignment(property)
      ? property.name.text
      : getPropertyNameText(property.name);
    if (!propertyName) {
      keptProperties.push(property);
      continue;
    }

    const nextPath = prefix ? `${prefix}.${propertyName}` : propertyName;
    const initializer = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;

    if (ts.isObjectLiteralExpression(initializer)) {
      const prunedChild = pruneObjectLiteral(initializer, usedKeys, nextPath);
      if (prunedChild.properties.length > 0) {
        keptProperties.push(
          ts.factory.updatePropertyAssignment(property, property.name, prunedChild)
        );
      }
      continue;
    }

    if (usedKeys.has(nextPath)) {
      keptProperties.push(property);
    }
  }

  return ts.factory.updateObjectLiteralExpression(objectLiteral, keptProperties);
}

function transformLocaleFile(sourceText, usedKeys) {
  const sourceFile = ts.createSourceFile(localePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const resourcesObject = findResourcesObject(sourceFile);
  if (!resourcesObject) {
    throw new Error("Could not find resources object in locales.ts");
  }

  const transformer = (context) => {
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "resources" && node.initializer) {
        let initializer = node.initializer;
        let asExpression = null;

        if (ts.isAsExpression(initializer) && ts.isObjectLiteralExpression(initializer.expression)) {
          asExpression = initializer;
          initializer = initializer.expression;
        }

        if (!ts.isObjectLiteralExpression(initializer)) {
          return ts.visitEachChild(node, visit, context);
        }

        const prunedResources = ts.factory.updateObjectLiteralExpression(
          initializer,
          initializer.properties.map((property) => {
            if (!ts.isPropertyAssignment(property)) return property;

            const localeName = getPropertyNameText(property.name);
            if (!localeName || !ts.isObjectLiteralExpression(property.initializer)) return property;

            const translationProperty = property.initializer.properties.find((child) => {
              if (!ts.isPropertyAssignment(child)) return false;
              return getPropertyNameText(child.name) === "translation" && ts.isObjectLiteralExpression(child.initializer);
            });

            if (!translationProperty || !ts.isPropertyAssignment(translationProperty) || !ts.isObjectLiteralExpression(translationProperty.initializer)) {
              return property;
            }

            const prunedTranslation = pruneObjectLiteral(translationProperty.initializer, usedKeys);
            const updatedLocaleObject = ts.factory.updateObjectLiteralExpression(
              property.initializer,
              property.initializer.properties.map((child) => {
                if (child === translationProperty) {
                  return ts.factory.updatePropertyAssignment(translationProperty, translationProperty.name, prunedTranslation);
                }
                return child;
              })
            );
            return ts.factory.updatePropertyAssignment(property, property.name, updatedLocaleObject);
          })
        );

        const nextInitializer = asExpression
          ? ts.factory.updateAsExpression(asExpression, prunedResources, asExpression.type)
          : prunedResources;

        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, nextInitializer);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (root) => ts.visitNode(root, visit);
  };

  const transformed = ts.transform(sourceFile, [transformer]);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const nextText = printer.printFile(transformed.transformed[0]);
  transformed.dispose();
  return nextText;
}

const sourceFiles = walkFiles(frontendSrcDir);
const localeSourceText = fs.readFileSync(localePath, "utf8");
const localeSourceFile = ts.createSourceFile(localePath, localeSourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const resourcesObject = findResourcesObject(localeSourceFile);
if (!resourcesObject) {
  throw new Error("Could not locate resources object in locales.ts");
}

const translationNamespaces = collectTranslationNamespaces(resourcesObject);
const allLocaleKeys = new Set();
for (const translationObject of translationNamespaces.values()) {
  collectLeafKeysFromObject(translationObject, "", allLocaleKeys);
}

const usedKeys = collectUsedTranslationKeys(sourceFiles, allLocaleKeys);
const removedKeys = [...allLocaleKeys].filter((key) => !usedKeys.has(key)).sort();

if (removedKeys.length === 0) {
  console.log("No unused translation keys found.");
  process.exit(0);
}

console.log(`Found ${removedKeys.length} unused translation key(s).`);
for (const key of removedKeys) {
  console.log(`- ${key}`);
}

if (dryRunMode) {
  console.log("Dry run only. Re-run with --write to apply changes.");
  process.exit(0);
}

const nextLocaleText = transformLocaleFile(localeSourceText, usedKeys);
fs.writeFileSync(localePath, nextLocaleText, "utf8");
console.log(`Updated ${path.relative(repoRoot, localePath)}`);
