import assert from "node:assert/strict";
import { parseDuckDuckGoResults } from "../src/lib/web-search.mjs";

const duplicatePageResults = parseDuckDuckGoResults(`
  <a class="result__a" href="https://example.com/page#first">First result</a>
  <a class="result__snippet">First snippet</a>
  <a class="result__a" href="https://example.com/page#second">Duplicate page</a>
  <a class="result__snippet">Duplicate snippet</a>
`);
assert.equal(
  duplicatePageResults.length,
  1,
  "search parsing must collapse duplicate pages that only differ by a fragment",
);
assert.equal(duplicatePageResults[0].url, "https://example.com/page");

const unsafeResults = parseDuckDuckGoResults(`
  <a class="result__a" href="javascript:alert(1)">Unsafe result</a>
  <a class="result__snippet">Unsafe snippet</a>
`);
assert.deepEqual(unsafeResults, [], "search parsing must reject non-HTTP(S) URLs");

console.log("✓ Search parsing deduplicates page fragments and rejects unsafe URLs.");
