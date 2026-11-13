import assert from "node:assert/strict";
import { searchDuckDuckGo } from "../src/lib/web-search.mjs";

const query = "Next.js instrumentation official documentation";
const results = await searchDuckDuckGo(query);

assert.ok(results.length > 0, "search adapter must return at least one result");
assert.ok(results.length <= 5, "search adapter must respect the five-result limit");
assert.ok(
  results.every((result) => {
    try {
      const url = new URL(result.url);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password &&
        result.title.trim().length > 0 &&
        result.snippet.trim().length > 0
      );
    } catch {
      return false;
    }
  }),
  "search results must contain a safe HTTP(S) URL, title, and snippet",
);
assert.equal(
  new Set(results.map((result) => result.url)).size,
  results.length,
  "search adapter must not return duplicate URLs",
);

console.log(`✓ DuckDuckGo returned ${results.length} valid web sources without an AI API call.`);
for (const result of results) console.log(`  ${result.title}\n  ${result.url}`);
