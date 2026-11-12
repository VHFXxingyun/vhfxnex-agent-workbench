import { Fragment, useState, type ReactNode } from "react";
import type { Artifact } from "@/lib/goal";
import { buildStaticPreviewDocument } from "@/lib/static-preview.mjs";

type Workbook = {
  sheets: { name: string; columns: string[]; rows: (string | number | boolean | null)[][] }[];
};
type Presentation = {
  slides: { title: string; bullets: string[]; speakerNotes?: string }[];
};

function renderInline(text: string): ReactNode {
  const token =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|\*([^*\n]+)\*)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const key = `${match.index}-${match[0]}`;
    if (match[2] && match[3]) {
      nodes.push(
        <a key={key} href={match[3]} target="_blank" rel="noopener noreferrer">
          {match[2]}
        </a>,
      );
    } else if (match[4] || match[5]) {
      nodes.push(<strong key={key}>{match[4] || match[5]}</strong>);
    } else if (match[6]) {
      nodes.push(<del key={key}>{match[6]}</del>);
    } else if (match[7]) {
      nodes.push(<code key={key}>{match[7]}</code>);
    } else if (match[8]) {
      nodes.push(<em key={key}>{match[8]}</em>);
    }
    cursor = token.lastIndex;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function splitTableRow(line: string) {
  const escapedPipe = "\u0000";
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .replace(/\\\|/g, escapedPipe)
    .split("|")
    .map((cell) => cell.split(escapedPipe).join("|").trim());
}

function isTableStart(lines: string[], index: number) {
  if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("|")) return false;
  return splitTableRow(lines[index + 1]).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] || "";
  return (
    /^#{1,3}\s+/.test(line) ||
    /^\s*```/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line) ||
    /^\s*(?:[-*_]\s*){3,}$/.test(line) ||
    isTableStart(lines, index)
  );
}

function DocumentPreview({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  const add = (node: ReactNode) => blocks.push(<Fragment key={blocks.length}>{node}</Fragment>);

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const children = renderInline(heading[2]);
      add(
        heading[1].length === 1 ? (
          <h1>{children}</h1>
        ) : heading[1].length === 2 ? (
          <h2>{children}</h2>
        ) : (
          <h3>{children}</h3>
        ),
      );
      index += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      add(
        <pre data-language={language || undefined}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      add(
        <div className="artifact-document-table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((cell, cellIndex) => (
                  <th key={`${cellIndex}-${cell}`}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, cellIndex) => (
                    <td key={cellIndex}>{renderInline(row[cellIndex] || "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      add(<blockquote>{renderInline(quote.join(" "))}</blockquote>);
      continue;
    }

    const listItem = line.match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.+)$/);
    if (listItem) {
      const ordered = listItem[1] !== undefined;
      const start = ordered ? Number(listItem[1]) : undefined;
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.+)$/);
        if (!item || (item[1] !== undefined) !== ordered) break;
        items.push(item[2]);
        index += 1;
      }
      add(
        ordered ? (
          <ol start={start}>
            {items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </ol>
        ) : (
          <ul>
            {items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </ul>
        ),
      );
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      add(<hr />);
      index += 1;
      continue;
    }

    if (blocks.length === 0 && lines[index + 1] !== undefined && !lines[index + 1].trim()) {
      add(<h1>{renderInline(line.trim())}</h1>);
      index += 1;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    add(<p>{renderInline(paragraph.join(" "))}</p>);
  }

  return (
    <article className="artifact-document-preview" aria-label="方案预览">
      {blocks}
    </article>
  );
}

function ProjectPreview({ artifact }: { artifact: Artifact }) {
  const files = artifact.files || [];
  const previewDocument = buildStaticPreviewDocument(files);
  const [view, setView] = useState<"preview" | "source">(previewDocument ? "preview" : "source");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");

  return (
    <div className="code-artifact-preview">
      {previewDocument && (
        <div className="code-preview-toolbar">
          <div className="code-preview-controls" role="group" aria-label="代码项目查看方式">
            <button
              type="button"
              aria-pressed={view === "preview"}
              onClick={() => setView("preview")}
            >
              网页预览
            </button>
            <button
              type="button"
              aria-pressed={view === "source"}
              onClick={() => setView("source")}
            >
              源文件
            </button>
          </div>
          {view === "preview" && (
            <div className="code-preview-controls" role="group" aria-label="预览视口大小">
              <button
                type="button"
                aria-pressed={viewport === "desktop"}
                onClick={() => setViewport("desktop")}
              >
                桌面
              </button>
              <button
                type="button"
                aria-pressed={viewport === "mobile"}
                onClick={() => setViewport("mobile")}
              >
                手机 390px
              </button>
            </div>
          )}
        </div>
      )}
      {previewDocument && view === "preview" ? (
        <div className={`code-preview-surface ${viewport === "mobile" ? "mobile" : ""}`}>
          <iframe
            title={`${artifact.title} 网页预览`}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={previewDocument}
          />
          <p>隔离静态预览：显示 HTML 与本地样式，不运行项目脚本或访问网络。</p>
        </div>
      ) : (
        <div className="project-file-preview" aria-label="项目源文件">
          {files.map((file, index) => (
            <details key={file.path} open={index === 0}>
              <summary>{file.path}</summary>
              <pre>{file.content}</pre>
            </details>
          ))}
          <p>平台不会自动运行生成代码。下载 ZIP 后解压，并按 README.md 的步骤在本地运行。</p>
        </div>
      )}
    </div>
  );
}

export default function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  if (artifact.type === "code") return <ProjectPreview artifact={artifact} />;
  if (artifact.type === "spreadsheet") {
    let workbook: Workbook | null = null;
    try {
      workbook = JSON.parse(artifact.content) as Workbook;
    } catch {
      workbook = null;
    }
    if (!workbook || !Array.isArray(workbook.sheets)) return <pre>{artifact.content}</pre>;
    return (
      <div className="spreadsheet-preview" aria-label="工作簿预览">
        {workbook.sheets.map((sheet) => (
          <section key={sheet.name}>
            <h3>{sheet.name}</h3>
            <div className="spreadsheet-table-wrap">
              <table>
                <thead>
                  <tr>
                    {sheet.columns.map((column, index) => (
                      <th key={`${column}-${index}`}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.slice(0, 12).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {sheet.columns.map((_, columnIndex) => (
                        <td key={columnIndex}>
                          {row[columnIndex] === null ? "" : row[columnIndex]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sheet.rows.length > 12 && <small>预览前 12 行；下载 Excel 查看完整数据。</small>}
          </section>
        ))}
      </div>
    );
  }
  if (artifact.type === "presentation") {
    let presentation: Presentation | null = null;
    try {
      presentation = JSON.parse(artifact.content) as Presentation;
    } catch {
      presentation = null;
    }
    if (!presentation || !Array.isArray(presentation.slides)) return <pre>{artifact.content}</pre>;
    return (
      <div className="presentation-preview" aria-label="演示稿预览">
        {presentation.slides.map((slide, index) => (
          <article key={`${index}-${slide.title}`}>
            <div>
              <span>SLIDE {String(index + 1).padStart(2, "0")}</span>
              <small>
                {String(index + 1).padStart(2, "0")} / {presentation.slides.length}
              </small>
            </div>
            <h3>{slide.title}</h3>
            <ul>
              {slide.bullets.map((bullet, bulletIndex) => (
                <li key={bulletIndex}>{bullet}</li>
              ))}
            </ul>
            {slide.speakerNotes && <p>演讲备注：{slide.speakerNotes}</p>}
          </article>
        ))}
      </div>
    );
  }
  if (artifact.type === "document" || artifact.type === "pdf")
    return <DocumentPreview content={artifact.content} />;
  return <pre>{artifact.content}</pre>;
}
