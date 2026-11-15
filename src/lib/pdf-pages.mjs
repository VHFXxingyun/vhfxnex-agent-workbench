export function parsePdfPageSelection(value, pageCount) {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) throw new Error("输入要提取的页码，例如 1-3, 5。");
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("PDF 页数无效。");

  const pages = new Set();
  for (const part of input.split(",")) {
    const token = part.trim();
    const match = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/u);
    if (!match) throw new Error(`页码格式无效：${token || "空项"}。请使用 1-3, 5。`);
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > pageCount)
      throw new Error(`页码范围 ${token} 超出 1-${pageCount} 页。`);
    for (let page = start; page <= end; page += 1) {
      pages.add(page - 1);
      if (pages.size > 300) throw new Error("一次最多提取 300 页。");
    }
  }
  return [...pages];
}
