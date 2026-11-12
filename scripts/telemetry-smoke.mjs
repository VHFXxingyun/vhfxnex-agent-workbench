import assert from "node:assert/strict";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { withAiSpan } from "../src/lib/telemetry.mjs";

const exporter = new InMemorySpanExporter();
assert.equal(
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable()),
  true,
  "register async context propagation",
);
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
assert.equal(trace.setGlobalTracerProvider(provider), true, "register a recording test provider");

const sensitivePrompt = "PRIVATE PROMPT THAT MUST NEVER ENTER TRACE ATTRIBUTES";
await withAiSpan(
  "goalflow.agent.execute",
  {
    "goalflow.operation": sensitivePrompt,
    "goalflow.model": "deepseek-flash",
    "goalflow.prompt": sensitivePrompt,
    "user.id": "private-user-id",
  },
  async () => {
    await withAiSpan(
      "goalflow.agent.tool",
      {
        "goalflow.operation": "execute",
        "goalflow.tool": "create_tasks",
        "goalflow.prompt": sensitivePrompt,
      },
      async (span) => {
        span.setAttribute("goalflow.outcome", "success");
      },
    );
  },
);

await assert.rejects(
  withAiSpan("goalflow.agent.pass", { "goalflow.pass": "repair" }, async () => {
    const error = new Error(sensitivePrompt);
    error.name = "SECRETNAME";
    throw error;
  }),
  /PRIVATE PROMPT/,
);
await withAiSpan(sensitivePrompt, {}, async () => {});

const spans = exporter.getFinishedSpans();
const parent = spans.find((span) => span.name === "goalflow.agent.execute");
const child = spans.find((span) => span.name === "goalflow.agent.tool");
const failed = spans.find((span) => span.name === "goalflow.agent.pass");
const unknown = spans.find((span) => span.name === "goalflow.unknown");

assert.ok(parent, "record the Agent execution span");
assert.ok(child, "record a tool span");
assert.ok(failed, "record a failed repair span");
assert.ok(unknown, "replace an unsafe span name with a fixed name");
assert.equal(child.parentSpanContext?.spanId, parent.spanContext().spanId);
assert.equal(parent.attributes["goalflow.model"], "deepseek-flash");
assert.equal(child.attributes["goalflow.tool"], "create_tasks");
assert.equal(failed.attributes["goalflow.outcome"], "error");
assert.equal(failed.attributes["error.type"], "Error");
assert.equal(failed.status.code, SpanStatusCode.ERROR);

for (const span of spans) {
  assert.equal(Object.hasOwn(span.attributes, "goalflow.prompt"), false);
  assert.equal(Object.hasOwn(span.attributes, "user.id"), false);
  assert.notEqual(span.attributes["goalflow.operation"], sensitivePrompt);
  assert.equal(JSON.stringify(span.attributes).includes(sensitivePrompt), false);
  assert.equal(span.name.includes(sensitivePrompt), false);
}

await provider.shutdown();
console.log(
  `OpenTelemetry smoke check passed (${spans.length} spans; nesting and privacy verified).`,
);
