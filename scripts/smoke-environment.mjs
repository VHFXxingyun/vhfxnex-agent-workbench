import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

/**
 * Load project-local runtime settings for test clients so they use the same
 * configured SQLite path as the app. Smoke clients never need the API key;
 * the server process owns it, so remove inherited and locally loaded copies.
 */
export function loadSmokeEnvironment() {
  const liveUiRequested = process.env.NEXORA_TEST_LIVE_UI === "1";
  delete process.env.DEEPSEEK_API_KEY;
  loadEnvConfig(process.cwd());
  delete process.env.DEEPSEEK_API_KEY;
  if (liveUiRequested) process.env.NEXORA_TEST_LIVE_UI = "1";
  else delete process.env.NEXORA_TEST_LIVE_UI;
  return { liveUiRequested };
}
