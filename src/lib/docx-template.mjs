import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { resolveDatabasePath } from "./database-path.mjs";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_TEMPLATE_BYTES = 1_000_000;
const SECTION_HEADING = /^(?:[一二三四五六七八九十]+、.+[：:]|活动主题[：:]|活动目的及意义[：:])$/u;

function templateFolder(userId) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(userId)) throw new Error("模板归属无效。");
  return path.join(path.dirname(resolveDatabasePath()), "docx-templates", userId);
}

function readTemplateDataUrl(dataUrl) {
  const match = /^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    dataUrl,
  );
  if (!match) throw new Error("DOCX 模板数据格式无效。");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TEMPLATE_BYTES)
    throw new Error("DOCX 模板不能超过 1 MB。");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04)
    throw new Error("附件不是有效的 DOCX 模板文件。");
  return bytes;
}

export function isDocxTemplateDataUrl(name, mimeType, dataUrl) {
  if (
    typeof name !== "string" ||
    !name.toLowerCase().endsWith(".docx") ||
    mimeType !== DOCX_MIME ||
    typeof dataUrl !== "string"
  )
    return false;
  try {
    readTemplateDataUrl(dataUrl);
    return true;
  } catch {
    return false;
  }
}

export function saveDocxTemplateForUser(userId, dataUrl) {
  const bytes = readTemplateDataUrl(dataUrl);
  const id = crypto.randomUUID();
  const folder = templateFolder(userId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${id}.docx`), bytes, { flag: "wx", mode: 0o600 });
  return id;
}

export function readDocxTemplateForUser(userId, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new Error("模板标识无效。");
  return fs.readFileSync(path.join(templateFolder(userId), `${id}.docx`));
}

function xmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)));
}

function xmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraphText(xml) {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => xmlText(match[1]))
    .join("")
    .trim();
}

function replaceParagraphText(xml, text) {
  let replaced = false;
  const result = xml.replace(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (_all, attributes = "") => {
    if (replaced) return `<w:t${attributes}></w:t>`;
    replaced = true;
    const preservedAttributes = /xml:space=/.test(attributes)
      ? attributes
      : `${attributes} xml:space="preserve"`;
    return `<w:t${preservedAttributes}>${xmlEscape(text)}</w:t>`;
  });
  if (!replaced) throw new Error("模板正文段落无法保留原有样式。");
  return result;
}

function directParagraphs(bodyXml) {
  const tokens = /<w:tbl\b[^>]*>|<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const paragraphs = [];
  let tableDepth = 0;
  let match;
  while ((match = tokens.exec(bodyXml))) {
    if (match[0].startsWith("<w:tbl")) {
      tableDepth += 1;
    } else if (match[0] === "</w:tbl>") {
      tableDepth = Math.max(0, tableDepth - 1);
    } else if (tableDepth === 0) {
      paragraphs.push({ start: match.index, end: tokens.lastIndex, xml: match[0] });
    }
  }
  return paragraphs;
}

function normalizedMarkdownHeading(line) {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .trim();
}

function canonicalTemplateHeading(heading) {
  return heading.replace(/^[一二三四五六七八九十]+、(?=(?:活动主题|活动目的及意义)[：:])/u, "");
}

function markdownSections(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const sectionStarts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = canonicalTemplateHeading(normalizedMarkdownHeading(lines[index]));
    if (SECTION_HEADING.test(heading)) sectionStarts.push({ index, heading });
  }
  const sections = new Map();
  for (let i = 0; i < sectionStarts.length; i += 1) {
    const current = sectionStarts[i];
    const next = sectionStarts[i + 1];
    const contentLines = lines.slice(current.index + 1, next?.index ?? lines.length);
    const blocks = [];
    let pending = [];
    const flush = () => {
      const value = pending.join(" ").trim();
      if (value) blocks.push({ type: "paragraph", text: value });
      pending = [];
    };
    for (let lineIndex = 0; lineIndex < contentLines.length; lineIndex += 1) {
      const sourceLine = contentLines[lineIndex];
      const line = sourceLine.trim();
      if (!line) {
        flush();
        continue;
      }
      if (line.startsWith("|") && line.endsWith("|")) {
        flush();
        const rows = [];
        while (lineIndex < contentLines.length) {
          const rowLine = contentLines[lineIndex].trim();
          if (!rowLine.startsWith("|") || !rowLine.endsWith("|")) break;
          const cells = rowLine
            .slice(1, -1)
            .split("|")
            .map((cell) => cell.trim());
          lineIndex += 1;
          if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
          rows.push(cells);
        }
        lineIndex -= 1;
        if (rows.length) blocks.push({ type: "table", rows });
        continue;
      }
      const cleaned = line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+[.)、]\s+/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim();
      if (/^(?:[-*+]\s+|\d+[.)、]\s+)/.test(line) || /^#{1,6}\s+/.test(line)) {
        flush();
        if (cleaned) blocks.push({ type: "paragraph", text: cleaned });
      } else {
        pending.push(cleaned);
      }
    }
    flush();
    sections.set(current.heading, blocks);
  }
  const titleLine = lines.find((line) => /^#\s+/.test(line.trim()));
  const firstSectionLine = sectionStarts[0]?.index ?? lines.length;
  const firstCoverLine = lines.slice(0, firstSectionLine).find((line) => line.trim());
  const title = titleLine
    ? normalizedMarkdownHeading(titleLine)
    : firstCoverLine
      ? normalizedMarkdownHeading(firstCoverLine)
      : "";
  return { sections, title };
}

function makeParagraphsLike(seed, texts) {
  if (!texts.length) return [];
  return texts.map((text, index) => {
    const clone = seed[index % seed.length];
    const hasNumbering = /<w:numPr\b/.test(clone);
    const cleanText = hasNumbering ? text.replace(/^\d+[.)、]\s*/, "") : text;
    return replaceParagraphText(clone, cleanText);
  });
}

function makeTableCellParagraph(seed, text, isHeader) {
  let paragraph = replaceParagraphText(seed, text)
    .replace(/<w:numPr\b[^>]*>[\s\S]*?<\/w:numPr>/g, "")
    .replace(/<w:ind\b[^>]*\/>/g, "")
    .replace(/<w:tabs\b[^>]*>[\s\S]*?<\/w:tabs>/g, "");
  if (!isHeader) return paragraph;
  if (/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.test(paragraph)) {
    return paragraph.replace(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/, (_all, properties) =>
      /<w:b\b/.test(properties) ? `<w:rPr>${properties}</w:rPr>` : `<w:rPr>${properties}<w:b/></w:rPr>`,
    );
  }
  return paragraph.replace(/<w:r\b[^>]*>/, (run) => `${run}<w:rPr><w:b/></w:rPr>`);
}

function makeWordTable(seed, rows) {
  const columnCount = Math.max(...rows.map((row) => row.length));
  const columnWidth = Math.floor(9000 / columnCount);
  const grid = Array.from({ length: columnCount }, () => `<w:gridCol w:w="${columnWidth}"/>`).join("");
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="C8C2D2"/>`)
    .join("");
  const tableRows = rows
    .map((row, rowIndex) => {
      const cells = Array.from({ length: columnCount }, (_, cellIndex) => {
        const text = row[cellIndex] || "";
        const shade = rowIndex === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="E9E3F1"/>' : "";
        return `<w:tc><w:tcPr><w:tcW w:w="${columnWidth}" w:type="dxa"/>${shade}</w:tcPr>${makeTableCellParagraph(seed, text, rowIndex === 0)}</w:tc>`;
      }).join("");
      const header = rowIndex === 0 ? '<w:trPr><w:tblHeader w:val="true"/></w:trPr>' : "";
      return `<w:tr>${header}${cells}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="autofit"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${tableRows}</w:tbl>`;
}

function makeBlocksLike(seed, blocks) {
  return blocks.map((block) =>
    block.type === "table"
      ? makeWordTable(seed[0], block.rows)
      : makeParagraphsLike(seed, [block.text])[0],
  );
}

export async function createDocxFromTemplate(templateBytes, markdown) {
  const zip = await JSZip.loadAsync(templateBytes, { checkCRC32: true });
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX 模板缺少正文内容。");
  let documentXml = await documentFile.async("string");
  const bodyMatch = documentXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/);
  if (!bodyMatch) throw new Error("DOCX 模板正文结构无效。");
  const bodyXml = bodyMatch[1];
  const paragraphs = directParagraphs(bodyXml);
  const headings = paragraphs
    .map((paragraph, index) => ({ index, text: paragraphText(paragraph.xml) }))
    .filter((paragraph) => SECTION_HEADING.test(paragraph.text));
  if (headings.length === 0) throw new Error("模板中没有识别到可保留的章节标题。");

  const { sections, title } = markdownSections(markdown);
  const edits = new Map();
  const insertions = new Map();
  const removed = new Set();
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const nextIndex = headings[index + 1]?.index ?? paragraphs.length;
    const blocks = sections.get(current.text);
    if (!blocks) throw new Error(`生成内容缺少模板章节「${current.text}」，无法安全套用格式。`);
    const bodyIndexes = [];
    for (let paragraphIndex = current.index + 1; paragraphIndex < nextIndex; paragraphIndex += 1) {
      if (paragraphText(paragraphs[paragraphIndex].xml)) bodyIndexes.push(paragraphIndex);
    }
    if (!bodyIndexes.length) throw new Error(`模板章节「${current.text}」没有可沿用样式的正文段落。`);
    const seed = bodyIndexes.map((paragraphIndex) => paragraphs[paragraphIndex].xml);
    insertions.set(nextIndex, makeBlocksLike(seed, blocks));
    for (const bodyIndex of bodyIndexes) removed.add(bodyIndex);
  }

  if (title) {
    const firstHeadingIndex = headings[0].index;
    const titleIndex = paragraphs.findIndex(
      (paragraph, index) => index < firstHeadingIndex && paragraphText(paragraph.xml),
    );
    if (titleIndex >= 0) edits.set(titleIndex, replaceParagraphText(paragraphs[titleIndex].xml, title));
  }
  const documentDate = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
    .format(new Date())
    .replace(/\s/g, "");
  const footerDateIndex = paragraphs.findIndex((paragraph) => /^时间[：:]/u.test(paragraphText(paragraph.xml)));
  if (footerDateIndex >= 0)
    edits.set(footerDateIndex, replaceParagraphText(paragraphs[footerDateIndex].xml, `时间：${documentDate}`));

  let rewrittenBody = "";
  let cursor = 0;
  for (let index = 0; index <= paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const position = paragraph?.start ?? bodyXml.length;
    rewrittenBody += bodyXml.slice(cursor, position);
    if (insertions.has(index)) rewrittenBody += insertions.get(index).join("");
    if (paragraph) {
      if (!removed.has(index)) rewrittenBody += edits.get(index) || paragraph.xml;
      cursor = paragraph.end;
    }
  }
  rewrittenBody += bodyXml.slice(cursor);
  documentXml = documentXml.replace(bodyMatch[0], bodyMatch[0].replace(bodyXml, rewrittenBody));
  documentXml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = paragraphText(paragraph);
    if (/^时间[：:]/u.test(text)) return replaceParagraphText(paragraph, `时间：${documentDate}`);
    if (/^\d{4}年\d{1,2}月\d{1,2}日$/u.test(text))
      return replaceParagraphText(paragraph, documentDate);
    return paragraph;
  });
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
