import fs from "node:fs";
import path from "node:path";

const sourceDir = path.join(process.cwd(), "backend", "services", "calculation-presets");
const targetDir = path.join(process.cwd(), "dist", "backend", "services", "calculation-presets");

if (!fs.existsSync(sourceDir)) {
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
for (const fileName of fs.readdirSync(sourceDir)) {
  if (!fileName.endsWith(".js")) {
    continue;
  }

  fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
}
