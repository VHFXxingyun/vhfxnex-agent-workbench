import { loadEnvConfig, updateInitialEnv } from "@next/env";

// Clear any inherited provider key; application requests read this project's .env.local.
updateInitialEnv({ DEEPSEEK_API_KEY: undefined });
delete process.env.DEEPSEEK_API_KEY;
loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", console, true);
