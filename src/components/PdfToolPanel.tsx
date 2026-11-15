"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowDownToLine, ArrowUp, FileText, Plus, Trash2 } from "lucide-react";
import { parsePdfPageSelection } from "@/lib/pdf-pages.mjs";

type PdfSource = { id: string; file: File; pageCount: number };

const MAX_FILES = 8;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_TOTAL_PAGES = 300;

function pdfDownloadName(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
      .trim()
      .slice(0, 80) || "合并文档"
  );
}

function downloadPdf(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.hidden = true;
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function PdfToolPanel() {
  const [sources, setSources] = useState<PdfSource[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [pageRange, setPageRange] = useState("1");
  const [outputName, setOutputName] = useState("合并文档");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedSource = sources.find((source) => source.id === selectedId) || sources[0];
  const totalBytes = sources.reduce((total, source) => total + source.file.size, 0);
  const totalPages = sources.reduce((total, source) => total + source.pageCount, 0);

  async function addPdfs(files: FileList | null) {
    const incoming = Array.from(files || []);
    if (!incoming.length) return;
    setBusy(true);
    const accepted: PdfSource[] = [];
    const errors: string[] = [];
    try {
      const { PDFDocument } = await import("pdf-lib");
      for (const file of incoming) {
        if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
          errors.push(`${file.name} 不是 PDF 文件`);
          continue;
        }
        if (sources.length + accepted.length >= MAX_FILES) {
          errors.push(`最多添加 ${MAX_FILES} 个文件`);
          break;
        }
        if (file.size > MAX_FILE_BYTES) {
          errors.push(`${file.name} 超过单个 20 MB 限制`);
          continue;
        }
        if (
          totalBytes + accepted.reduce((sum, source) => sum + source.file.size, 0) + file.size >
          MAX_TOTAL_BYTES
        ) {
          errors.push("文件总大小不能超过 60 MB");
          continue;
        }
        try {
          const document = await PDFDocument.load(await file.arrayBuffer(), {
            updateMetadata: false,
          });
          const pageCount = document.getPageCount();
          if (
            !pageCount ||
            totalPages + accepted.reduce((sum, source) => sum + source.pageCount, 0) + pageCount >
              MAX_TOTAL_PAGES
          ) {
            errors.push(`${file.name} 加入后会超过 300 页限制`);
            continue;
          }
          accepted.push({ id: crypto.randomUUID(), file, pageCount });
        } catch {
          errors.push(`${file.name} 无法读取，可能已损坏或设有密码`);
        }
      }
      if (accepted.length) {
        setSources((current) => [...current, ...accepted]);
        setSelectedId((current) => current || accepted[0].id);
        setStatus(
          `已读取 ${accepted.length} 份 PDF，共 ${accepted.reduce((sum, source) => sum + source.pageCount, 0)} 页。文件只在当前浏览器内存中处理。${errors.length ? ` 未加入：${errors.join("；")}。` : ""}`,
        );
      } else {
        setStatus(errors.join("；") || "没有可读取的 PDF 文件。");
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `PDF 工具加载失败：${error.message}`
          : "PDF 工具加载失败，请刷新后重试。",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function moveSource(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= sources.length) return;
    setSources((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setStatus("合并顺序已更新；下载时将按此顺序拼接。");
  }

  function removeSource(id: string) {
    const next = sources.filter((source) => source.id !== id);
    setSources(next);
    if (selectedId === id) setSelectedId(next[0]?.id || "");
    setStatus("已从本次 PDF 操作中移除文件。");
  }

  async function mergePdfs() {
    if (sources.length < 2) {
      setStatus("至少添加两份 PDF 才能合并。");
      return;
    }
    setBusy(true);
    setStatus("正在本机合并 PDF…");
    try {
      const { PDFDocument } = await import("pdf-lib");
      const output = await PDFDocument.create();
      for (const source of sources) {
        const document = await PDFDocument.load(await source.file.arrayBuffer(), {
          updateMetadata: false,
        });
        const copiedPages = await output.copyPages(document, document.getPageIndices());
        copiedPages.forEach((page) => output.addPage(page));
      }
      downloadPdf(await output.save(), `${pdfDownloadName(outputName)}.pdf`);
      setStatus(`已合并 ${sources.length} 份 PDF，共 ${totalPages} 页；文件仅在本机浏览器处理。`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `合并失败：${error.message}`
          : "合并失败，请确认文件可读取后重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function extractPages() {
    if (!selectedSource) {
      setStatus("先添加一份 PDF，再选择要提取的页码。");
      return;
    }
    let pageIndexes: number[];
    try {
      pageIndexes = parsePdfPageSelection(pageRange, selectedSource.pageCount);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "页码范围无效。");
      return;
    }
    setBusy(true);
    setStatus("正在本机提取页面…");
    try {
      const { PDFDocument } = await import("pdf-lib");
      const source = await PDFDocument.load(await selectedSource.file.arrayBuffer(), {
        updateMetadata: false,
      });
      const output = await PDFDocument.create();
      const pages = await output.copyPages(source, pageIndexes);
      pages.forEach((page) => output.addPage(page));
      const baseName = pdfDownloadName(selectedSource.file.name.replace(/\.pdf$/iu, ""));
      downloadPdf(
        await output.save(),
        `${baseName}-页面-${pageIndexes.map((page) => page + 1).join("-")}.pdf`,
      );
      setStatus(`已提取 ${pageIndexes.length} 页并开始下载；文件仅在本机浏览器处理。`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `提取失败：${error.message}`
          : "提取失败，请确认文件可读取后重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="direct-tool-panel pdf-tool" aria-labelledby="pdf-tool-title">
      <header>
        <div className="direct-tool-icon">
          <FileText size={22} />
        </div>
        <div>
          <p>PDF DESK · 本地处理</p>
          <h2 id="pdf-tool-title">PDF 工具箱</h2>
          <span>按顺序合并文件，或从单份 PDF 提取指定页面。</span>
        </div>
      </header>
      <div className="pdf-tool-body">
        <div className="pdf-tool-toolbar">
          <div>
            <strong>本次文件</strong>
            <span>
              {sources.length} / {MAX_FILES} 份 · {totalPages} / {MAX_TOTAL_PAGES} 页 ·{" "}
              {(totalBytes / 1024 / 1024).toFixed(1)} / 60 MB
            </span>
          </div>
          <input
            ref={inputRef}
            className="tool-file-input"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            aria-label="添加 PDF 文件"
            onChange={(event) => void addPdfs(event.target.files)}
          />
          <button
            className="button-outline"
            type="button"
            disabled={busy || sources.length >= MAX_FILES}
            onClick={() => inputRef.current?.click()}
          >
            <Plus size={16} /> 添加 PDF
          </button>
        </div>
        {sources.length ? (
          <ol className="pdf-file-list" aria-label="PDF 文件顺序">
            {sources.map((source, index) => (
              <li key={source.id}>
                <FileText size={18} aria-hidden="true" />
                <span>
                  <strong>{source.file.name}</strong>
                  <small>
                    {source.pageCount} 页 · {(source.file.size / 1024 / 1024).toFixed(2)} MB
                  </small>
                </span>
                <div className="pdf-file-actions">
                  <button
                    type="button"
                    aria-label={`上移 ${source.file.name}`}
                    disabled={index === 0 || busy}
                    onClick={() => moveSource(index, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={`下移 ${source.file.name}`}
                    disabled={index === sources.length - 1 || busy}
                    onClick={() => moveSource(index, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={`移除 ${source.file.name}`}
                    disabled={busy}
                    onClick={() => removeSource(source.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="pdf-empty-state">
            <FileText size={26} />
            <strong>添加需要处理的 PDF</strong>
            <span>单个文件不超过 20 MB；文件不会上传或保存到 VHFXNEX。</span>
          </div>
        )}
        <div className="pdf-actions-grid">
          <section>
            <p>01 · 合并</p>
            <h3>按列表顺序拼接</h3>
            <span>使用上移 / 下移调整顺序，最多 8 份、300 页。</span>
            <label className="tool-title-field">
              <span>导出文件名</span>
              <input
                value={outputName}
                maxLength={80}
                onChange={(event) => setOutputName(event.target.value)}
              />
            </label>
            <button
              className="button-primary"
              type="button"
              disabled={busy || sources.length < 2}
              onClick={() => void mergePdfs()}
            >
              {busy ? "正在处理…" : "合并并下载 PDF"}
              <ArrowDownToLine size={16} />
            </button>
          </section>
          <section>
            <p>02 · 提取</p>
            <h3>只保留需要的页面</h3>
            <span>支持页码和区间，例如 1-3, 5；按原顺序去重。</span>
            <label className="tool-title-field">
              <span>来源文件</span>
              <select
                aria-label="选择要提取的 PDF"
                value={selectedSource?.id || ""}
                onChange={(event) => setSelectedId(event.target.value)}
                disabled={!sources.length || busy}
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.file.name} · {source.pageCount} 页
                  </option>
                ))}
              </select>
            </label>
            <label className="tool-title-field">
              <span>页面范围</span>
              <input
                aria-label="页面范围"
                value={pageRange}
                onChange={(event) => setPageRange(event.target.value)}
                placeholder="例如 1-3, 5"
                disabled={!selectedSource || busy}
              />
            </label>
            <button
              className="button-outline"
              type="button"
              disabled={busy || !selectedSource}
              onClick={() => void extractPages()}
            >
              {busy ? "正在处理…" : "提取页面并下载"}
              <ArrowDownToLine size={16} />
            </button>
          </section>
        </div>
      </div>
      <footer className="direct-tool-footer">
        <div className="tool-status" role="status" aria-live="polite">
          {status || "隐私：PDF 仅在当前浏览器内存中读取、重排和导出；不会调用模型或上传服务器。"}
        </div>
      </footer>
    </section>
  );
}
