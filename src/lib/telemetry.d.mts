import type { Span } from "@opentelemetry/api";

export type SafeTraceAttributes = Record<string, string | number | boolean | undefined>;

export declare function withAiSpan<T>(
  name: string,
  attributes: SafeTraceAttributes,
  operation: (span: Span) => Promise<T>,
): Promise<T>;
