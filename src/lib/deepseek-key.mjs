import fs from "node:fs";
import path from "node:path";

export function parseEnvValue(contents, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignment = new RegExp(`^\\s*(?:export\\s+)?${escapedName}\\s*=\\s*(.*?)\\s*$`, "gm");
  let raw;
  for (const match of contents.replace(/^\uFEFF/, "").matchAll(assignment)) raw = match[1];
  if (raw === undefined) return null;

  const value = raw.trim();
  const quote = value[0];
  if (quote === "'" || quote === '"' || quote === "`") {
    const closingQuote = value.lastIndexOf(quote);
    if (closingQuote === 0) return "";
    if (closingQuote < 0) return null;
    const quoted = value.slice(1, closingQuote);
    return quote === '"'
      ? quoted
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\")
      : quoted;
  }

  return value.replace(/\s+#.*$/, "").trim();
}

export function getDeepSeekApiKey(directory = process.cwd()) {
  // Isolated smoke servers must fail closed even when the workspace has .env.local.
  if (process.env.NEXORA_DISABLE_AI === "1") return "";
  try {
    const envFile = fs.readFileSync(path.join(directory, ".env.local"), "utf8");
    return parseEnvValue(envFile, "DEEPSEEK_API_KEY")?.trim() || "";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
