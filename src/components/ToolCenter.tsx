"use client";

import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import {
  ArrowDownToLine,
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  CloudCheck,
  Code2,
  FileSpreadsheet,
  FileInput,
  FileText,
  FolderOpen,
  Braces,
  LoaderCircle,
  Plus,
  Presentation,
  Search as SearchIcon,
  ExternalLink,
  Rows3,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import type { Artifact, ChatAttachment, ProjectFile } from "@/lib/goal";
import { createArtifactDownload } from "@/lib/artifact-export";
import { createProjectZip } from "@/lib/project-zip";
import { readChatDocument, isSupportedChatTextFile } from "@/lib/attachment-reader";
import { normalizeProjectPath } from "@/lib/project-path.mjs";
import { MarkdownContent } from "@/components/ArtifactPreview";
import { parseCsvTable, serializeCsvTable } from "@/lib/csv-table.mjs";
import { readXlsxWorkbook } from "@/lib/xlsx-table.mjs";
import { buildStaticPreviewDocument } from "@/lib/static-preview.mjs";
import PdfToolPanel from "@/components/PdfToolPanel";
import type { UserDirectToolId } from "@/lib/capability-catalog.mjs";
import {
  readCodeDraft,
  readDocumentDraft,
  readJsonDraft,
  readPresentationDraft,
  readSpreadsheetDraft,
} from "@/lib/direct-tool-draft.mjs";
import type {
  CodeDraft,
  DocumentDraft,
  JsonDraft,
  PresentationDraft,
  SpreadsheetSheetDraft,
  SpreadsheetDraft,
} from "@/lib/direct-tool-draft.mjs";

type Tool = UserDirectToolId;
type DraftTool = Exclude<Tool, "search" | "pdf">;
type DraftStatus = "loading" | "saving" | "saved" | "error";

function draftStorageKey(userId: string, tool: DraftTool) {
  return `vhfxnex:direct-tool-draft:v1:${userId}:${tool}`;
}

function saveLocalDraft(userId: string, tool: DraftTool, value: unknown) {
  const normalized =
    tool === "documents"
      ? readDocumentDraft(value)
      : tool === "code"
        ? readCodeDraft(value)
        : tool === "spreadsheet"
          ? readSpreadsheetDraft(value)
          : tool === "json"
            ? readJsonDraft(value)
            : readPresentationDraft(value);
  if (!normalized) throw new Error("草稿超出本机保存格式的限制；请先下载需要保留的内容。");
  window.localStorage.setItem(draftStorageKey(userId, tool), JSON.stringify(normalized));
}

function flushLocalDrafts(
  userId: string,
  drafts: Map<
    DraftTool,
    DocumentDraft | CodeDraft | SpreadsheetDraft | JsonDraft | PresentationDraft
  >,
) {
  for (const [tool, draft] of drafts) {
    try {
      saveLocalDraft(userId, tool, draft);
      drafts.delete(tool);
    } catch {
      // Keep each editor usable when browser storage is unavailable or full.
    }
  }
}

const starterFiles: ProjectFile[] = [
  {
    path: "index.html",
    content: `<!doctype html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>我的小工具</title>\n    <link rel="stylesheet" href="styles.css" />\n  </head>\n  <body>\n    <main class="app">\n      <p class="eyebrow">VHFXNEX · QUICK START</p>\n      <h1>从一个想法开始</h1>\n      <p>在这里编辑你的页面，然后下载完整源码。</p>\n      <button id="action">点击试试</button>\n      <p id="result" aria-live="polite"></p>\n    </main>\n    <script src="app.js"></script>\n  </body>\n</html>`,
  },
  {
    path: "styles.css",
    content: `:root { font-family: Inter, "Microsoft YaHei", sans-serif; color: #f5f1fa; background: #111116; }\n* { box-sizing: border-box; }\nbody { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; }\n.app { width: min(100%, 680px); padding: 48px; border: 1px solid #393443; border-radius: 28px; background: #1b1922; box-shadow: 0 28px 90px #0006; }\n.eyebrow { color: #cbb4ff; letter-spacing: .16em; font-size: 12px; }\nh1 { font-size: clamp(36px, 7vw, 64px); letter-spacing: -.06em; margin: 28px 0 14px; }\np { color: #aaa4b5; line-height: 1.7; }\nbutton { margin-top: 20px; border: 0; border-radius: 14px; padding: 14px 20px; color: #20182b; background: #c9a9ff; font: inherit; font-weight: 700; cursor: pointer; }`,
  },
  {
    path: "app.js",
    content: `const action = document.querySelector("#action");\nconst result = document.querySelector("#result");\naction?.addEventListener("click", () => {\n  result.textContent = "交互已连接。继续把你的想法做出来吧。";\n});`,
  },
  {
    path: "README.md",
    content: `# 我的 VHFXNEX 小工具\n\n## 运行\n\n直接用浏览器打开 index.html。\n\n## 文件\n\n- index.html：页面结构\n- styles.css：界面样式\n- app.js：交互逻辑\n`,
  },
];

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.hidden = true;
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function safeDownloadName(value: string, fallback: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
      .trim()
      .slice(0, 100) || fallback
  );
}

function codeLanguageForPath(filePath: string) {
  const extension = filePath.split(".").pop()?.toLowerCase();
  if (extension === "html" || extension === "htm") return { label: "HTML", support: html() };
  if (extension === "css") return { label: "CSS", support: css() };
  if (["js", "mjs", "cjs", "jsx"].includes(extension || ""))
    return { label: "JavaScript", support: javascript({ jsx: true }) };
  if (["ts", "tsx"].includes(extension || ""))
    return { label: "TypeScript", support: javascript({ typescript: true, jsx: true }) };
  if (extension === "json") return { label: "JSON", support: json() };
  if (extension === "md") return { label: "Markdown", support: markdown() };
  if (extension === "py") return { label: "Python", support: python() };
  if (extension === "java") return { label: "Java", support: java() };
  if (extension === "go") return { label: "Go", support: go() };
  if (extension === "rs") return { label: "Rust", support: rust() };
  if (extension === "sql") return { label: "SQL", support: sql() };
  if (extension === "yaml" || extension === "yml") return { label: "YAML", support: yaml() };
  return { label: "纯文本", support: null };
}

function makeCodeEditorScrollKeyboardAccessible(view: EditorView) {
  view.scrollDOM.tabIndex = 0;
  view.scrollDOM.setAttribute("aria-label", "代码编辑区滚动区域");
}

export default function ToolCenter({
  userId,
  onAskSupervisor,
  launch = null,
  onLaunchConsumed,
}: {
  userId: string;
  onAskSupervisor: (prompt: string, attachments?: ChatAttachment[]) => void;
  launch?: { id: string; tool: Tool; instruction: string; consumed: boolean } | null;
  onLaunchConsumed: (id: string) => void;
}) {
  const [selectedTool, setSelectedTool] = useState<Tool>(() =>
    launch && !launch.consumed ? launch.tool : "documents",
  );
  const [launchContext] = useState(() => (launch && !launch.consumed ? launch : null));
  useEffect(() => {
    if (launch && !launch.consumed) onLaunchConsumed(launch.id);
  }, [launch, onLaunchConsumed]);
  const [title, setTitle] = useState("未命名文档");
  const [documentText, setDocumentText] = useState(
    "# 新文档\n\n从这里开始整理你的内容。\n\n## 下一步\n\n- 添加要点\n- 调整结构\n- 导出为 Word 或 PDF",
  );
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentStatus, setDocumentStatus] = useState("");
  const [files, setFiles] = useState<ProjectFile[]>(starterFiles);
  const [activePath, setActivePath] = useState(starterFiles[0].path);
  const [projectTitle, setProjectTitle] = useState("我的小工具");
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectStatus, setProjectStatus] = useState("");
  const [codePreviewViewport, setCodePreviewViewport] = useState<"desktop" | "mobile">("desktop");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const spreadsheetInputRef = useRef<HTMLInputElement>(null);
  const [sheetName, setSheetName] = useState("我的表格");
  const [sheetColumns, setSheetColumns] = useState(["事项", "负责人", "状态", "截止日期"]);
  const [sheetRows, setSheetRows] = useState<string[][]>(
    Array.from({ length: 5 }, () => ["", "", "", ""]),
  );
  const [workbookSheets, setWorkbookSheets] = useState<SpreadsheetSheetDraft[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [sheetStatus, setSheetStatus] = useState("");
  const [jsonText, setJsonText] = useState(
    '{\n  "name": "VHFXNEX",\n  "tools": ["文档", "代码", "表格"]\n}',
  );
  const [jsonStatus, setJsonStatus] = useState("");
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [presentationTitle, setPresentationTitle] = useState("VHFXNEX 项目提案");
  const [presentationDescription, setPresentationDescription] = useState(
    "一份可编辑的演示稿，直接整理重点并导出 PowerPoint。",
  );
  const [presentationSlides, setPresentationSlides] = useState<PresentationDraft["slides"]>([
    {
      title: "从问题开始",
      bulletsText: "说明真实场景\n明确目标受众\n定义希望达成的变化",
      speakerNotes: "先用一个具体场景引出演示主题。",
    },
    {
      title: "方案与下一步",
      bulletsText: "聚焦核心方案\n说明实施步骤\n明确验证方式",
      speakerNotes: "最后总结行动安排和衡量标准。",
    },
  ]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [presentationStatus, setPresentationStatus] = useState("");
  const [presentationBusy, setPresentationBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ title: string; url: string; snippet: string }>
  >([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [collaborationStatus, setCollaborationStatus] = useState("");
  const activePresentationSlide = presentationSlides[activeSlideIndex] || presentationSlides[0];
  const [draftStatus, setDraftStatus] = useState<DraftStatus>("loading");
  const [draftsReady, setDraftsReady] = useState(false);
  const activeFile = files.find((file) => file.path === activePath) || files[0];
  const codePreviewDocument = useMemo(() => buildStaticPreviewDocument(files), [files]);
  const activeCodeLanguage = useMemo(
    () => codeLanguageForPath(activeFile?.path || ""),
    [activeFile?.path],
  );
  const codeEditorExtensions = useMemo(
    () => [
      EditorView.contentAttributes.of({ "aria-label": `${activeFile?.path || "项目"} 源码` }),
      ...(activeCodeLanguage.support ? [activeCodeLanguage.support] : []),
    ],
    [activeCodeLanguage.support, activeFile?.path],
  );
  const pendingDraftsRef = useRef(
    new Map<
      DraftTool,
      DocumentDraft | CodeDraft | SpreadsheetDraft | JsonDraft | PresentationDraft
    >(),
  );
  const wordCount = useMemo(
    () => documentText.trim().split(/\s+/u).filter(Boolean).length,
    [documentText],
  );

  function markDraftSaving() {
    if (draftsReady) setDraftStatus("saving");
  }

  useEffect(() => {
    let cancelled = false;
    let invalid = false;
    let documentDraft: DocumentDraft | null = null;
    let codeDraft: CodeDraft | null = null;
    let spreadsheetDraft: SpreadsheetDraft | null = null;
    let jsonDraft: JsonDraft | null = null;
    let presentationDraft: PresentationDraft | null = null;
    try {
      const documentValue = window.localStorage.getItem(draftStorageKey(userId, "documents"));
      if (documentValue) {
        documentDraft = readDocumentDraft(JSON.parse(documentValue));
        if (!documentDraft) invalid = true;
      }

      const codeValue = window.localStorage.getItem(draftStorageKey(userId, "code"));
      if (codeValue) {
        codeDraft = readCodeDraft(JSON.parse(codeValue));
        if (!codeDraft) invalid = true;
      }

      const spreadsheetValue = window.localStorage.getItem(draftStorageKey(userId, "spreadsheet"));
      if (spreadsheetValue) {
        spreadsheetDraft = readSpreadsheetDraft(JSON.parse(spreadsheetValue));
        if (!spreadsheetDraft) invalid = true;
      }

      const jsonValue = window.localStorage.getItem(draftStorageKey(userId, "json"));
      if (jsonValue) {
        jsonDraft = readJsonDraft(JSON.parse(jsonValue));
        if (!jsonDraft) invalid = true;
      }

      const presentationValue = window.localStorage.getItem(
        draftStorageKey(userId, "presentation"),
      );
      if (presentationValue) {
        presentationDraft = readPresentationDraft(JSON.parse(presentationValue));
        if (!presentationDraft) invalid = true;
      }
    } catch {
      invalid = true;
    }
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      if (documentDraft) {
        setTitle(documentDraft.title);
        setDocumentText(documentDraft.content);
      }
      if (codeDraft) {
        setProjectTitle(codeDraft.title);
        setFiles(codeDraft.files);
        setActivePath(codeDraft.activePath);
      }
      if (spreadsheetDraft) {
        setSheetName(spreadsheetDraft.name);
        setSheetColumns(spreadsheetDraft.columns);
        setSheetRows(spreadsheetDraft.rows);
        if (spreadsheetDraft.sheets?.length) {
          setWorkbookSheets(spreadsheetDraft.sheets);
          setActiveSheetIndex(spreadsheetDraft.activeSheetIndex || 0);
        }
      }
      if (jsonDraft) setJsonText(jsonDraft.content);
      if (presentationDraft) {
        setPresentationTitle(presentationDraft.title);
        setPresentationDescription(presentationDraft.description);
        setPresentationSlides(presentationDraft.slides);
        setActiveSlideIndex(presentationDraft.activeSlideIndex);
      }
      setDraftStatus(invalid ? "error" : "saved");
      // Even if localStorage is unavailable, keep the editors usable.
      setDraftsReady(true);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [userId]);

  useLayoutEffect(() => {
    if (!draftsReady) return;
    // Keep a synchronous snapshot so a fast route change cannot beat the
    // debounced autosave effect and discard the latest committed edit.
    pendingDraftsRef.current.set("documents", { title, content: documentText });
  }, [documentText, draftsReady, title]);

  useLayoutEffect(() => {
    if (!draftsReady) return;
    pendingDraftsRef.current.set("code", { title: projectTitle, files, activePath });
  }, [activePath, draftsReady, files, projectTitle]);

  useLayoutEffect(() => {
    if (!draftsReady) return;
    pendingDraftsRef.current.set("spreadsheet", {
      name: sheetName,
      columns: sheetColumns,
      rows: sheetRows,
      ...(workbookSheets.length ? { sheets: workbookSheets, activeSheetIndex } : {}),
    });
  }, [activeSheetIndex, draftsReady, sheetColumns, sheetName, sheetRows, workbookSheets]);

  useLayoutEffect(() => {
    if (!draftsReady) return;
    pendingDraftsRef.current.set("json", { content: jsonText });
  }, [draftsReady, jsonText]);

  useLayoutEffect(() => {
    if (!draftsReady) return;
    pendingDraftsRef.current.set("presentation", {
      title: presentationTitle,
      description: presentationDescription,
      slides: presentationSlides,
      activeSlideIndex,
    });
  }, [
    activeSlideIndex,
    draftsReady,
    presentationDescription,
    presentationSlides,
    presentationTitle,
  ]);

  useEffect(() => {
    const flush = () => flushLocalDrafts(userId, pendingDraftsRef.current);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [userId]);

  useEffect(() => {
    if (!draftsReady) return;
    const draft: DocumentDraft = { title, content: documentText };
    pendingDraftsRef.current.set("documents", draft);
    const timeout = window.setTimeout(() => {
      try {
        saveLocalDraft(userId, "documents", draft);
        if (pendingDraftsRef.current.get("documents") === draft)
          pendingDraftsRef.current.delete("documents");
        setDraftStatus(pendingDraftsRef.current.size ? "saving" : "saved");
      } catch {
        setDraftStatus("error");
      }
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [documentText, draftsReady, title, userId]);

  useEffect(() => {
    if (!draftsReady) return;
    const draft: CodeDraft = { title: projectTitle, files, activePath };
    pendingDraftsRef.current.set("code", draft);
    const timeout = window.setTimeout(() => {
      try {
        saveLocalDraft(userId, "code", draft);
        if (pendingDraftsRef.current.get("code") === draft) pendingDraftsRef.current.delete("code");
        setDraftStatus(pendingDraftsRef.current.size ? "saving" : "saved");
      } catch {
        setDraftStatus("error");
      }
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [activePath, draftsReady, files, projectTitle, userId]);

  useEffect(() => {
    if (!draftsReady) return;
    const draft: SpreadsheetDraft = {
      name: sheetName,
      columns: sheetColumns,
      rows: sheetRows,
      ...(workbookSheets.length ? { sheets: workbookSheets, activeSheetIndex } : {}),
    };
    pendingDraftsRef.current.set("spreadsheet", draft);
    const timeout = window.setTimeout(() => {
      try {
        saveLocalDraft(userId, "spreadsheet", draft);
        if (pendingDraftsRef.current.get("spreadsheet") === draft)
          pendingDraftsRef.current.delete("spreadsheet");
        setDraftStatus(pendingDraftsRef.current.size ? "saving" : "saved");
      } catch {
        setDraftStatus("error");
      }
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [activeSheetIndex, draftsReady, sheetColumns, sheetName, sheetRows, userId, workbookSheets]);

  useEffect(() => {
    if (!draftsReady) return;
    const draft: JsonDraft = { content: jsonText };
    pendingDraftsRef.current.set("json", draft);
    const timeout = window.setTimeout(() => {
      try {
        saveLocalDraft(userId, "json", draft);
        if (pendingDraftsRef.current.get("json") === draft) pendingDraftsRef.current.delete("json");
        setDraftStatus(pendingDraftsRef.current.size ? "saving" : "saved");
      } catch {
        setDraftStatus("error");
      }
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [draftsReady, jsonText, userId]);

  useEffect(() => {
    if (!draftsReady) return;
    const draft: PresentationDraft = {
      title: presentationTitle,
      description: presentationDescription,
      slides: presentationSlides,
      activeSlideIndex,
    };
    pendingDraftsRef.current.set("presentation", draft);
    const timeout = window.setTimeout(() => {
      try {
        saveLocalDraft(userId, "presentation", draft);
        if (pendingDraftsRef.current.get("presentation") === draft)
          pendingDraftsRef.current.delete("presentation");
        setDraftStatus(pendingDraftsRef.current.size ? "saving" : "saved");
      } catch {
        setDraftStatus("error");
      }
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [
    activeSlideIndex,
    draftsReady,
    presentationDescription,
    presentationSlides,
    presentationTitle,
    userId,
  ]);

  useEffect(
    () => () => {
      for (const [tool, draft] of pendingDraftsRef.current) {
        try {
          saveLocalDraft(userId, tool, draft);
        } catch {
          // The visible status indicates quota or storage failures while mounted.
        }
      }
      pendingDraftsRef.current.clear();
    },
    [userId],
  );

  async function importDocument(file?: File) {
    if (!file) return;
    if (!isSupportedChatTextFile(file)) {
      setDocumentStatus("支持 TXT、Markdown、CSV、代码、DOCX、XLSX、PPTX 和可提取文字的 PDF。");
      return;
    }
    setDocumentBusy(true);
    setDocumentStatus(`正在读取 ${file.name}…`);
    try {
      const text = await readChatDocument(file);
      markDraftSaving();
      setDocumentText(text);
      setTitle(file.name.replace(/\.[^.]+$/u, "") || "导入的文档");
      setDocumentStatus(`已提取 ${text.length.toLocaleString()} 个字符，可继续编辑并导出。`);
    } catch (error) {
      setDocumentStatus(
        error instanceof Error ? error.message : "文件读取失败，请换一个文件试试。",
      );
    } finally {
      setDocumentBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function exportDocument(format: "docx" | "pdf" | "md") {
    if (!documentText.trim()) {
      setDocumentStatus("先写入或导入一些内容，再导出文档。");
      return;
    }
    setDocumentBusy(true);
    setDocumentStatus("正在准备文件…");
    try {
      const artifact: Artifact = {
        id: "direct-document",
        type: format === "pdf" ? "pdf" : "document",
        title: title.trim() || "未命名文档",
        description: "由 VHFXNEX 文档工具生成",
        content: documentText,
      };
      if (format === "pdf" && new TextEncoder().encode(documentText).byteLength > 60_000)
        throw new Error("PDF 导出内容超过当前服务的安全限制；请缩短文档，或导出 Word / Markdown。");
      const result = await createArtifactDownload(
        artifact,
        documentText,
        format === "md" ? "markdown" : "primary",
      );
      saveBlob(result.blob, `${artifact.title}.${result.extension}`);
      setDocumentStatus(result.message);
    } catch (error) {
      setDocumentStatus(error instanceof Error ? error.message : "导出失败，请重试。");
    } finally {
      setDocumentBusy(false);
    }
  }

  function updateActiveFile(content: string) {
    markDraftSaving();
    setFiles((current) =>
      current.map((file) => (file.path === activePath ? { ...file, content } : file)),
    );
    setProjectStatus("");
  }

  async function validateAndDownloadProject() {
    setProjectBusy(true);
    setProjectStatus("正在检查路径、文件结构和代码安全规则…");
    try {
      const response = await fetch("/api/tools/validate-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const payload = (await response.json().catch(() => null)) as {
        issues?: string[];
        error?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.error || "项目检查失败，请重试。");
      const issues = payload?.issues || [];
      if (issues.length) {
        setProjectStatus(
          `检查到 ${issues.length} 个需要处理的问题：\n${issues
            .slice(0, 5)
            .map((issue) => `• ${issue}`)
            .join("\n")}`,
        );
        return;
      }
      const archive = createProjectZip(files);
      saveBlob(
        new Blob([archive as BlobPart], { type: "application/zip" }),
        `${projectTitle.trim() || "vhfxnex-project"}.zip`,
      );
      setProjectStatus(`检查通过，已打包 ${files.length} 个文件。ZIP 已开始下载。`);
    } catch (error) {
      setProjectStatus(error instanceof Error ? error.message : "打包失败，请检查项目内容后重试。");
    } finally {
      setProjectBusy(false);
    }
  }

  function addProjectFile() {
    const input = window.prompt("输入新文件路径，例如 src/app.js");
    if (!input) return;
    const path = normalizeProjectPath(input.trim().replaceAll("\\", "/"));
    if (!path || files.some((file) => file.path.toLowerCase() === path.toLowerCase())) {
      setProjectStatus("文件路径无效或已存在，请输入有效的相对路径（如 src/app.js）。");
      return;
    }
    const next = [...files, { path, content: "" }];
    markDraftSaving();
    setFiles(next);
    setActivePath(path);
    setProjectStatus("");
  }

  function removeProjectFile(path: string) {
    if (files.length < 2) {
      setProjectStatus("项目至少保留一个文件。");
      return;
    }
    const next = files.filter((file) => file.path !== path);
    markDraftSaving();
    setFiles(next);
    if (activePath === path) setActivePath(next[0].path);
    setProjectStatus("");
  }

  async function importProjectFiles(fileList?: FileList | null) {
    const selected = Array.from(fileList || []);
    if (!selected.length) return;
    const supported =
      /\.(?:html?|css|m?js|cjs|tsx?|jsx?|json|md|txt|py|java|go|rs|sql|ya?ml|toml|sh)$/iu;
    if (selected.some((file) => !supported.test(file.name))) {
      setProjectStatus("导入项目暂支持 HTML、CSS、JS/TS、JSON、Markdown 和常见源码文件。");
      return;
    }
    setProjectBusy(true);
    setProjectStatus("正在读取所选源码文件…");
    try {
      const readFiles = await Promise.all(
        selected.map(async (file) => ({
          rawPath: file.webkitRelativePath || file.name,
          content: await file.text(),
        })),
      );
      const imported = readFiles.map((file) => {
        const path = normalizeProjectPath(file.rawPath.replaceAll("\\", "/"));
        if (!path) throw new Error("文件名中包含无效路径。");
        return { path, content: file.content };
      });
      const merged = [...files];
      for (const incoming of imported) {
        const existingIndex = merged.findIndex(
          (file) => file.path.toLowerCase() === incoming.path.toLowerCase(),
        );
        if (existingIndex >= 0) merged[existingIndex] = incoming;
        else merged.push(incoming);
      }
      markDraftSaving();
      setFiles(merged);
      setActivePath(imported[0].path);
      setProjectStatus(`已导入 ${imported.length} 个文件；同名文件已更新，其他文件保留。`);
    } catch (error) {
      setProjectStatus(error instanceof Error ? error.message : "读取项目文件失败。");
    } finally {
      setProjectBusy(false);
      if (projectInputRef.current) projectInputRef.current.value = "";
    }
  }

  async function importSpreadsheet(file?: File) {
    if (!file) return;
    try {
      let loadedSummary = "";
      if (/\.xlsx$/iu.test(file.name)) {
        const workbook = await readXlsxWorkbook(await file.arrayBuffer());
        const sheets = workbook.sheets.map(({ name, columns, rows }) => ({
          name,
          columns,
          rows,
        }));
        const activeSheet = sheets[0];
        markDraftSaving();
        setWorkbookSheets(sheets);
        setActiveSheetIndex(0);
        setSheetName(activeSheet.name);
        setSheetColumns(activeSheet.columns);
        setSheetRows(activeSheet.rows);
        loadedSummary = `已读取 ${activeSheet.rows.length} 行、${activeSheet.columns.length} 列。已导入 ${sheets.length} 张可见工作表（工作簿共 ${workbook.sheetCount} 张）。${workbook.formulaCount ? `发现 ${workbook.formulaCount} 个公式单元格，只读取 Excel 中已有的缓存结果，不执行公式。` : "公式不会执行。"}`;
      } else {
        const table = parseCsvTable(await file.text());
        const importedName = file.name.replace(/\.[^.]+$/u, "") || "导入的表格";
        markDraftSaving();
        setWorkbookSheets([]);
        setActiveSheetIndex(0);
        setSheetName(importedName);
        setSheetColumns(table.columns);
        setSheetRows(table.rows);
        loadedSummary = `已读取 ${table.rows.length} 行、${table.columns.length} 列。`;
      }
      setSheetStatus(loadedSummary);
    } catch (error) {
      setSheetStatus(error instanceof Error ? error.message : "表格读取失败。");
    } finally {
      if (spreadsheetInputRef.current) spreadsheetInputRef.current.value = "";
    }
  }

  function updateSheetColumn(columnIndex: number, value: string) {
    markDraftSaving();
    const columns = sheetColumns.map((column, index) => (index === columnIndex ? value : column));
    commitActiveSheet({ name: sheetName, columns, rows: sheetRows });
    setSheetStatus("");
  }

  function updateSheetCell(rowIndex: number, columnIndex: number, value: string) {
    markDraftSaving();
    const rows = sheetRows.map((row, index) =>
      index === rowIndex
        ? row.map((cell, cellIndex) => (cellIndex === columnIndex ? value : cell))
        : row,
    );
    commitActiveSheet({ name: sheetName, columns: sheetColumns, rows });
    setSheetStatus("");
  }

  function addSheetRow() {
    if (sheetRows.length >= 500) {
      setSheetStatus("表格最多支持 500 行数据。");
      return;
    }
    markDraftSaving();
    const rows = [...sheetRows, Array.from({ length: sheetColumns.length }, () => "")];
    commitActiveSheet({ name: sheetName, columns: sheetColumns, rows });
  }

  function addSheetColumn() {
    if (sheetColumns.length >= 20) {
      setSheetStatus("表格最多支持 20 列。");
      return;
    }
    markDraftSaving();
    const columns = [...sheetColumns, `列 ${sheetColumns.length + 1}`];
    const rows = sheetRows.map((row) => [...row, ""]);
    commitActiveSheet({ name: sheetName, columns, rows });
  }

  function commitActiveSheet(sheet: SpreadsheetSheetDraft) {
    setSheetName(sheet.name);
    setSheetColumns(sheet.columns);
    setSheetRows(sheet.rows);
    if (workbookSheets.length)
      setWorkbookSheets((current) =>
        current.map((existing, index) => (index === activeSheetIndex ? sheet : existing)),
      );
  }

  function selectWorkbookSheet(index: number) {
    const sheet = workbookSheets[index];
    if (!sheet) return;
    setActiveSheetIndex(index);
    setSheetName(sheet.name);
    setSheetColumns(sheet.columns);
    setSheetRows(sheet.rows);
    setSheetStatus(`正在编辑工作表“${sheet.name}”。`);
  }

  function exportSheetCsv() {
    try {
      saveBlob(
        new Blob(["\uFEFF", serializeCsvTable(sheetColumns, sheetRows)], {
          type: "text/csv;charset=utf-8",
        }),
        `${safeDownloadName(sheetName, "我的表格")}.csv`,
      );
      setSheetStatus("CSV 已开始下载；潜在公式前缀已按文本安全处理。");
    } catch (error) {
      setSheetStatus(error instanceof Error ? error.message : "CSV 导出失败。");
    }
  }

  async function exportSheetXlsx() {
    setSheetStatus("正在生成 Excel 工作簿…");
    try {
      const sheets = workbookSheets.length
        ? workbookSheets
        : [{ name: sheetName, columns: sheetColumns, rows: sheetRows }];
      const artifact: Artifact = {
        id: "direct-spreadsheet",
        type: "spreadsheet",
        title: safeDownloadName(sheetName, "我的表格"),
        description: "由 VHFXNEX 表格工具生成",
        content: JSON.stringify({
          sheets: sheets.map((sheet) => ({
            name:
              safeDownloadName(sheet.name, "工作表")
                .replace(/[\\/?*\[\]:]/gu, " ")
                .slice(0, 31)
                .trim() || "Sheet1",
            columns: sheet.columns,
            rows: sheet.rows,
          })),
        }),
      };
      const result = await createArtifactDownload(artifact, "");
      saveBlob(result.blob, `${artifact.title}.${result.extension}`);
      setSheetStatus(result.message);
    } catch (error) {
      setSheetStatus(error instanceof Error ? error.message : "Excel 导出失败。");
    }
  }

  async function importJson(file?: File) {
    if (!file) return;
    try {
      const content = await file.text();
      if (!readJsonDraft({ content })) {
        setJsonStatus("文件超过 30 万字符或本机保存大小限制。请缩小文件后重试。");
      } else {
        markDraftSaving();
        setJsonText(content);
        setJsonStatus(`已读取 ${file.name}；点击“校验”查看 JSON 是否有效。`);
      }
    } catch {
      setJsonStatus("读取失败，请确认文件可访问后重试。");
    } finally {
      if (jsonInputRef.current) jsonInputRef.current.value = "";
    }
  }

  function transformJson(mode: "pretty" | "compact") {
    try {
      const parsed: unknown = JSON.parse(jsonText);
      const output = JSON.stringify(parsed, null, mode === "pretty" ? 2 : undefined);
      markDraftSaving();
      setJsonText(output);
      setJsonStatus(
        `JSON 校验通过 · ${mode === "pretty" ? "已按 2 空格缩进美化" : "已压缩为单行"}。`,
      );
    } catch (error) {
      setJsonStatus(error instanceof Error ? `JSON 无效：${error.message}` : "JSON 格式无效。");
    }
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(jsonText);
      setJsonStatus("JSON 已复制到剪贴板。");
    } catch {
      setJsonStatus("浏览器未授权剪贴板访问；可以全选编辑器内容后复制。");
    }
  }

  function downloadJson() {
    saveBlob(new Blob([jsonText], { type: "application/json;charset=utf-8" }), "data.json");
    setJsonStatus("JSON 文件已开始下载。");
  }

  function updatePresentationSlide(
    index: number,
    patch: Partial<PresentationDraft["slides"][number]>,
  ) {
    markDraftSaving();
    setPresentationSlides((current) =>
      current.map((slide, slideIndex) => (slideIndex === index ? { ...slide, ...patch } : slide)),
    );
    setPresentationStatus("");
  }

  function addPresentationSlide() {
    if (presentationSlides.length >= 20) {
      setPresentationStatus("每份演示稿最多 20 张幻灯片。");
      return;
    }
    const nextIndex = presentationSlides.length;
    markDraftSaving();
    setPresentationSlides((current) => [
      ...current,
      { title: `新页面 ${nextIndex + 1}`, bulletsText: "", speakerNotes: "" },
    ]);
    setActiveSlideIndex(nextIndex);
    setPresentationStatus("已新增幻灯片；填写标题和要点后即可导出。");
  }

  function movePresentationSlide(direction: -1 | 1) {
    const destination = activeSlideIndex + direction;
    if (destination < 0 || destination >= presentationSlides.length) return;
    markDraftSaving();
    setPresentationSlides((current) => {
      const updated = [...current];
      [updated[activeSlideIndex], updated[destination]] = [
        updated[destination],
        updated[activeSlideIndex],
      ];
      return updated;
    });
    setActiveSlideIndex(destination);
  }

  function removePresentationSlide() {
    if (presentationSlides.length <= 1) {
      setPresentationStatus("至少保留一张幻灯片；导出至少需要两张。");
      return;
    }
    markDraftSaving();
    setPresentationSlides((current) => current.filter((_, index) => index !== activeSlideIndex));
    setActiveSlideIndex(Math.max(0, activeSlideIndex - 1));
  }

  async function exportPresentation() {
    const draft = readPresentationDraft({
      title: presentationTitle.trim(),
      description: presentationDescription.trim(),
      slides: presentationSlides,
      activeSlideIndex,
    });
    if (!draft) {
      setPresentationStatus(
        "请检查标题、要点长度，并确保每页最多 6 条；内容总长不能超过 18,000 字符。",
      );
      return;
    }
    if (draft.slides.length < 2) {
      setPresentationStatus("PowerPoint 至少需要两张幻灯片；先新增一页再导出。");
      return;
    }
    if (draft.slides.some((slide) => !slide.title.trim())) {
      setPresentationStatus("请先为每张幻灯片填写标题。");
      return;
    }
    setPresentationBusy(true);
    setPresentationStatus("正在生成 PowerPoint…");
    try {
      const slides = draft.slides.map((slide) => ({
        title: slide.title.trim(),
        bullets: slide.bulletsText
          .split(/\r?\n/u)
          .map((bullet) => bullet.trim())
          .filter(Boolean),
        ...(slide.speakerNotes.trim() ? { speakerNotes: slide.speakerNotes.trim() } : {}),
      }));
      const artifact: Artifact = {
        id: "direct-presentation",
        type: "presentation",
        title: draft.title || "VHFXNEX 演示稿",
        description: draft.description || "用户直接编辑的 PowerPoint 演示稿",
        content: JSON.stringify({ slides }),
      };
      const result = await createArtifactDownload(artifact, "");
      saveBlob(result.blob, `${safeDownloadName(artifact.title, "演示稿")}.${result.extension}`);
      setPresentationStatus(`${result.message} 共 ${slides.length} 页，包含演讲备注。`);
    } catch (error) {
      setPresentationStatus(
        error instanceof Error ? error.message : "PowerPoint 导出失败，请重试。",
      );
    } finally {
      setPresentationBusy(false);
    }
  }

  async function runDirectSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchStatus("请输入至少 2 个字符的搜索词。");
      return;
    }
    setSearchBusy(true);
    setSearchStatus("正在检索公开网页…");
    setSearchResults([]);
    try {
      const response = await fetch("/api/tools/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const payload = (await response.json().catch(() => null)) as {
        query?: string;
        results?: Array<{ title: string; url: string; snippet: string }>;
        error?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.error || "联网搜索失败，请稍后再试。");
      setSearchedQuery(payload?.query || query);
      setSearchResults(Array.isArray(payload?.results) ? payload.results : []);
      setSearchStatus(
        payload?.results?.length
          ? `找到 ${payload.results.length} 条结果 · 由你判断来源是否适合当前用途。`
          : "没有找到可显示的结果，请换一个搜索词。",
      );
    } catch (error) {
      setSearchStatus(error instanceof Error ? error.message : "联网搜索暂时不可用。");
    } finally {
      setSearchBusy(false);
    }
  }

  function shareCurrentToolWithSupervisor(taskInstruction = "") {
    let label = "当前工具草稿";
    let content = "";
    let filename = "工具草稿.txt";
    if (selectedTool === "documents") {
      label = "文档工作台";
      filename = `${safeDownloadName(title, "文档")}.md`;
      content = documentText;
    } else if (selectedTool === "code") {
      label = "代码工坊";
      filename = `${safeDownloadName(projectTitle, "代码项目")}-源码.txt`;
      content = files.map((file) => `===== ${file.path} =====\n${file.content}`).join("\n\n");
    } else if (selectedTool === "spreadsheet") {
      label = "表格工作台";
      filename = `${safeDownloadName(sheetName, "表格")}.json`;
      content = JSON.stringify(
        workbookSheets.length
          ? { sheets: workbookSheets, activeSheetIndex }
          : { sheets: [{ name: sheetName, columns: sheetColumns, rows: sheetRows }] },
        null,
        2,
      );
    } else if (selectedTool === "json") {
      label = "JSON 工坊";
      filename = "当前 JSON.json";
      content = jsonText;
    } else if (selectedTool === "presentation") {
      label = "演示稿工坊";
      filename = `${safeDownloadName(presentationTitle, "演示稿")}.json`;
      content = JSON.stringify(
        {
          title: presentationTitle,
          description: presentationDescription,
          slides: presentationSlides,
        },
        null,
        2,
      );
    } else {
      label = "联网搜索";
      filename = "搜索结果.txt";
      content = [
        `搜索词：${searchedQuery || searchQuery || "（尚未搜索）"}`,
        ...searchResults.map(
          (item, index) => `[${index + 1}] ${item.title}\n${item.url}\n${item.snippet}`,
        ),
      ].join("\n\n");
    }

    if (!content.trim()) {
      setCollaborationStatus("当前工具还没有可分享的内容。");
      return;
    }
    setCollaborationStatus("");
    onAskSupervisor(
      taskInstruction
        ? `${taskInstruction}\n\n请使用我主动附上的「${filename}」作为材料；若还需要联网查证，再补充搜索。`
        : `请先阅读随消息附上的「${filename}」，它是我从${label}主动分享的当前草稿/结果。我会在总控对话框中说明要你做什么；如果需要实际交付，请按用户权限交给匹配的工作区 Agent 连续完成。`,
      [
        {
          id: crypto.randomUUID(),
          name: filename,
          mimeType: "text/plain",
          kind: "text",
          content,
        },
      ],
    );
  }

  return (
    <section className="tool-center" aria-busy={!draftsReady}>
      <div className="tool-center-heading">
        <div>
          <p className="eyebrow">
            <span className="pulse" /> VHFXNEX · DIRECT TOOLS
          </p>
          <h1>把常用能力，放到手边。</h1>
          <p>这些工具由你直接操作。文档、演示稿、代码、表格和 JSON 的编辑与格式处理不调用模型。</p>
        </div>
        <button
          className="button-outline tool-supervisor-link"
          type="button"
          disabled={!draftsReady}
          title="点击后把当前工具内容附到总控对话；发送时会使用模型并可能消耗 API 用量。"
          onClick={() => shareCurrentToolWithSupervisor()}
        >
          <Sparkles size={16} /> 把当前内容交给总控
        </button>
      </div>
      {collaborationStatus && (
        <div className="tool-launch-context" role="status">
          <CircleAlert size={15} />
          <span>{collaborationStatus}</span>
        </div>
      )}
      <div className={`direct-draft-status ${draftStatus}`} role="status" aria-live="polite">
        {draftStatus === "loading" ? (
          <>
            <LoaderCircle size={15} className="spin" /> 正在恢复本机草稿…
          </>
        ) : draftStatus === "saving" ? (
          <>
            <LoaderCircle size={15} className="spin" /> 正在保存本机草稿…
          </>
        ) : draftStatus === "saved" ? (
          <>
            <CloudCheck size={15} /> 本机草稿已保存 · 仅保存在当前浏览器，不上传到服务器或 AI
          </>
        ) : (
          <>
            <CircleAlert size={15} />{" "}
            本机保存不可用或草稿格式无效；请及时下载文件备份。编辑与导出仍可使用。
          </>
        )}
      </div>
      {launchContext && (
        <div className="tool-launch-context" role="status">
          <Sparkles size={15} />
          <span>
            <strong>总控分流</strong> · {launchContext.instruction}
          </span>
        </div>
      )}

      <div className="tool-center-layout" inert={!draftsReady}>
        <nav className="tool-center-nav" aria-label="直接使用的工具">
          <p>
            TOOLBOX <span>不经过工作台自动调用</span>
          </p>
          <button
            className={selectedTool === "documents" ? "selected" : ""}
            type="button"
            onClick={() => setSelectedTool("documents")}
          >
            <FileText size={19} />
            <span>
              <strong>文档工作台</strong>
              <small>导入、整理、导出</small>
            </span>
            <ArrowDownToLine size={15} />
          </button>
          <button
            className={selectedTool === "spreadsheet" ? "selected" : ""}
            type="button"
            onClick={() => setSelectedTool("spreadsheet")}
          >
            <FileSpreadsheet size={19} />
            <span>
              <strong>表格工作台</strong>
              <small>编辑 CSV、导出 Excel</small>
            </span>
            <ArrowDownToLine size={15} />
          </button>
          <button
            className={selectedTool === "pdf" ? "selected" : ""}
            type="button"
            onClick={() => setSelectedTool("pdf")}
          >
            <FileText size={19} />
            <span>
              <strong>PDF 工具箱</strong>
              <small>合并、排序、提取页面</small>
            </span>
            <ArrowDownToLine size={15} />
          </button>
          <button
            className={selectedTool === "presentation" ? "selected" : ""}
            type="button"
            onClick={() => setSelectedTool("presentation")}
          >
            <Presentation size={19} />
            <span>
              <strong>演示稿工坊</strong>
              <small>逐页编辑、导出 PowerPoint</small>
            </span>
            <ArrowDownToLine size={15} />
          </button>
          <button
            className={selectedTool === "code" ? "selected" : ""}
            type="button"
            onClick={() => setSelectedTool("code")}
          >
            <Code2 size={19} />
            <span>
              <strong>代码工坊</strong>
              <small>编辑、预览、打包</small>
            </span>
            <ArrowDownToLine size={15} />
          </button>
          <button
            className={selectedTool === "json" ? "selected" : ""}
            type="button"
            onClick={() => setSelectedTool("json")}
          >
            <Braces size={19} />
            <span>
              <strong>JSON 工坊</strong>
              <small>校验、美化、压缩</small>
            </span>
            <ArrowDownToLine size={15} />
          </button>
          <button
            className={selectedTool === "search" ? "selected" : ""}
            type="button"
            onClick={() => setSelectedTool("search")}
          >
            <SearchIcon size={19} />
            <span>
              <strong>联网搜索</strong>
              <small>检索公开网页与来源</small>
            </span>
            <ArrowDownToLine size={15} />
          </button>
          <div className="tool-center-note">
            <Wrench size={16} />
            <span>你决定何时运行、导出或交给 Agent 继续处理。</span>
          </div>
        </nav>

        {selectedTool === "documents" ? (
          <section
            className="direct-tool-panel document-tool"
            aria-labelledby="document-tool-title"
          >
            <header>
              <div className="direct-tool-icon">
                <FileText size={22} />
              </div>
              <div>
                <p>DOCUMENT STUDIO · 本地处理</p>
                <h2 id="document-tool-title">文档工作台</h2>
                <span>导入常见文件，提取文字后编辑，再导出成可交付文档。</span>
              </div>
            </header>
            <div className="direct-tool-controls">
              <label className="tool-title-field">
                <span>文档名称</span>
                <input
                  value={title}
                  onChange={(event) => {
                    markDraftSaving();
                    setTitle(event.target.value);
                  }}
                  maxLength={80}
                />
              </label>
              <input
                ref={fileInputRef}
                className="tool-file-input"
                type="file"
                aria-label="导入文档文件"
                accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.mjs,.py,.java,.go,.rs,.sql,.yaml,.yml,.toml,.sh,.log,.docx,.xlsx,.pptx,.pdf"
                onChange={(event) => void importDocument(event.target.files?.[0])}
              />
              <button
                className="button-outline"
                type="button"
                disabled={documentBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileInput size={16} /> {documentBusy ? "处理中…" : "导入文件"}
              </button>
              <span className="tool-file-support">TXT · MD · DOCX · XLSX · PPTX · PDF</span>
            </div>
            <div className="document-editor-grid">
              <label className="document-editor">
                <span>内容编辑 · Markdown</span>
                <textarea
                  value={documentText}
                  onChange={(event) => {
                    markDraftSaving();
                    setDocumentText(event.target.value);
                  }}
                  spellCheck={false}
                  aria-label="文档 Markdown 内容"
                />
              </label>
              <div className="document-preview">
                <div>
                  <span>实时预览</span>
                  <small>
                    {wordCount} 个词段 · {documentText.length.toLocaleString()} 字符
                  </small>
                </div>
                <article>
                  <MarkdownContent content={documentText || "开始输入，预览会显示在这里。"} />
                </article>
              </div>
            </div>
            <footer className="direct-tool-footer">
              <div className="tool-status" role="status" aria-live="polite">
                {documentStatus || "文件只在你点击导入后读取；生成文件仅在你点击导出时下载。"}
              </div>
              <div className="tool-actions">
                <button
                  className="button-outline"
                  type="button"
                  disabled={documentBusy}
                  onClick={() => void exportDocument("md")}
                >
                  下载 Markdown
                </button>
                <button
                  className="button-outline"
                  type="button"
                  disabled={documentBusy}
                  onClick={() => void exportDocument("pdf")}
                >
                  下载 PDF
                </button>
                <button
                  className="button-primary"
                  type="button"
                  disabled={documentBusy}
                  onClick={() => void exportDocument("docx")}
                >
                  导出 Word <ArrowDownToLine size={16} />
                </button>
              </div>
            </footer>
          </section>
        ) : selectedTool === "pdf" ? (
          <PdfToolPanel />
        ) : selectedTool === "code" ? (
          <section className="direct-tool-panel code-tool" aria-labelledby="code-tool-title">
            <header>
              <div className="direct-tool-icon">
                <Code2 size={22} />
              </div>
              <div>
                <p>CODE WORKSHOP · 不执行未知代码</p>
                <h2 id="code-tool-title">代码工坊</h2>
                <span>边改源码边看网页预览，通过静态检查后下载完整 ZIP。</span>
              </div>
            </header>
            <div className="direct-tool-controls">
              <label className="tool-title-field">
                <span>项目名称</span>
                <input
                  value={projectTitle}
                  onChange={(event) => {
                    markDraftSaving();
                    setProjectTitle(event.target.value);
                  }}
                  maxLength={60}
                />
              </label>
              <input
                ref={projectInputRef}
                className="tool-file-input"
                type="file"
                aria-label="导入代码项目文件"
                multiple
                accept=".html,.htm,.css,.js,.mjs,.cjs,.ts,.tsx,.jsx,.json,.md,.txt,.py,.java,.go,.rs,.sql,.yaml,.yml,.toml,.sh"
                onChange={(event) => void importProjectFiles(event.target.files)}
              />
              <button
                className="button-outline"
                type="button"
                disabled={projectBusy}
                onClick={() => projectInputRef.current?.click()}
              >
                <FileInput size={16} /> 导入源码文件
              </button>
              <button className="button-outline" type="button" onClick={addProjectFile}>
                <Plus size={16} /> 新建文件
              </button>
              <button
                className="button-outline"
                type="button"
                onClick={() => {
                  markDraftSaving();
                  setFiles(starterFiles);
                  setProjectTitle("我的小工具");
                  setActivePath("index.html");
                  setProjectStatus("已恢复为网页起步模板。");
                }}
              >
                <Sparkles size={15} /> 重置网页模板
              </button>
            </div>
            <div className="code-editor-grid">
              <aside className="code-file-list" aria-label="项目文件">
                <div>
                  <FolderOpen size={16} />
                  <span>项目文件</span>
                  <small>{files.length}</small>
                </div>
                {files.map((file) => (
                  <div key={file.path} className={file.path === activePath ? "active" : ""}>
                    <button
                      type="button"
                      onClick={() => {
                        markDraftSaving();
                        setActivePath(file.path);
                      }}
                      title={file.path}
                    >
                      <Code2 size={15} />
                      <span>{file.path}</span>
                    </button>
                    <button
                      className="code-file-remove"
                      type="button"
                      onClick={() => removeProjectFile(file.path)}
                      aria-label={`删除 ${file.path}`}
                      title="删除文件"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </aside>
              <section className="code-editor" aria-label="源码编辑器">
                <span>
                  <span className="code-editor-file-label">
                    <Code2 size={15} /> {activeFile?.path || "选择文件"}
                  </span>
                  <small className="code-editor-language">
                    {activeCodeLanguage.label} · {activeFile?.content.split("\n").length || 0} 行
                  </small>
                </span>
                <CodeMirror
                  className="code-editor-codemirror"
                  value={activeFile?.content || ""}
                  onChange={updateActiveFile}
                  extensions={codeEditorExtensions}
                  theme="dark"
                  height="100%"
                  minHeight="435px"
                  indentWithTab
                  onCreateEditor={makeCodeEditorScrollKeyboardAccessible}
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: true,
                    highlightActiveLine: true,
                    highlightActiveLineGutter: true,
                    bracketMatching: true,
                    closeBrackets: true,
                    indentOnInput: true,
                  }}
                />
              </section>
              <section className="code-tool-preview" aria-label="代码项目网页预览">
                <div className="code-tool-preview-toolbar">
                  <span>
                    <strong>实时网页预览</strong>
                    <small>{codePreviewDocument ? "HTML + 本地 CSS" : "需要 index.html"}</small>
                  </span>
                  <div className="code-preview-controls" role="group" aria-label="代码预览尺寸">
                    <button
                      type="button"
                      aria-pressed={codePreviewViewport === "desktop"}
                      onClick={() => setCodePreviewViewport("desktop")}
                    >
                      桌面
                    </button>
                    <button
                      type="button"
                      aria-pressed={codePreviewViewport === "mobile"}
                      onClick={() => setCodePreviewViewport("mobile")}
                    >
                      手机 390px
                    </button>
                  </div>
                </div>
                {codePreviewDocument ? (
                  <div
                    className={`code-preview-surface code-tool-preview-surface ${codePreviewViewport === "mobile" ? "mobile" : ""}`}
                  >
                    <iframe
                      title={`${projectTitle || "代码项目"} 静态网页预览`}
                      sandbox=""
                      referrerPolicy="no-referrer"
                      srcDoc={codePreviewDocument}
                    />
                    <p>隔离预览仅显示 HTML 与本地 CSS；脚本、表单提交和网络访问均被禁用。</p>
                  </div>
                ) : (
                  <div className="code-tool-preview-empty">
                    <Code2 size={23} />
                    <strong>添加 index.html 开始预览</strong>
                    <span>预览只读取项目中的 HTML 与本地 CSS，不会运行脚本或访问网络。</span>
                  </div>
                )}
              </section>
            </div>
            <footer className="direct-tool-footer">
              <div className="tool-status" role="status" aria-live="polite">
                {projectStatus || (
                  <>
                    <Check size={15} /> 打包前会校验文件路径与静态风险；项目代码不会在 VHFXNEX
                    页面中执行。
                  </>
                )}
              </div>
              <div className="tool-actions">
                <button
                  className="button-primary"
                  type="button"
                  disabled={projectBusy || files.length === 0}
                  onClick={() => void validateAndDownloadProject()}
                >
                  {projectBusy ? "正在检查…" : "检查并下载 ZIP"} <ArrowDownToLine size={16} />
                </button>
              </div>
            </footer>
          </section>
        ) : selectedTool === "spreadsheet" ? (
          <section
            className="direct-tool-panel spreadsheet-tool"
            aria-labelledby="spreadsheet-tool-title"
          >
            <header>
              <div className="direct-tool-icon">
                <FileSpreadsheet size={22} />
              </div>
              <div>
                <p>TABLE STUDIO · 本地编辑</p>
                <h2 id="spreadsheet-tool-title">表格工作台</h2>
                <span>导入 CSV 或 Excel，切换并编辑最多 8 张工作表后下载。</span>
              </div>
            </header>
            <div className="direct-tool-controls spreadsheet-controls">
              <label className="tool-title-field">
                <span>工作表名称</span>
                <input
                  value={sheetName}
                  onChange={(event) => {
                    markDraftSaving();
                    commitActiveSheet({
                      name: event.target.value,
                      columns: sheetColumns,
                      rows: sheetRows,
                    });
                  }}
                  maxLength={80}
                />
              </label>
              <input
                ref={spreadsheetInputRef}
                className="tool-file-input"
                type="file"
                aria-label="导入 CSV 或 Excel 表格"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => void importSpreadsheet(event.target.files?.[0])}
              />
              <button
                className="button-outline"
                type="button"
                onClick={() => spreadsheetInputRef.current?.click()}
              >
                <FileInput size={16} /> 导入 CSV / Excel
              </button>
              {workbookSheets.length > 1 && (
                <label className="tool-sheet-selector">
                  <span>工作表</span>
                  <select
                    aria-label="Excel 工作表"
                    value={activeSheetIndex}
                    onChange={(event) => selectWorkbookSheet(Number(event.target.value))}
                  >
                    {workbookSheets.map((sheet, index) => (
                      <option key={`${index}-${sheet.name}`} value={index}>
                        {sheet.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="button-outline" type="button" onClick={addSheetColumn}>
                <Plus size={16} /> 添加列
              </button>
              <button className="button-outline" type="button" onClick={addSheetRow}>
                <Rows3 size={16} /> 添加行
              </button>
            </div>
            <div className="spreadsheet-wrap">
              <table className="spreadsheet-grid">
                <thead>
                  <tr>
                    <th aria-label="行号">#</th>
                    {sheetColumns.map((column, columnIndex) => (
                      <th key={`column-${columnIndex}`}>
                        <input
                          value={column}
                          onChange={(event) => updateSheetColumn(columnIndex, event.target.value)}
                          aria-label={`第 ${columnIndex + 1} 列名称`}
                          maxLength={120}
                        />
                      </th>
                    ))}
                    <th aria-label="行操作" />
                  </tr>
                </thead>
                <tbody>
                  {sheetRows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      <th>{rowIndex + 1}</th>
                      {sheetColumns.map((_, columnIndex) => (
                        <td key={`cell-${rowIndex}-${columnIndex}`}>
                          <input
                            value={row[columnIndex] || ""}
                            onChange={(event) =>
                              updateSheetCell(rowIndex, columnIndex, event.target.value)
                            }
                            aria-label={`${rowIndex + 1} 行 ${columnIndex + 1} 列`}
                            maxLength={2000}
                          />
                        </td>
                      ))}
                      <td>
                        <button
                          className="spreadsheet-remove-row"
                          type="button"
                          aria-label={`删除第 ${rowIndex + 1} 行`}
                          title="删除行"
                          onClick={() => {
                            markDraftSaving();
                            const rows = sheetRows.filter((_, index) => index !== rowIndex);
                            commitActiveSheet({ name: sheetName, columns: sheetColumns, rows });
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!sheetRows.length && (
                <div className="spreadsheet-empty">
                  <Rows3 size={20} />
                  <span>表格还没有数据行，添加一行或导入 CSV / Excel 开始。</span>
                </div>
              )}
            </div>
            <footer className="direct-tool-footer">
              <div className="tool-status" role="status" aria-live="polite">
                {sheetStatus || "本地编辑，不调用模型；最多 500 行、20 列。"}
              </div>
              <div className="tool-actions">
                <button className="button-outline" type="button" onClick={exportSheetCsv}>
                  下载 CSV
                </button>
                <button
                  className="button-primary"
                  type="button"
                  onClick={() => void exportSheetXlsx()}
                >
                  导出 Excel <ArrowDownToLine size={16} />
                </button>
              </div>
            </footer>
          </section>
        ) : selectedTool === "json" ? (
          <section className="direct-tool-panel json-tool" aria-labelledby="json-tool-title">
            <header>
              <div className="direct-tool-icon">
                <Braces size={22} />
              </div>
              <div>
                <p>JSON STUDIO · 浏览器本地处理</p>
                <h2 id="json-tool-title">JSON 工坊</h2>
                <span>校验语法、统一缩进或压缩数据；内容不会上传或调用模型。</span>
              </div>
            </header>
            <div className="direct-tool-controls">
              <input
                ref={jsonInputRef}
                className="tool-file-input"
                type="file"
                aria-label="导入 JSON 文件"
                accept=".json,.txt,application/json,text/plain"
                onChange={(event) => void importJson(event.target.files?.[0])}
              />
              <button
                className="button-outline"
                type="button"
                onClick={() => jsonInputRef.current?.click()}
              >
                <FileInput size={16} /> 导入 JSON
              </button>
              <button
                className="button-outline"
                type="button"
                onClick={() => transformJson("pretty")}
              >
                <Check size={16} /> 校验并美化
              </button>
              <button
                className="button-outline"
                type="button"
                onClick={() => transformJson("compact")}
              >
                压缩为单行
              </button>
              <span className="tool-file-support">最多 30 万字符 · 无模型调用</span>
            </div>
            <label className="json-editor">
              <span>
                <Braces size={15} /> JSON 内容{" "}
                <small>{jsonText.length.toLocaleString()} 字符</small>
              </span>
              <textarea
                value={jsonText}
                onChange={(event) => {
                  markDraftSaving();
                  setJsonText(event.target.value);
                  setJsonStatus("");
                }}
                aria-label="JSON 内容"
                spellCheck={false}
                maxLength={300_000}
              />
            </label>
            <footer className="direct-tool-footer">
              <div className="tool-status" role="status" aria-live="polite">
                {jsonStatus || "JSON 校验与格式转换都在当前浏览器完成，草稿会自动保存在本机。"}
              </div>
              <div className="tool-actions">
                <button className="button-outline" type="button" onClick={() => void copyJson()}>
                  复制内容
                </button>
                <button className="button-primary" type="button" onClick={downloadJson}>
                  下载 JSON <ArrowDownToLine size={16} />
                </button>
              </div>
            </footer>
          </section>
        ) : selectedTool === "search" ? (
          <section
            className="direct-tool-panel direct-search-tool"
            aria-labelledby="direct-search-title"
          >
            <header>
              <div className="direct-tool-icon">
                <SearchIcon size={22} />
              </div>
              <div>
                <p>WEB SEARCH · 来源可追溯</p>
                <h2 id="direct-search-title">联网搜索</h2>
                <span>直接检索公开网页并查看来源摘要；不调用模型，不会自动替你判断结论。</span>
              </div>
            </header>
            <form className="direct-search-form" onSubmit={(event) => void runDirectSearch(event)}>
              <label>
                <span>搜索关键词</span>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="例如：Next.js App Router 官方文档"
                  maxLength={240}
                  aria-label="联网搜索关键词"
                />
              </label>
              <button className="button-primary" type="submit" disabled={searchBusy}>
                {searchBusy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <SearchIcon size={16} />
                )}
                {searchBusy ? "正在搜索" : "搜索网页"}
              </button>
            </form>
            <div className="direct-search-results" aria-live="polite">
              <div className="direct-search-results-head">
                <strong>{searchedQuery ? `“${searchedQuery}”的搜索结果` : "等待搜索"}</strong>
                <span>
                  {searchResults.length ? `${searchResults.length} 个来源` : "最多显示 5 条"}
                </span>
              </div>
              {searchResults.length ? (
                searchResults.map((result, index) => (
                  <article className="direct-search-result" key={`${result.url}-${index}`}>
                    <div>
                      <span>来源 {String(index + 1).padStart(2, "0")}</span>
                      <a href={result.url} target="_blank" rel="noopener noreferrer">
                        {result.title} <ExternalLink size={14} />
                      </a>
                    </div>
                    <p>{result.snippet}</p>
                    <small>{result.url}</small>
                  </article>
                ))
              ) : (
                <div className="direct-search-empty">
                  <SearchIcon size={24} />
                  <p>{searchBusy ? "正在读取搜索结果…" : "输入关键词后，网页来源会显示在这里。"}</p>
                </div>
              )}
            </div>
            <footer className="direct-tool-footer">
              <div className="tool-status" role="status" aria-live="polite">
                {searchStatus || "搜索会访问公开网页摘要；打开来源前请确认网址与内容。"}
              </div>
              <div className="tool-actions">
                <button
                  className="button-outline"
                  type="button"
                  onClick={() =>
                    shareCurrentToolWithSupervisor(
                      `请直接基于我已经检索到的来源总结搜索主题「${searchedQuery || searchQuery.trim()}」，优先比较来源质量并给出来源链接。不要为已有内容重复联网搜索，只有来源不足时再补充。`,
                    )
                  }
                  disabled={searchQuery.trim().length < 2}
                >
                  <Sparkles size={15} /> 交给总控总结
                </button>
              </div>
            </footer>
          </section>
        ) : (
          <section
            className="direct-tool-panel presentation-tool"
            aria-labelledby="presentation-tool-title"
          >
            <header>
              <div className="direct-tool-icon">
                <Presentation size={22} />
              </div>
              <div>
                <p>PRESENTATION STUDIO · 直接编辑</p>
                <h2 id="presentation-tool-title">演示稿工坊</h2>
                <span>逐页整理标题、要点和演讲备注，生成可编辑的 PowerPoint 文件。</span>
              </div>
            </header>
            <div className="direct-tool-controls presentation-meta">
              <label className="tool-title-field">
                <span>演示稿标题</span>
                <input
                  value={presentationTitle}
                  onChange={(event) => {
                    markDraftSaving();
                    setPresentationTitle(event.target.value);
                    setPresentationStatus("");
                  }}
                  maxLength={100}
                  aria-label="演示稿标题"
                />
              </label>
              <label className="tool-title-field">
                <span>演示说明</span>
                <input
                  value={presentationDescription}
                  onChange={(event) => {
                    markDraftSaving();
                    setPresentationDescription(event.target.value);
                    setPresentationStatus("");
                  }}
                  maxLength={300}
                  aria-label="演示说明"
                />
              </label>
            </div>
            <div className="presentation-editor-grid">
              <aside className="presentation-slide-list" aria-label="幻灯片列表">
                <div className="presentation-slide-list-heading">
                  <strong>页面顺序</strong>
                  <small>{presentationSlides.length} / 20</small>
                </div>
                {presentationSlides.map((slide, index) => (
                  <button
                    key={`slide-${index}`}
                    className={index === activeSlideIndex ? "active" : ""}
                    type="button"
                    aria-pressed={index === activeSlideIndex}
                    onClick={() => setActiveSlideIndex(index)}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{slide.title || "未命名页面"}</strong>
                  </button>
                ))}
                <button
                  className="presentation-add-slide"
                  type="button"
                  disabled={presentationSlides.length >= 20}
                  onClick={addPresentationSlide}
                >
                  <Plus size={15} /> 新增页面
                </button>
              </aside>
              <div className="presentation-slide-editor">
                {activePresentationSlide && (
                  <>
                    <div className="presentation-slide-actions">
                      <span>
                        第 {activeSlideIndex + 1} 页 · 共 {presentationSlides.length} 页
                      </span>
                      <div>
                        <button
                          className="button-outline"
                          type="button"
                          aria-label="当前页上移"
                          title="上移页面"
                          disabled={activeSlideIndex === 0}
                          onClick={() => movePresentationSlide(-1)}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          className="button-outline"
                          type="button"
                          aria-label="当前页下移"
                          title="下移页面"
                          disabled={activeSlideIndex === presentationSlides.length - 1}
                          onClick={() => movePresentationSlide(1)}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          className="button-outline"
                          type="button"
                          aria-label="删除当前页"
                          title="删除页面"
                          disabled={presentationSlides.length <= 1}
                          onClick={removePresentationSlide}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <label className="presentation-field">
                      <span>页面标题</span>
                      <input
                        value={activePresentationSlide.title}
                        onChange={(event) =>
                          updatePresentationSlide(activeSlideIndex, { title: event.target.value })
                        }
                        maxLength={100}
                        aria-label="当前页标题"
                      />
                    </label>
                    <label className="presentation-field">
                      <span>
                        页面要点 <small>每行一条，最多 6 条</small>
                      </span>
                      <textarea
                        value={activePresentationSlide.bulletsText}
                        onChange={(event) =>
                          updatePresentationSlide(activeSlideIndex, {
                            bulletsText: event.target.value,
                          })
                        }
                        maxLength={1_400}
                        aria-label="当前页要点"
                      />
                    </label>
                    <label className="presentation-field">
                      <span>
                        演讲备注 <small>会写入 PowerPoint 备注页</small>
                      </span>
                      <textarea
                        className="presentation-notes"
                        value={activePresentationSlide.speakerNotes}
                        onChange={(event) =>
                          updatePresentationSlide(activeSlideIndex, {
                            speakerNotes: event.target.value,
                          })
                        }
                        maxLength={400}
                        aria-label="当前页演讲备注"
                      />
                    </label>
                  </>
                )}
              </div>
              <div className="presentation-live-preview" aria-label="幻灯片预览">
                <div>
                  <small>{presentationTitle || "VHFXNEX 演示稿"}</small>
                  <span>{String(activeSlideIndex + 1).padStart(2, "0")}</span>
                </div>
                <h3>{activePresentationSlide?.title || "页面标题"}</h3>
                <ul>
                  {activePresentationSlide?.bulletsText
                    .split(/\r?\n/u)
                    .map((bullet) => bullet.trim())
                    .filter(Boolean)
                    .map((bullet, index) => (
                      <li key={`preview-${index}`}>{bullet}</li>
                    ))}
                </ul>
                <div className="presentation-preview-progress">
                  <span
                    style={{
                      width: `${((activeSlideIndex + 1) / presentationSlides.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
            <footer className="direct-tool-footer">
              <div className="tool-status" role="status" aria-live="polite">
                {presentationStatus ||
                  "本地自动保存 · 导出为可编辑 PPTX · 每页最多 6 条要点，整份最多 20 页。"}
              </div>
              <div className="tool-actions">
                <button
                  className="button-primary"
                  type="button"
                  disabled={presentationBusy}
                  onClick={() => void exportPresentation()}
                >
                  {presentationBusy ? "正在生成…" : "导出 PowerPoint"}
                  <ArrowDownToLine size={16} />
                </button>
              </div>
            </footer>
          </section>
        )}
      </div>
    </section>
  );
}
