const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const syncOnly = process.argv.includes("--sync-only");

function findBubblewrapRoot() {
  const npxRoot = path.join(os.homedir(), "AppData", "Local", "npm-cache", "_npx");
  if (!fs.existsSync(npxRoot)) {
    throw new Error(`Bubblewrap cache not found at ${npxRoot}`);
  }

  const candidates = fs.readdirSync(npxRoot)
    .map((entry) => path.join(npxRoot, entry))
    .filter((entryPath) => fs.existsSync(path.join(entryPath, "node_modules", "@bubblewrap", "core", "dist", "lib", "TwaManifest.js")))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (candidates.length === 0) {
    throw new Error("Could not find a cached Bubblewrap installation.");
  }

  return candidates[0];
}

function loadBuildSettings(repoRoot) {
  const settingsPath = path.join(repoRoot, "apk", "config", "build-settings.json");
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
}

function getVersionMetadata(settings) {
  const versionCode = Number.parseInt(process.env.JTZT_ANDROID_VERSION_CODE || settings.appVersionCode || "1", 10);
  const versionName = (process.env.JTZT_ANDROID_VERSION_NAME || settings.appVersionName || "1").trim();
  return {
    versionCode: Number.isFinite(versionCode) && versionCode > 0 ? versionCode : 1,
    versionName: versionName || "1"
  };
}

async function writeFileIfChanged(filePath, nextContent) {
  const currentContent = fs.existsSync(filePath) ? await fsp.readFile(filePath, "utf8") : null;
  if (currentContent !== nextContent) {
    await fsp.writeFile(filePath, nextContent);
  }
}

async function syncProductionConfig(targetDirectory, settings) {
  const productionUrl = new URL(settings.siteUrl || "https://app.jtzt.com/");
  const manifestUrl = settings.manifestUrl || new URL("manifest.webmanifest", productionUrl).toString();
  const hostName = productionUrl.host;
  const origin = productionUrl.origin;
  const versionMetadata = getVersionMetadata(settings);
  const kioskShortcut = {
    name: settings.kioskShortcutTitle || "Exit kiosk",
    short_name: settings.kioskShortcutShortName || "Exit",
    url: `${origin}${settings.kioskShortcutPath || "/native/exit"}`,
    icon: settings.kioskShortcutIcon || "ic_notification_icon",
  };
  const twaManifestPath = path.join(targetDirectory, "twa-manifest.json");
  const buildGradlePath = path.join(targetDirectory, "app", "build.gradle");
  const manifestChecksumPath = path.join(targetDirectory, "manifest-checksum.txt");

  if (fs.existsSync(twaManifestPath)) {
    const twaManifest = JSON.parse(await fsp.readFile(twaManifestPath, "utf8"));
    twaManifest.host = hostName;
    twaManifest.iconUrl = `${origin}/logo.svg`;
    twaManifest.maskableIconUrl = `${origin}/logo.svg`;
    twaManifest.webManifestUrl = manifestUrl;
    twaManifest.fullScopeUrl = `${origin}/`;
    twaManifest.shortcuts = [kioskShortcut];
    twaManifest.fallbackType = settings.fallbackType || "webview";
    twaManifest.appVersionCode = versionMetadata.versionCode;
    twaManifest.appVersionName = versionMetadata.versionName;
    twaManifest.appVersion = versionMetadata.versionName;
    await writeFileIfChanged(twaManifestPath, `${JSON.stringify(twaManifest, null, 2)}\n`);
  }

  if (fs.existsSync(buildGradlePath)) {
    let buildGradle = await fsp.readFile(buildGradlePath, "utf8");
    buildGradle = buildGradle
      .replace(/hostName: '.*?'/, `hostName: '${hostName}'`)
      .replace(/shortcuts: \[\],/, `shortcuts: [\n        [\n            name: '${kioskShortcut.name}',\n            short_name: '${kioskShortcut.short_name}',\n            url: '${kioskShortcut.url}',\n            icon: '${kioskShortcut.icon}'\n        ]\n    ],`)
      .replace(/fallbackType: '.*?'/, `fallbackType: '${settings.fallbackType || "webview"}'`)
      .replace(/versionCode\s+\d+/, `versionCode ${versionMetadata.versionCode}`)
      .replace(/versionName\s+".*?"/, `versionName "${versionMetadata.versionName}"`)
      .replace("http://127.0.0.1:4179/manifest.webmanifest", manifestUrl)
      .replace("http://127.0.0.1:4179/", `${origin}/`);
    await writeFileIfChanged(buildGradlePath, buildGradle);
  }

  const manifestJsonPath = path.join(targetDirectory, "app", "src", "main", "res", "values", "strings.xml");
  if (fs.existsSync(manifestJsonPath)) {
    let stringsXml = await fsp.readFile(manifestJsonPath, "utf8");
    stringsXml = stringsXml
      .replace("https://127.0.0.1:4179", origin)
      .replace("http://127.0.0.1:4179", origin)
      .replace("<string name=\"fallbackType\">customtabs</string>", `<string name="fallbackType">${settings.fallbackType || "webview"}</string>`);
    await writeFileIfChanged(manifestJsonPath, stringsXml);
  }

}

async function main() {
  const bubblewrapRoot = findBubblewrapRoot();
  const bubblewrapCore = require(path.join(bubblewrapRoot, "node_modules", "@bubblewrap", "core"));
  const { generateTwaProject, generateManifestChecksumFile } = require(path.join(bubblewrapRoot, "node_modules", "@bubblewrap", "cli", "dist", "lib", "cmds", "shared.js"));

  const repoRoot = path.resolve(__dirname, "..", "..");
  const settings = loadBuildSettings(repoRoot);
  const targetDirectory = path.join(repoRoot, "apk", settings.twaProjectDir || "twa");
  await fsp.mkdir(targetDirectory, { recursive: true });

  if (syncOnly) {
    await syncProductionConfig(targetDirectory, settings);
    return;
  }

  const webManifestPath = path.join(repoRoot, "frontend", "public", "manifest.webmanifest");
  const webManifest = JSON.parse(await fsp.readFile(webManifestPath, "utf8"));

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1:4179");
    const safePath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const filePath = path.join(repoRoot, "frontend", "public", safePath);

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      if (filePath.endsWith(".webmanifest")) {
        res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
      } else if (filePath.endsWith(".svg")) {
        res.setHeader("Content-Type", "image/svg+xml");
      }
      res.end(data);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(4179, "127.0.0.1", resolve);
  });

  try {
    const webManifestUrl = new URL(settings.manifestUrl || "http://127.0.0.1:4179/manifest.webmanifest");
    const twaManifest = bubblewrapCore.TwaManifest.fromWebManifestJson(webManifestUrl, webManifest);
    twaManifest.packageId = settings.packageName || "com.jtzt.app";
    twaManifest.signingKey.path = path.join(targetDirectory, "android.keystore");
    twaManifest.signingKey.alias = settings.keystoreAlias || "android";
    twaManifest.generatorApp = settings.projectName || "Jtzt";

    await twaManifest.saveToFile(path.join(targetDirectory, "twa-manifest.json"));

    const prompt = { printMessage() {} };
    const twaGenerator = new bubblewrapCore.TwaGenerator();
    await generateTwaProject(prompt, twaGenerator, targetDirectory, twaManifest);
    await syncProductionConfig(targetDirectory, settings);
    await generateManifestChecksumFile(path.join(targetDirectory, "twa-manifest.json"), targetDirectory);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
