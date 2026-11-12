export const agentToolCatalog = Object.freeze([
  Object.freeze({
    title: "规划与推进",
    description: "拆任务、定阶段、排日程、核预算",
    toolNames: Object.freeze([
      "create_tasks",
      "build_timeline",
      "build_schedule",
      "calculate_budget",
    ]),
  }),
  Object.freeze({
    title: "联网搜索",
    description: "查找当前资料，并附上可核验来源",
    toolNames: Object.freeze(["search_web"]),
  }),
  Object.freeze({
    title: "文档与数据文件",
    description: "生成可下载的 Word、PDF、Excel 和演示文稿",
    toolNames: Object.freeze([
      "draft_document",
      "generate_pdf",
      "generate_spreadsheet",
      "generate_presentation",
    ]),
  }),
  Object.freeze({
    title: "代码项目",
    description: "交付源码 ZIP、运行说明和网页预览",
    toolNames: Object.freeze(["create_project"]),
  }),
]);
