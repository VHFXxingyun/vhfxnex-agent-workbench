import type { Artifact } from "@/lib/goal";
import type { ParagraphChild } from "docx";

type WorkbookData = {
  sheets: { name: string; columns: string[]; rows: (string | number | boolean | null)[][] }[];
};

function parseContent<T>(content: string): T {
  return JSON.parse(content) as T;
}

async function toWordBlob(title: string, markdown: string): Promise<Blob> {
  const {
    BorderStyle,
    Document,
    ExternalHyperlink,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import("docx");
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  const inline = (value: string, style: { italics?: boolean } = {}): ParagraphChild[] => {
    const runs: ParagraphChild[] = [];
    const token =
      /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|\*([^*\n]+)\*)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = token.exec(value))) {
      if (match.index > cursor)
        runs.push(new TextRun({ text: value.slice(cursor, match.index), ...style }));
      if (match[2] && match[3]) {
        runs.push(
          new ExternalHyperlink({
            link: match[3],
            children: [new TextRun({ text: match[2], style: "Hyperlink", ...style })],
          }),
        );
      } else if (match[4] || match[5]) {
        runs.push(new TextRun({ text: match[4] || match[5], bold: true, ...style }));
      } else if (match[6]) {
        runs.push(new TextRun({ text: match[6], strike: true, ...style }));
      } else if (match[7]) {
        runs.push(
          new TextRun({
            text: match[7],
            font: "Consolas",
            color: "6B568A",
            shading: { fill: "F0ECF5" },
            ...style,
          }),
        );
      } else if (match[8]) {
        runs.push(new TextRun({ text: match[8], italics: true }));
      }
      cursor = token.lastIndex;
    }
    if (cursor < value.length) runs.push(new TextRun({ text: value.slice(cursor), ...style }));
    return runs.length ? runs : [new TextRun("")];
  };
  const tableRow = (cells: string[], header: boolean, columnCount: number) =>
    new TableRow({
      tableHeader: header,
      children: Array.from(
        { length: columnCount },
        (_, index) =>
          new TableCell({
            width: { size: 100 / columnCount, type: WidthType.PERCENTAGE },
            shading: header ? { fill: "EEE9F5" } : undefined,
            margins: { top: 90, bottom: 90, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: inline(cells[index] || ""),
                spacing: { after: 0, line: 280 },
              }),
            ],
          }),
      ),
    });
  const splitTableRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .replace(/\\\|/g, "\u0000")
      .split("|")
      .map((cell) => cell.split("\u0000").join("|").trim());
  const isTableStart = (index: number) =>
    Boolean(
      lines[index]?.includes("|") &&
      lines[index + 1]?.includes("|") &&
      splitTableRow(lines[index + 1]).every((cell) => /^:?-{3,}:?$/.test(cell)),
    );
  const isBlockStart = (index: number) =>
    /^(#{1,3})\s+/.test(lines[index] || "") ||
    /^\s*```/.test(lines[index] || "") ||
    /^\s*>/.test(lines[index] || "") ||
    /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(lines[index] || "") ||
    /^\s*(?:[-*_]\s*){3,}$/.test(lines[index] || "") ||
    isTableStart(index);

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
      children.push(
        new Paragraph({
          children: inline(heading[2]),
          heading:
            level === 1
              ? HeadingLevel.HEADING_1
              : level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 100 },
        }),
      );
      index += 1;
      continue;
    }
    if (/^\s*```/.test(line)) {
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: lines[index] || " ",
                font: "Consolas",
                size: 19,
                color: "51436A",
              }),
            ],
            shading: { fill: "F4F1F7" },
            indent: { left: 180, right: 120 },
            spacing: { before: 0, after: 0, line: 260 },
          }),
        );
        index += 1;
      }
      if (index < lines.length) index += 1;
      continue;
    }
    if (isTableStart(index)) {
      const headers = splitTableRow(lines[index]);
      const columnCount = Math.max(1, headers.length);
      const rows: InstanceType<typeof TableRow>[] = [tableRow(headers, true, columnCount)];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(tableRow(splitTableRow(lines[index]), false, columnCount));
        index += 1;
      }
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          columnWidths: Array.from({ length: columnCount }, () => Math.floor(9026 / columnCount)),
          rows,
        }),
      );
      children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      children.push(
        new Paragraph({
          children: inline(quote.join(" "), { italics: true }),
          indent: { left: 360 },
          border: { left: { style: BorderStyle.SINGLE, size: 14, color: "B49ADB", space: 8 } },
          spacing: { before: 80, after: 120, line: 310 },
        }),
      );
      continue;
    }
    const listItem = line.match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.+)$/);
    if (listItem) {
      const ordered = listItem[1] !== undefined;
      let number = ordered ? Number(listItem[1]) : 0;
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.+)$/);
        if (!item || (item[1] !== undefined) !== ordered) break;
        if (ordered) {
          number = Number(item[1]);
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${number}. `, bold: true, color: "65577A" }),
                ...inline(item[2]),
              ],
              indent: { left: 360, hanging: 240 },
              spacing: { after: 70, line: 300 },
            }),
          );
        } else {
          children.push(
            new Paragraph({
              children: inline(item[2]),
              bullet: { level: 0 },
              spacing: { after: 70, line: 300 },
            }),
          );
        }
        index += 1;
      }
      continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      children.push(
        new Paragraph({
          text: "",
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9D2E3", space: 1 } },
          spacing: { before: 80, after: 140 },
        }),
      );
      index += 1;
      continue;
    }
    if (children.length === 0 && lines[index + 1] !== undefined && !lines[index + 1].trim()) {
      children.push(
        new Paragraph({
          children: inline(line.trim()),
          heading: HeadingLevel.TITLE,
          spacing: { after: 180 },
        }),
      );
      index += 1;
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    children.push(
      new Paragraph({ children: inline(paragraph.join(" ")), spacing: { after: 90, line: 300 } }),
    );
  }
  const document = new Document({
    creator: "VHFXNEX Agent",
    title,
    description: "Agent 生成的可编辑文档",
    sections: [{ properties: {}, children }],
  });
  return Packer.toBlob(document);
}

async function toWorkbookBlob(content: string): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const data = parseContent<WorkbookData>(content);
  if (!Array.isArray(data.sheets) || data.sheets.length < 1 || data.sheets.length > 8)
    throw new Error("工作簿数据无效，无法导出 Excel。");
  const zip = new JSZip();
  const escapeXml = (value: string) =>
    value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const columnName = (index: number) => {
    let value = index + 1;
    let name = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  };
  const sheetNames = new Set<string>();
  const sheetXml = data.sheets.map((sheet, sheetIndex) => {
    if (!Array.isArray(sheet.columns) || !Array.isArray(sheet.rows))
      throw new Error("工作表缺少列名或数据行。");
    const name = sheet.name.slice(0, 31);
    if (!name || /[\\/?*\[\]:]/.test(name) || sheetNames.has(name.toLocaleLowerCase()))
      throw new Error("工作表名称重复或包含 Excel 不支持的字符。");
    sheetNames.add(name.toLocaleLowerCase());
    const rows = [sheet.columns, ...sheet.rows];
    const maxColumn = Math.max(1, ...rows.map((row) => row.length));
    const endCell = `${columnName(Math.max(0, maxColumn - 1))}${Math.max(1, rows.length)}`;
    const columnWidths = Array.from({ length: maxColumn }, (_, columnIndex) => {
      const measured = Math.max(
        ...rows.map((row) =>
          Array.from(String(row[columnIndex] ?? "")).reduce(
            (width, character) => width + (character.codePointAt(0)! > 255 ? 2 : 1),
            0,
          ),
        ),
      );
      return Math.max(12, Math.min(48, measured + 3));
    });
    const columnXml = columnWidths
      .map(
        (width, index) =>
          `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
      )
      .join("");
    const rowXml = rows
      .map((row, rowIndex) => {
        const cells = Array.from({ length: maxColumn }, (_, columnIndex) => {
          const cell = row[columnIndex];
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          const style = rowIndex === 0 ? ' s="1"' : "";
          if (cell === null || cell === undefined || cell === "")
            return rowIndex === 0 ? `<c r="${ref}"${style}/>` : "";
          if (typeof cell === "number") return `<c r="${ref}"${style} t="n"><v>${cell}</v></c>`;
          if (typeof cell === "boolean")
            return `<c r="${ref}"${style} t="b"><v>${cell ? 1 : 0}</v></c>`;
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell))}</t></is></c>`;
        }).join("");
        const rowHeight = rowIndex === 0 ? ' ht="26" customHeight="1"' : "";
        return `<row r="${rowIndex + 1}"${rowHeight}>${cells}</row>`;
      })
      .join("");
    zip.file(
      `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${endCell}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columnXml}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A1:${endCell}"/></worksheet>`,
    );
    return `<sheet name="${escapeXml(name)}" sheetId="${sheetIndex + 1}" r:id="rId${sheetIndex + 1}"/>`;
  });
  const rels = data.sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  const types = data.sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6C55A6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF4A376E"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${types}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetXml.join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${data.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file("xl/styles.xml", styles);
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

async function toPresentationBlob(
  title: string,
  description: string,
  content: string,
): Promise<Blob> {
  const response = await fetch("/api/artifacts/presentation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, content }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error || "PowerPoint 文件生成失败，请重试。");
  }
  return response.blob();
}

async function toPdfBlob(title: string, description: string, content: string): Promise<Blob> {
  const response = await fetch("/api/artifacts/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, content }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error || "PDF 文件生成失败，请重试。");
  }
  return response.blob();
}

export async function createArtifactDownload(
  artifact: Artifact,
  content: string,
  format: "primary" | "markdown" = "primary",
): Promise<{ blob: Blob; extension: string; message: string }> {
  if (format === "markdown") {
    return {
      blob: new Blob([content], { type: "text/markdown;charset=utf-8" }),
      extension: "md",
      message: "Markdown 文件已开始下载。",
    };
  }
  if (artifact.type === "document") {
    return {
      blob: await toWordBlob(artifact.title, content),
      extension: "docx",
      message: "Word 文档已开始下载。",
    };
  }
  if (artifact.type === "spreadsheet") {
    return {
      blob: await toWorkbookBlob(artifact.content),
      extension: "xlsx",
      message: "Excel 工作簿已开始下载。",
    };
  }
  if (artifact.type === "presentation") {
    return {
      blob: await toPresentationBlob(artifact.title, artifact.description, artifact.content),
      extension: "pptx",
      message: "PowerPoint 演示稿已开始下载。",
    };
  }
  if (artifact.type === "pdf") {
    return {
      blob: await toPdfBlob(artifact.title, artifact.description, content),
      extension: "pdf",
      message: "PDF 文档已开始下载。",
    };
  }
  return {
    blob: new Blob([content], { type: "text/markdown;charset=utf-8" }),
    extension: "md",
    message: "Markdown 文件已开始下载。",
  };
}
