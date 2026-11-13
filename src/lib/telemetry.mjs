import { SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("goalflow-agent", "1.0.0");

const allowedSpanNames = new Set([
  "goalflow.ai.plan_request",
  "goalflow.agent.execute",
  "goalflow.agent.pass",
  "goalflow.agent.tool",
]);
const allowedModels = new Set(["deepseek-flash"]);
const allowedTools = new Set([
  "create_tasks",
  "build_timeline",
  "build_schedule",
  "validate_feasibility",
  "draft_document",
  "calculate_budget",
]);
const allowedErrorTypes = new Set([
  "AbortError",
  "AI_APICallError",
  "APICallError",
  "Error",
  "InvalidToolInputError",
  "NoSuchToolError",
  "RangeError",
  "SyntaxError",
  "TimeoutError",
  "ToolCallRepairError",
  "TypeError",
]);

const allowedValues = {
  "goalflow.operation": new Set(["plan", "execute"]),
  "goalflow.pass": new Set(["initial", "repair"]),
  "goalflow.outcome": new Set(["success", "error", "cancelled", "provider_error", "skipped"]),
};

function isSafeAttribute(key, value) {
  if (value === undefined) return false;
  if (Object.hasOwn(allowedValues, key)) return allowedValues[key].has(value);
  if (key === "goalflow.has_image") return typeof value === "boolean";
  if (key === "goalflow.model") return allowedModels.has(value);
  if (key === "goalflow.tool") return allowedTools.has(value);
  if (key === "error.type") return allowedErrorTypes.has(value);
  if (key === "http.response.status_code")
    return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
  if (
    [
      "goalflow.knowledge_reference_count",
      "goalflow.tool_call_count",
      "goalflow.agent_step_count",
      "goalflow.input_tokens",
      "goalflow.output_tokens",
      "goalflow.total_tokens",
    ].includes(key)
  ) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  }
  return false;
}

function filterSafeAttributes(attributes) {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key, value]) => isSafeAttribute(key, value)),
  );
}

export async function withAiSpan(name, attributes, operation) {
  return tracer.startActiveSpan(
    allowedSpanNames.has(name) ? name : "goalflow.unknown",
    { attributes: filterSafeAttributes(attributes) },
    async (span) => {
      try {
        return await operation(span);
      } catch (error) {
        const cancelled = error instanceof DOMException && error.name === "AbortError";
        span.setAttribute("goalflow.outcome", cancelled ? "cancelled" : "error");
        const errorType = error instanceof Error ? error.name : "Error";
        span.setAttribute("error.type", allowedErrorTypes.has(errorType) ? errorType : "Error");
        if (!cancelled) span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
