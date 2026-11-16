const OUTPUT_BUDGETS = Object.freeze({
  search_web: 900,
  create_tasks: 2000,
  build_timeline: 1800,
  build_schedule: 2200,
  validate_feasibility: 1800,
  // Full template-based plans need enough room to preserve every requested
  // section, table, safety detail, and implementation note without truncation.
  draft_document: 12_000,
  generate_pdf: 12_000,
  calculate_budget: 1500,
  // Project batches can contain tens of thousands of source characters. Keep
  // the response budget large enough for complete JSON tool arguments; the
  // per-call character limit remains the transport guardrail.
  create_project: 32_000,
  generate_spreadsheet: 6500,
  generate_presentation: 6500,
});

export function agentOutputTokenBudget(toolName) {
  return OUTPUT_BUDGETS[toolName] || 1200;
}
