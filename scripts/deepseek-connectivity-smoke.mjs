import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  deepSeekModelIsAvailable,
  DEEPSEEK_MODELS_URL,
  requestDeepSeekModels,
} from "../src/lib/deepseek-model-catalog.mjs";

let capturedRequest;
const abortController = new AbortController();
const response = await requestDeepSeekModels(
  "vhfxnex-smoke-key",
  1_000,
  abortController.signal,
  async (input, init) => {
    capturedRequest = { input: String(input), init };
    return Response.json({ object: "list", data: [{ id: "deepseek-flash" }] });
  },
);

assert.equal(response.status, 200);
assert.equal(capturedRequest?.input, DEEPSEEK_MODELS_URL);
assert.equal(capturedRequest?.init?.method, "GET");
assert.equal(capturedRequest?.init?.headers?.Authorization, "Bearer vhfxnex-smoke-key");
assert.equal("body" in (capturedRequest?.init || {}), false);
assert.match(capturedRequest?.init?.cache || "", /no-store/u);
abortController.abort();
assert.equal(capturedRequest?.init?.signal?.aborted, true);

assert.equal(
  deepSeekModelIsAvailable({ data: [{ id: "deepseek-flash" }] }, "deepseek-flash"),
  true,
);
assert.equal(deepSeekModelIsAvailable({ data: [{ id: "other-model" }] }, "deepseek-flash"), false);
assert.equal(deepSeekModelIsAvailable({ data: "malformed" }, "deepseek-flash"), false);

const routeSource = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/admin/ai-status/route.ts"),
  "utf8",
);
assert.match(routeSource, /requestDeepSeekModels/u);
assert.doesNotMatch(routeSource, /requestDeepSeek\(|recordAiUsage\(/u);

console.log(
  "✓ Admin connectivity uses the authenticated model catalog, verifies deepseek-flash, and creates no completion-token usage without contacting DeepSeek.",
);
