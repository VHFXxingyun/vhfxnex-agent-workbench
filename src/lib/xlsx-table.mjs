const MAX_ARCHIVE_BYTES = 10_000_000;
const MAX_EXPANDED_BYTES = 8_000_000;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_ROWS = 501;
const MAX_COLUMNS = 20;
const MAX_CELL_LENGTH = 2_000;

function inspectZipDirectory(buffer) {
  if (
    !(buffer instanceof ArrayBuffer) ||
    buffer.byteLength < 22 ||
    buffer.byteLength > MAX_ARCHIVE_BYTES
  )
    throw new Error("Excel 文件无效或超过 10 MB。请先另存为较小的 .xlsx 文件。");

  const view = new DataView(buffer);
  const lowerBound = Math.max(0, buffer.byteLength - 22 - 65_535);
  let endOffset = -1;
  for (let offset = buffer.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === buffer.byteLength) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Excel 文件的 ZIP 目录损坏或不受支持。");

  const disk = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const entries = view.getUint16(endOffset + 10, true);
  const directoryBytes = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    diskEntries !== entries ||
    entries === 0xffff ||
    directoryBytes === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    entries > MAX_ARCHIVE_ENTRIES ||
    directoryOffset + directoryBytes > endOffset
  )
    throw new Error("Excel 文件使用了当前工具不支持的 ZIP 格式。");

  let offset = directoryOffset;
  let expandedBytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > endOffset || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("Excel 文件的 ZIP 目录不完整。");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const uncompressedBytes = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (offset + recordLength > endOffset || diskStart !== 0 || (flags & 1) !== 0)
      throw new Error("Excel 文件包含损坏、分卷或加密内容，无法导入。");
    if (method !== 0 && method !== 8) throw new Error("Excel 文件使用了不支持的压缩格式。");
    const nameStart = offset + 46;
    const name = decoder.decode(new Uint8Array(buffer, nameStart, nameLength));
    const normalizedName = name.replaceAll("\\", "/");
    if (normalizedName.startsWith("/") || normalizedName.split("/").includes(".."))
      throw new Error("Excel 文件包含无效的内部路径。");
    expandedBytes += uncompressedBytes;
    if (expandedBytes > MAX_EXPANDED_BYTES)
      throw new Error("Excel 文件解压后的内容超过 8 MB，请先精简文件。");
    offset += recordLength;
  }
  if (offset !== directoryOffset + directoryBytes)
    throw new Error("Excel 文件的 ZIP 目录大小不匹配。");
}

function parseXml(text, label) {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length)
    throw new Error(`Excel 的${label}无法解析，文件可能已损坏。`);
  return document;
}

function childElements(element, localName) {
  return Array.from(element.getElementsByTagNameNS("*", localName));
}

function resolveArchivePath(baseDirectory, target) {
  const stack = target.startsWith("/") ? [] : baseDirectory.split("/").filter(Boolean);
  for (const part of target.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!stack.length) throw new Error("Excel 文件包含越界的内部路径。");
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

function columnIndex(reference) {
  const match = /^([A-Z]+)(\d+)$/iu.exec(reference);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column: column - 1, row: Number(match[2]) - 1 };
}

function cellText(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr")
    return childElements(cell, "t")
      .map((node) => node.textContent || "")
      .join("");
  const value = childElements(cell, "v")[0]?.textContent || "";
  if (type === "s") {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length)
      throw new Error("Excel 文件引用了不存在的共享文本。");
    return sharedStrings[index];
  }
  if (type === "b") return value === "1" ? "TRUE" : value === "0" ? "FALSE" : value;
  return value;
}

/** Reads visible worksheets without evaluating formulas or external workbook references. */
export async function readXlsxWorkbook(buffer) {
  inspectZipDirectory(buffer);
  const JSZip = (await import("jszip")).default;
  let archive;
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: false });
  } catch {
    throw new Error("Excel 文件无法打开；请确认它是未加密的 .xlsx 文件。");
  }

  const readXml = async (path, label) => {
    const entry = archive.file(path);
    if (!entry) throw new Error(`Excel 文件缺少${label}。`);
    return parseXml(await entry.async("string"), label);
  };
  const workbook = await readXml("xl/workbook.xml", "工作簿信息");
  const sheetNodes = childElements(workbook, "sheet");
  if (!sheetNodes.length || sheetNodes.length > 100)
    throw new Error("Excel 文件没有工作表，或工作表数量超过 100 个。");
  const visibleSheets = sheetNodes.filter(
    (sheet) => !sheet.getAttribute("state") || sheet.getAttribute("state") === "visible",
  );
  if (!visibleSheets.length) throw new Error("Excel 文件没有可见工作表。");
  if (visibleSheets.length > 8)
    throw new Error("当前工具最多支持 8 张可见工作表；请先拆分或精简工作簿。");

  const relationships = await readXml("xl/_rels/workbook.xml.rels", "工作表引用");
  const relationNodes = childElements(relationships, "Relationship");

  let sharedStrings = [];
  if (archive.file("xl/sharedStrings.xml")) {
    const shared = await readXml("xl/sharedStrings.xml", "共享文本");
    sharedStrings = childElements(shared, "si").map((item) =>
      childElements(item, "t")
        .map((node) => node.textContent || "")
        .join(""),
    );
  }

  const sheets = [];
  let formulaCount = 0;
  let workbookDataBytes = 0;
  for (const [sheetIndex, sheetNode] of visibleSheets.entries()) {
    const sheetName =
      sheetNode.getAttribute("name")?.trim().slice(0, 80) || `Sheet${sheetIndex + 1}`;
    const relationId =
      sheetNode.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      ) || sheetNode.getAttribute("r:id");
    if (!relationId) throw new Error(`工作表“${sheetName}”缺少内部引用。`);
    const relation = relationNodes.find((item) => item.getAttribute("Id") === relationId);
    const target = relation?.getAttribute("Target");
    if (
      !target ||
      relation?.getAttribute("TargetMode") === "External" ||
      !relation?.getAttribute("Type")?.endsWith("/worksheet")
    )
      throw new Error(`工作表“${sheetName}”的内部引用无效。`);
    const sheetPath = resolveArchivePath("xl", target);
    const worksheet = await readXml(sheetPath, `工作表“${sheetName}”`);

    const matrix = new Map();
    let sheetFormulaCount = 0;
    for (const cell of childElements(worksheet, "c")) {
      const reference = cell.getAttribute("r");
      const position = reference ? columnIndex(reference) : null;
      if (!position) continue;
      const hasFormula = childElements(cell, "f").length > 0;
      if (hasFormula) sheetFormulaCount += 1;
      const text = cellText(cell, sharedStrings);
      if (text.length > MAX_CELL_LENGTH)
        throw new Error(`工作表“${sheetName}”有单元格超过 2,000 个字符，请先精简。`);
      if (!text && !hasFormula) continue;
      if (position.column < 0 || position.column >= MAX_COLUMNS)
        throw new Error(`工作表“${sheetName}”超过 20 列，请先隐藏或移除多余列。`);
      if (position.row < 0 || position.row >= MAX_ROWS)
        throw new Error(`工作表“${sheetName}”超过 500 行数据，请先精简。`);
      const row = matrix.get(position.row) || [];
      row[position.column] = text;
      matrix.set(position.row, row);
    }

    const records = [...matrix.entries()].sort(([left], [right]) => left - right);
    const width = records.length ? Math.max(1, ...records.map(([, row]) => row.length)) : 1;
    const padded = records.length
      ? records.map(([, row]) => Array.from({ length: width }, (_, index) => row[index] || ""))
      : [["列 1"]];
    const columns = padded[0].map((value, index) => value.trim() || `列 ${index + 1}`);
    const rows = records.length ? padded.slice(1) : [];
    workbookDataBytes += new TextEncoder().encode(
      JSON.stringify({ sheetName, columns, rows }),
    ).byteLength;
    if (workbookDataBytes > 1_000_000)
      throw new Error("Excel 表格数据超过 1 MB，请先精简工作簿后导入。");
    formulaCount += sheetFormulaCount;
    sheets.push({ name: sheetName, columns, rows, formulaCount: sheetFormulaCount });
  }
  return { sheets, sheetCount: sheetNodes.length, formulaCount };
}
