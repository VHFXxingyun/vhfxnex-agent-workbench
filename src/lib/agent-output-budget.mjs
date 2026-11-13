const OUTPUT_BUDGETS = Object.freeze({
  search_web: 900,
  create_tasks: 2000,
  build_timeline: 1800,
  build_schedule: 2200,
  validate_feasibility: 1800,
  draft_document: 3600,
  generate_pdf: 12_000,
  calculate_budget: 1500,
  create_project: 12_000,
  generate_spreadsheet: 6500,
  generate_presentation: 6500,
});

export function agentOutputTokenBudget(toolName) {
  return OUTPUT_BUDGETS[toolName] || 1200;
}
