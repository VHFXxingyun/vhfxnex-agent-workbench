import fs from "node:fs";
import path from "node:path";
import { getDeepSeekApiKey } from "../src/lib/deepseek-key.mjs";

const staticDirectory = path.join(process.cwd(), ".next", "static");
if (!fs.existsSync(staticDirectory)) {
  console.error("Run `npm run build` before checking browser bundles.");
  process.exit(2);
}

const apiKey = getDeepSeekApiKey();
if (!apiKey) {
  console.log("No project API key is configured; browser bundle value scan skipped.");
  process.exit(0);
}

const needle = Buffer.from(apiKey, "utf8");
const pending = [staticDirectory];
while (pending.length) {
  const directory = pending.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pending.push(filePath);
    } else if (fs.readFileSync(filePath).includes(needle)) {
      console.error("The configured API key was found in a browser static asset.");
      process.exit(1);
    }
  }
}

console.log("Browser static bundles do not contain the configured API key.");
