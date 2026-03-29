import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const command = process.argv[2];

if (!command || !["backend", "backend-watch", "demo-seed"].includes(command)) {
  console.error("Usage: node tools/run-esbuild.mjs <backend|backend-watch|demo-seed>");
  process.exit(1);
}

const external = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
];

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  sourcemap: true,
  external,
  absWorkingDir: repoRoot,
};

async function main() {
  if (command === "backend") {
    await esbuild.build({
      ...shared,
      entryPoints: ["backend/server.ts", "backend/db/schema.ts"],
      outdir: "dist/backend",
    });
    return;
  }

  if (command === "backend-watch") {
    const watchConfig = {
      ...shared,
      entryPoints: ["backend/server.ts", "backend/db/schema.ts"],
      outdir: "dist/backend",
    };

    if (typeof esbuild.context === "function") {
      const ctx = await esbuild.context(watchConfig);
      await ctx.watch();
      await new Promise(() => {});
      return;
    }

    await esbuild.build({
      ...watchConfig,
      watch: {
        onRebuild(error) {
          if (error) {
            console.error(error);
            return;
          }
          console.log("[esbuild] rebuild complete");
        },
      },
    });
    await new Promise(() => {});
    return;
  }

  await esbuild.build({
    ...shared,
    entryPoints: ["tools/seed-demo.ts"],
    outfile: "dist/tools/seed-demo.js",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
