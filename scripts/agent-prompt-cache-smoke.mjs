import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SHARED_AGENT_PROMPT_PREFIX,
  prependSharedAgentPromptPrefix,
} from "../src/lib/agent-prompt-prefix.mjs";
import { EXECUTION_PROMPT_STABLE_PREFIX } from "../src/lib/execution-prompt.mjs";

const routeFiles = [
  ["planner", "src/app/api/plan/route.ts"],
  ["dialogue", "src/app/api/chat/route.ts"],
  ["workbench and reviewer", "src/app/api/execute/route.ts"],
];

assert.ok(
  SHARED_AGENT_PROMPT_PREFIX.length >= 600,
  "shared prefix should contain substantive cross-agent operating rules",
);
assert.ok(!/\$\{|\b(?:today|date|workspaceId|userId)\b/i.test(SHARED_AGENT_PROMPT_PREFIX));
assert.ok(EXECUTION_PROMPT_STABLE_PREFIX.startsWith(SHARED_AGENT_PROMPT_PREFIX));

for (const role of ["planner", "dialogue", "workbench", "reviewer"]) {
  const prompt = prependSharedAgentPromptPrefix(`Role-specific policy for ${role}.`);
  assert.ok(prompt.startsWith(SHARED_AGENT_PROMPT_PREFIX), `${role} must share the exact prefix`);
}

for (const [role, filePath] of routeFiles) {
  const source = await readFile(filePath, "utf8");
  assert.match(source, /prependSharedAgentPromptPrefix/);
  if (role === "workbench and reviewer") {
    assert.match(source, /buildExecutionSystemPrompt/);
    assert.match(source, /system:\s*prependSharedAgentPromptPrefix\(/);
  }
}

console.log(
  "✓ Planner, dialogue, workbench, and reviewer prompts share one stable prefix; dynamic context stays after it.",
);
