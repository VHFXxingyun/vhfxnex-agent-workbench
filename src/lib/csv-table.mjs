const MAX_COLUMNS = 20;
const MAX_ROWS = 501;
const MAX_CELL_LENGTH = 2000;

export function parseCsvTable(input) {
  if (typeof input !== "string") throw new Error("CSV 内容格式无效。");
  if (new TextEncoder().encode(input).byteLength > 1_000_000)
    throw new Error("CSV 文件不能超过 1 MB。");
  const text = input.replace(/^\uFEFF/u, "");
  if (!text.trim()) return { columns: ["列 1"], rows: [] };

  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let touched = false;
  const pushField = () => {
    if (field.length > MAX_CELL_LENGTH) throw new Error("单元格内容不能超过 2,000 个字符。");
    row.push(field);
    field = "";
    closedQuote = false;
    if (row.length > MAX_COLUMNS) throw new Error("最多支持 20 列。");
  };
  const pushRow = () => {
    pushField();
    records.push(row);
    row = [];
    touched = false;
    if (records.length > MAX_ROWS) throw new Error("最多支持 500 行数据。");
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      touched = true;
      continue;
    }
    if (closedQuote && character !== "," && character !== "\r" && character !== "\n")
      throw new Error("CSV 引号格式不完整，请先用表格软件另存为标准 CSV。");
    if (character === '"') {
      if (field.length) throw new Error("CSV 引号格式不完整。");
      quoted = true;
      touched = true;
    } else if (character === ",") {
      pushField();
      touched = true;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      field += character;
      touched = true;
    }
  }
  if (quoted) throw new Error("CSV 存在未闭合的引号。");
  if (touched || field.length || row.length) pushRow();
  if (!records.length) return { columns: ["列 1"], rows: [] };

  const width = Math.max(1, ...records.map((record) => record.length));
  const padded = records.map((record) => [
    ...record,
    ...Array.from({ length: width - record.length }, () => ""),
  ]);
  const columns = padded[0].map((cell, index) => cell.trim() || `列 ${index + 1}`);
  const rows = padded.slice(1);
  return { columns, rows };
}

export function serializeCsvTable(columns, rows) {
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > MAX_COLUMNS)
    throw new Error("表格列数无效。");
  if (!Array.isArray(rows) || rows.length > MAX_ROWS - 1) throw new Error("表格行数超出限制。");
  const safeCell = (value) => {
    let text = String(value ?? "");
    if (text.length > MAX_CELL_LENGTH) throw new Error("单元格内容不能超过 2,000 个字符。");
    if (/^[\t\r ]*[=+@-]/u.test(text) && !/^-?\d+(?:\.\d+)?$/u.test(text)) text = `'${text}`;
    return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [columns, ...rows].map((record) => record.map(safeCell).join(",")).join("\r\n");
  if (new TextEncoder().encode(csv).byteLength > 1_000_000)
    throw new Error("导出的 CSV 不能超过 1 MB。");
  return csv;
}
