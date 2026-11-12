import { spawnSync } from "node:child_process";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const [command, ...args] = process.argv.slice(2);

if (!command || !["dev", "start"].includes(command)) {
  console.error("Usage: node scripts/next.mjs <dev|start> [Next.js options]");
  process.exit(2);
}

// Never use an unrelated DeepSeek key inherited from the parent process.
delete process.env.DEEPSEEK_API_KEY;
loadEnvConfig(process.cwd(), command === "dev");

const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", command, ...args], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(`Could not start the Next.js ${command} server.`);
  process.exit(1);
}

process.exit(result.status ?? 1);
