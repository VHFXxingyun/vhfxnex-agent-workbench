import { spawn } from "node:child_process";
import nextEnv from "@next/env";
import { superviseProcesses } from "./process-supervisor.mjs";

const { loadEnvConfig } = nextEnv;
const [command, ...args] = process.argv.slice(2);

if (!command || !["dev", "start"].includes(command)) {
  console.error("Usage: node scripts/next.mjs <dev|start> [Next.js options]");
  process.exit(2);
}

// Never use an unrelated DeepSeek key inherited from the parent process.
delete process.env.DEEPSEEK_API_KEY;
loadEnvConfig(process.cwd(), command === "dev");

const portIndex = args.findIndex((argument) => argument === "--port" || argument === "-p");
const inlinePort = args.find((argument) => argument.startsWith("--port="))?.split("=")[1];
const port = inlinePort || (portIndex >= 0 ? args[portIndex + 1] : process.env.PORT) || "3000";
const hasSessionSecret =
  new TextEncoder().encode(process.env.SESSION_SECRET || "").byteLength >= 32;
const worker = hasSessionSecret
  ? spawn(
      process.execPath,
      [
        "scripts/workbench-worker.mjs",
        `--base-url=http://127.0.0.1:${port}`,
        ...(command === "dev" ? ["--dev"] : []),
      ],
      { stdio: "inherit", env: process.env, windowsHide: true },
    )
  : null;
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", command, ...args], {
  stdio: "inherit",
  env: process.env,
  windowsHide: true,
});

process.exitCode = await superviseProcesses(next, worker);
