const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
  ".sh",
  ".log",
  ".env.example",
]);
const MAX_DOCUMENT_BYTES = 5_000_000;
const MAX_EXTRACTED_CHARS = 120_000;
const MAX_OFFICE_UNCOMPRESSED_BYTES = 25_000_000;
const MAX_OFFICE_XML_BYTES = 5_000_000;

function fileExtension(name) {
  const normalized = name.toLowerCase();
  if (normalized.endsWith(".env.example")) return ".env.example";
  const dot = normalized.lastIndexOf(".");
  return dot > 0 ? normalized.slice(dot) : "";
}

function decodeXmlText(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, token) => {
    if (token[0] === "#") {
      const codePoint =
        token[1].toLowerCase() === "x"
          ? Number.parseInt(token.slice(2), 16)
          : Number.parseInt(token.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[token.toLowerCase()];
  });
}

function xmlTagText(xml, tagName) {
  const values = [];
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, "g");
  for (const match of xml.matchAll(tagPattern)) values.push(decodeXmlText(match[1]));
  return values.join("");
}

async function readOfficeArchive(file, extension) {
  const zipModule = await import("jszip");
  const JSZip = zipModule.default || zipModule;
  let archive;
  try {
    archive = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false });
  } catch {
    throw new Error("Office 文档无法打开，请确认文件完整且未损坏。");
  }
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  if (entries.length > 2_000) throw new Error("Office 文档包含过多文件，已停止读取。");
  const uncompressedBytes = entries.reduce(
    (total, entry) => total + (entry._data?.uncompressedSize || 0),
    0,
  );
  if (uncompressedBytes > MAX_OFFICE_UNCOMPRESSED_BYTES)
    throw new Error("Office 文档解压后超过 25 MB，请先压缩或拆分文件。");

  async function readXml(path) {
    const entry = archive.file(path);
    if (!entry) return "";
    if ((entry._data?.uncompressedSize || 0) > MAX_OFFICE_XML_BYTES)
      throw new Error("Office 文档中的单个 XML 文件超过 5 MB，已停止读取。");
    try {
      return await entry.async("string");
    } catch {
      throw new Error("Office 文档中的内容无法解压，请确认文件完整且未损坏。");
    }
  }

  if (extension === ".xlsx") {
    const sheetPaths = Object.keys(archive.files)
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
      .sort(
        (left, right) =>
          Number(left.match(/sheet(\d+)/)?.[1]) - Number(right.match(/sheet(\d+)/)?.[1]),
      );
    if (sheetPaths.length > 40) throw new Error("Excel 最多读取 40 个工作表。");
    const sharedXml = await readXml("xl/sharedStrings.xml");
    const sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si\s*>/g)].map((match) =>
      xmlTagText(match[1], "t"),
    );
    const sheets = [];
    for (let index = 0; index < sheetPaths.length; index += 1) {
      const xml = await readXml(sheetPaths[index]);
      const rows = new Map();
      const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c\s*>)/g;
      for (const cell of xml.matchAll(cellPattern)) {
        const reference = cell[1].match(/\br="([A-Z]+\d+)"/i)?.[1];
        if (!reference || !cell[2]) continue;
        const type = cell[1].match(/\bt="([^"]+)"/)?.[1];
        let value = "";
        if (type === "inlineStr") value = xmlTagText(cell[2], "t");
        else {
          const rawValue = xmlTagText(cell[2], "v");
          value = type === "s" ? sharedStrings[Number(rawValue)] || "" : rawValue;
        }
        if (!value) continue;
        const rowNumber = reference.match(/\d+$/)?.[0] || "";
        const row = rows.get(rowNumber) || [];
        row.push(`${reference}=${value}`);
        rows.set(rowNumber, row);
      }
      const rowText = [...rows.entries()]
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, cells]) => cells.join(" | "))
        .filter(Boolean)
        .join("\n");
      if (rowText) sheets.push(`工作表 ${index + 1}\n${rowText}`);
    }
    return sheets.join("\n\n");
  }

  const slidePaths = Object.keys(archive.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort(
      (left, right) =>
        Number(left.match(/slide(\d+)/)?.[1]) - Number(right.match(/slide(\d+)/)?.[1]),
    );
  if (slidePaths.length > 60) throw new Error("PowerPoint 最多读取 60 张幻灯片。");
  const slides = [];
  for (let index = 0; index < slidePaths.length; index += 1) {
    const xml = await readXml(slidePaths[index]);
    const slideText = xmlTagText(xml, "a:t").trim();
    if (slideText) slides.push(`第 ${index + 1} 张幻灯片\n${slideText}`);
  }
  return slides.join("\n\n");
}

/** @param {File} file */
export async function readChatDocument(file) {
  const extension = fileExtension(file.name);
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("文档不能超过 5 MB。");

  let text;
  if (TEXT_EXTENSIONS.has(extension) || file.type.startsWith("text/")) {
    text = await file.text();
  } else if (extension === ".docx") {
    const mammothModule = await import("mammoth");
    const mammoth = mammothModule.default || mammothModule;
    const arrayBuffer = await file.arrayBuffer();
    const input =
      typeof window === "undefined" ? { buffer: Buffer.from(arrayBuffer) } : { arrayBuffer };
    const result = await mammoth.extractRawText(input);
    text = result.value;
  } else if (extension === ".pdf" || file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/webpack.mjs");
    const standardFontDataUrl =
      typeof window === "undefined"
        ? `${process.cwd()}/public/pdfjs-standard-fonts/`
        : new URL("/pdfjs-standard-fonts/", window.location.origin).href;
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      standardFontDataUrl,
      useWorkerFetch: false,
    });
    try {
      const pdf = await loadingTask.promise;
      if (pdf.numPages > 40) throw new Error("PDF 最多读取 40 页，请拆分后再附加。");

      const pages = [];
      let extractedChars = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .filter(Boolean)
            .join(" ");
          pages.push(pageText);
          extractedChars += pageText.length + 2;
          if (extractedChars >= MAX_EXTRACTED_CHARS) break;
        } finally {
          page.cleanup();
        }
      }
      text = pages.join("\n\n");
    } finally {
      await loadingTask.destroy().catch(() => undefined);
    }
  } else if (
    extension === ".xlsx" ||
    extension === ".pptx" ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    const officeExtension =
      extension === ".xlsx" ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ? ".xlsx"
        : ".pptx";
    text = await readOfficeArchive(file, officeExtension);
  } else {
    throw new Error("支持图片、TXT、Markdown、CSV、代码、DOCX、XLSX、PPTX 和可提取文字的 PDF。");
  }

  const normalized = text.replace(/\u0000/g, "").trim();
  if (!normalized) throw new Error("没有从这个文档中读取到文字。");
  return normalized.slice(0, MAX_EXTRACTED_CHARS);
}

/** @param {File} file */
export function isSupportedChatTextFile(file) {
  const extension = fileExtension(file.name);
  return (
    TEXT_EXTENSIONS.has(extension) ||
    file.type.startsWith("text/") ||
    extension === ".docx" ||
    extension === ".xlsx" ||
    extension === ".pptx" ||
    extension === ".pdf" ||
    file.type === "application/pdf" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}
