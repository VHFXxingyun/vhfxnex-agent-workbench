import path from "node:path";
import * as fontkit from "fontkit";
import PDFDocument from "pdfkit";

type InlineStyle = {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
};
type InlineRun = { text: string; style: InlineStyle };
type DrawOptions = {
  size?: number;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  lineGap?: number;
};

const PDF_FONT = path.join(process.cwd(), "public", "fonts", "NotoSansSC-GB2312.ttf");
let fontCharacterMap: fontkit.Font | undefined;

function parseInline(value: string, base: InlineStyle = {}): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|\*([^*\n]+)\*)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) runs.push({ text: value.slice(cursor, start), style: base });
    if (match[2] && match[3]) {
      runs.push({ text: match[2], style: { ...base, link: match[3] } });
    } else if (match[4] || match[5]) {
      runs.push({ text: match[4] || match[5], style: { ...base, bold: true } });
    } else if (match[6]) {
      runs.push({ text: match[6], style: { ...base, strike: true } });
    } else if (match[7]) {
      runs.push({ text: match[7], style: { ...base, code: true } });
    } else if (match[8]) {
      runs.push({ text: match[8], style: { ...base, italic: true } });
    }
    cursor = start + match[0].length;
  }
  if (cursor < value.length) runs.push({ text: value.slice(cursor), style: base });
  return runs.length ? runs : [{ text: value, style: base }];
}

function splitByFont(
  value: string,
  resolveFont: (codePoint: number) => string,
): { text: string; font: string }[] {
  const groups: { text: string; font: string }[] = [];
  for (const character of value) {
    const font = resolveFont(character.codePointAt(0) || 0);
    const last = groups.at(-1);
    if (last?.font === font) last.text += character;
    else groups.push({ text: character, font });
  }
  return groups;
}

function drawRuns(
  doc: PDFKit.PDFDocument,
  runs: InlineRun[],
  resolveFont: (codePoint: number) => string,
  options: DrawOptions = {},
) {
  const chunks = runs.flatMap((run) =>
    splitByFont(run.text, resolveFont).map((group) => ({ ...group, style: run.style })),
  );
  if (chunks.length === 0) return;
  chunks.forEach((group, index) => {
    const style = group.style;
    const color = style.link ? "#5F4A84" : style.code ? "#674D82" : options.color || "#282630";
    doc
      .font(group.font)
      .fontSize(options.size || 10.5)
      .fillColor(color);
    const textOptions: PDFKit.Mixins.TextOptions = {
      continued: index < chunks.length - 1,
      lineGap: options.lineGap ?? 3,
      ...(options.width ? { width: options.width } : {}),
      ...(index === 0 && options.x !== undefined ? { x: options.x } : {}),
      ...(index === 0 && options.y !== undefined ? { y: options.y } : {}),
      ...(style.link ? { link: style.link, underline: true } : {}),
      ...(style.strike ? { strike: true } : {}),
      ...(style.italic || options.italic ? { oblique: 10 } : {}),
    };
    doc.text(group.text, textOptions);
  });
  doc.lineWidth(1);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .replace(/\\\|/g, "\u0000")
    .split("|")
    .map((cell) => cell.split("\u0000").join("|").trim());
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(
    lines[index]?.includes("|") &&
    lines[index + 1]?.includes("|") &&
    splitTableRow(lines[index + 1]).every((cell) => /^:?-{3,}:?$/.test(cell)),
  );
}

function isBlockStart(lines: string[], index: number): boolean {
  return (
    /^(#{1,3})\s+/.test(lines[index] || "") ||
    /^\s*```/.test(lines[index] || "") ||
    /^\s*>/.test(lines[index] || "") ||
    /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(lines[index] || "") ||
    /^\s*(?:[-*_]\s*){3,}$/.test(lines[index] || "") ||
    isTableStart(lines, index)
  );
}

function tableRows(lines: string[], index: number): { rows: string[][]; next: number } {
  const rows = [splitTableRow(lines[index])];
  let cursor = index + 2;
  while (cursor < lines.length && lines[cursor].trim() && lines[cursor].includes("|")) {
    rows.push(splitTableRow(lines[cursor]));
    cursor += 1;
  }
  return { rows, next: cursor };
}

export async function createPdfDocument(
  title: string,
  description: string,
  markdown: string,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 104, right: 56, bottom: 56, left: 56 },
    bufferPages: true,
    compress: true,
    info: {
      Title: title,
      Author: "VHFXNEX Agent",
      Subject: description.slice(0, 500),
      Creator: "VHFXNEX",
    },
  });
  doc.registerFont("NotoSansSC", PDF_FONT);
  fontCharacterMap ??= fontkit.openSync(PDF_FONT);
  const resolveFont = (codePoint: number) =>
    fontCharacterMap?.hasGlyphForCodePoint(codePoint) ? "NotoSansSC" : "Helvetica";

  const output = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(chunks)));
  });

  doc.fillColor("#6B558D");
  drawRuns(doc, parseInline(title), resolveFont, {
    size: 24,
    color: "#211C2B",
    bold: true,
    lineGap: 4,
  });
  if (description.trim()) {
    doc.moveDown(0.28);
    drawRuns(doc, parseInline(description), resolveFont, {
      size: 10,
      color: "#706C78",
      lineGap: 2,
    });
  }
  doc.moveDown(0.75);
  doc
    .strokeColor("#DAD2E7")
    .lineWidth(1)
    .moveTo(56, doc.y)
    .lineTo(doc.page.width - 56, doc.y)
    .stroke();
  doc.moveDown(0.65);

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] && /^#\s+/.test(lines[0]) && lines[0].replace(/^#\s+/, "").trim() === title.trim()) {
    lines.shift();
  }
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      doc.moveDown(level === 1 ? 0.62 : 0.32);
      const headingColor = level === 1 ? "#362B48" : level === 2 ? "#594474" : "#675C77";
      if (level === 1) {
        doc
          .fillColor("#B49ADB")
          .roundedRect(56, doc.y + 2, 3, 20, 1.5)
          .fill();
      }
      drawRuns(doc, parseInline(heading[2]), resolveFont, {
        size: level === 1 ? 18 : level === 2 ? 14 : 12,
        color: headingColor,
        bold: true,
        x: level === 1 ? 68 : undefined,
        lineGap: 2,
      });
      doc.moveDown(0.2);
      index += 1;
      continue;
    }
    if (/^\s*```/.test(line)) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      doc.moveDown(0.18);
      doc
        .fillColor("#6B558D")
        .roundedRect(56, doc.y + 2, 2.5, 18, 1)
        .fill();
      for (const codeLine of codeLines) {
        drawRuns(doc, [{ text: codeLine || " ", style: { code: true } }], resolveFont, {
          size: 8.5,
          color: "#55456A",
          x: 68,
          width: doc.page.width - 124,
          lineGap: 2,
        });
      }
      doc.moveDown(0.25);
      continue;
    }
    if (isTableStart(lines, index)) {
      const table = tableRows(lines, index);
      const headers = table.rows[0];
      drawRuns(doc, parseInline(headers.join("    ·    ")), resolveFont, {
        size: 9,
        color: "#54436D",
        bold: true,
      });
      doc.moveDown(0.16);
      doc
        .strokeColor("#E4DFEA")
        .lineWidth(0.7)
        .moveTo(56, doc.y)
        .lineTo(doc.page.width - 56, doc.y)
        .stroke();
      for (const row of table.rows.slice(1)) {
        const cells = headers.map((header, cellIndex) => {
          const value = row[cellIndex] || "—";
          return header ? `${header}：${value}` : value;
        });
        drawRuns(doc, parseInline(cells.join("    ·    ")), resolveFont, {
          size: 9,
          color: "#393541",
          lineGap: 2,
        });
        doc.moveDown(0.12);
      }
      doc.moveDown(0.25);
      index = table.next;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      doc.moveDown(0.18);
      doc
        .strokeColor("#B49ADB")
        .lineWidth(2)
        .moveTo(58, doc.y)
        .lineTo(58, doc.y + 18)
        .stroke();
      drawRuns(doc, parseInline(quote.join(" "), { italic: true }), resolveFont, {
        size: 10,
        color: "#5F5969",
        x: 70,
        width: doc.page.width - 126,
        italic: true,
      });
      doc.moveDown(0.25);
      continue;
    }
    const listItem = line.match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.+)$/);
    if (listItem) {
      const ordered = listItem[1] !== undefined;
      let number = ordered ? Number(listItem[1]) : 0;
      const renderItem = (itemText: string, ordinal?: string) => {
        const itemY = doc.y;
        if (ordinal) {
          const bodyRuns = parseInline(itemText);
          drawRuns(
            doc,
            [{ text: `${ordinal}. `, style: { bold: true } }, ...bodyRuns],
            resolveFont,
            { size: 10, color: "#302D37", lineGap: 3.5 },
          );
        } else {
          doc
            .fillColor("#9A82BF")
            .circle(62, itemY + 8, 2.2)
            .fill();
          drawRuns(doc, parseInline(itemText), resolveFont, {
            size: 10,
            color: "#302D37",
            x: 76,
            y: itemY,
            width: doc.page.width - 132,
          });
        }
        doc.moveDown(0.18);
      };
      renderItem(listItem[2], ordered ? String(number) : undefined);
      index += 1;
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.+)$/);
        if (!item || (item[1] !== undefined) !== ordered) break;
        number = ordered ? Number(item[1]) : number;
        renderItem(item[2], ordered ? String(number) : undefined);
        index += 1;
      }
      continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      doc.moveDown(0.25);
      doc
        .strokeColor("#DDD7E6")
        .lineWidth(0.8)
        .moveTo(56, doc.y)
        .lineTo(doc.page.width - 56, doc.y)
        .stroke();
      doc.moveDown(0.25);
      index += 1;
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    drawRuns(doc, parseInline(paragraph.join(" ")), resolveFont, {
      size: 10,
      color: "#302D37",
      lineGap: 3.5,
    });
    doc.moveDown(0.35);
  }

  const pages = doc.bufferedPageRange();
  const totalPages = pages.count;
  for (let pageNumber = pages.start; pageNumber < pages.start + pages.count; pageNumber += 1) {
    doc.switchToPage(pageNumber);
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.strokeColor("#DFD9E7").lineWidth(0.7).moveTo(left, 58).lineTo(right, 58).stroke();
    doc.font("Helvetica").fontSize(8).fillColor("#706B79");
    doc.text("VHFXNEX  |  GOAL TO ACTION", left, 34, { lineBreak: false });
    doc.text(`${pageNumber - pages.start + 1} / ${totalPages}`, right - 44, doc.page.height - 36, {
      width: 44,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
  return output;
}
