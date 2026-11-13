"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BookOpen, FilePlus2, Search, Trash2, Upload } from "lucide-react";
import ConfirmDialog, { type ConfirmRequest } from "@/components/ConfirmDialog";
import { isSupportedChatTextFile, readChatDocument } from "@/lib/attachment-reader";
import { clientSession } from "@/lib/client-session";

type Document = { id: string; title: string; content: string; created_at: string };
type KnowledgeResponse = { documents: Document[] };

class KnowledgeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "KnowledgeApiError";
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const requestEpoch = clientSession.epoch;
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (
    response.status === 401 &&
    requestEpoch === clientSession.epoch &&
    typeof window !== "undefined"
  ) {
    window.dispatchEvent(
      new CustomEvent("nexora:session-expired", { detail: { epoch: requestEpoch } }),
    );
  }
  if (!response.ok) throw new KnowledgeApiError(data.error || "请求失败", response.status);
  return data as T;
}

type AddInput = { title: string; content: string; requestEpoch: number };
type UpdateInput = { id: string; title: string; content: string; requestEpoch: number };
type RemoveInput = { id: string; requestEpoch: number };
type MutationContext = {
  previous: KnowledgeResponse | undefined;
  optimisticId?: string;
  requestEpoch: number;
};

export default function KnowledgeView({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const knowledgeQueryKey = ["knowledge", userId] as const;
  const knowledgeQuery = useQuery({
    queryKey: knowledgeQueryKey,
    // This is a small, read-only list. Let it finish when the view is switched away
    // from so React Query's observer cleanup cannot surface a browser AbortError in
    // the Next.js development overlay.
    queryFn: () => request<KnowledgeResponse>("/api/knowledge"),
    staleTime: 30_000,
    retry: (failureCount, error) =>
      !(error instanceof KnowledgeApiError && error.status < 500) && failureCount < 1,
  });
  const documents = knowledgeQuery.data?.documents || [];
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [editError, setEditError] = useState("");
  const [selected, setSelected] = useState<Document | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmRequest | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeConfirmation = useCallback(() => setConfirmation(null), []);

  useEffect(() => {
    if (!selected) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [selected]);

  function trapDialogFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const addMutation = useMutation({
    mutationFn: ({ title, content, requestEpoch }: AddInput) => {
      if (requestEpoch !== clientSession.epoch) throw new Error("登录状态已切换，请重新加载资料。");
      return request<{ document: Document }>("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ title, content }),
      });
    },
    onMutate: async (input): Promise<MutationContext> => {
      await queryClient.cancelQueries({ queryKey: knowledgeQueryKey });
      const previous = queryClient.getQueryData<KnowledgeResponse>(knowledgeQueryKey);
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimisticDocument: Document = {
        id: optimisticId,
        title: input.title,
        content: input.content,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData<KnowledgeResponse>(knowledgeQueryKey, (current) => ({
        documents: [optimisticDocument, ...(current?.documents || [])],
      }));
      return { previous, optimisticId, requestEpoch: input.requestEpoch };
    },
    onError: (_cause, _input, context) => {
      if (!context || context.requestEpoch !== clientSession.epoch) return;
      queryClient.setQueryData<KnowledgeResponse>(
        knowledgeQueryKey,
        context.previous || { documents: [] },
      );
    },
    onSuccess: (data, _input, context) => {
      if (!context || context.requestEpoch !== clientSession.epoch) return;
      queryClient.setQueryData<KnowledgeResponse>(knowledgeQueryKey, (current) => {
        const currentDocuments = current?.documents || [];
        const optimisticIndex = currentDocuments.findIndex(
          (document) => document.id === context.optimisticId,
        );
        if (optimisticIndex < 0) return { documents: [data.document, ...currentDocuments] };
        return {
          documents: currentDocuments.map((document) =>
            document.id === context.optimisticId ? data.document : document,
          ),
        };
      });
      setTitle("");
      setContent("");
    },
    onSettled: (_data, _cause, _input, context) =>
      context?.requestEpoch === clientSession.epoch
        ? queryClient.invalidateQueries({ queryKey: knowledgeQueryKey })
        : undefined,
  });

  const removeMutation = useMutation({
    mutationFn: ({ id, requestEpoch }: RemoveInput) => {
      if (requestEpoch !== clientSession.epoch) throw new Error("登录状态已切换，请重新加载资料。");
      return request(`/api/knowledge/${id}`, { method: "DELETE" });
    },
    onMutate: async (input): Promise<MutationContext> => {
      await queryClient.cancelQueries({ queryKey: knowledgeQueryKey });
      const previous = queryClient.getQueryData<KnowledgeResponse>(knowledgeQueryKey);
      queryClient.setQueryData<KnowledgeResponse>(knowledgeQueryKey, (current) => ({
        documents: (current?.documents || []).filter((document) => document.id !== input.id),
      }));
      return { previous, requestEpoch: input.requestEpoch };
    },
    onError: (_cause, _input, context) => {
      if (!context || context.requestEpoch !== clientSession.epoch) return;
      queryClient.setQueryData<KnowledgeResponse>(
        knowledgeQueryKey,
        context.previous || { documents: [] },
      );
    },
    onSuccess: (_data, input, context) => {
      if (context?.requestEpoch === clientSession.epoch)
        setSelected((current) => (current?.id === input.id ? null : current));
    },
    onSettled: (_data, _cause, _input, context) =>
      context?.requestEpoch === clientSession.epoch
        ? queryClient.invalidateQueries({ queryKey: knowledgeQueryKey })
        : undefined,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, title, content, requestEpoch }: UpdateInput) => {
      if (requestEpoch !== clientSession.epoch) throw new Error("登录状态已切换，请重新加载资料。");
      return request<{ document: Document }>(`/api/knowledge/${id}`, {
        method: "PUT",
        body: JSON.stringify({ title, content }),
      });
    },
    onSuccess: (data, input) => {
      if (input.requestEpoch !== clientSession.epoch) return;
      setSelected(data.document);
      setEditing(false);
    },
    onSettled: (_data, _cause, input) =>
      input.requestEpoch === clientSession.epoch
        ? queryClient.invalidateQueries({ queryKey: knowledgeQueryKey })
        : undefined,
  });
  const mutationBusy =
    addMutation.isPending || removeMutation.isPending || updateMutation.isPending;

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const requestEpoch = clientSession.epoch;
    setError("");
    try {
      await addMutation.mutateAsync({ title, content, requestEpoch });
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setError(cause instanceof Error ? cause.message : "保存失败");
    }
  }

  async function remove(id: string) {
    const requestEpoch = clientSession.epoch;
    setError("");
    try {
      await removeMutation.mutateAsync({ id, requestEpoch });
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setError(cause instanceof Error ? cause.message : "删除失败");
    }
  }

  async function saveEditedDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const requestEpoch = clientSession.epoch;
    setEditError("");
    try {
      await updateMutation.mutateAsync({
        id: selected.id,
        title: editTitle,
        content: editContent,
        requestEpoch,
      });
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setEditError(cause instanceof Error ? cause.message : "保存修改失败");
    }
  }

  async function importFile(file?: File) {
    if (!file) return;
    if (!isSupportedChatTextFile(file)) {
      setError("暂不支持此文件。可导入 TXT、Markdown、CSV、DOCX、XLSX、PPTX、PDF 或代码文件。");
      return;
    }
    setError("");
    try {
      const text = await readChatDocument(file);
      if (text.trim().length > 20_000) {
        setError("资料内容最多 20000 字，请先精简文件再导入。");
        return;
      }
      const importedTitle = file.name
        .replace(/\.env\.example$/i, "")
        .replace(/\.[^.]+$/, "")
        .slice(0, 100);
      setTitle(importedTitle || "导入资料");
      setContent(text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件读取失败，请检查文件后重试。");
    }
  }

  const filtered = documents.filter((doc) =>
    `${doc.title} ${doc.content}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="knowledge">
      <div className="listing-head">
        <p className="eyebrow">
          <span className="pulse" /> PERSONAL KNOWLEDGE
        </p>
        <h1>让 Agent 了解你的上下文。</h1>
        <p>
          保存项目规则、活动资料或个人偏好。规划目标时会检索相关片段，并展示引用来源。实时 AI
          模式会把检索片段发送给 DeepSeek。
        </p>
        <p className="knowledge-model-note">
          中文语义索引在本机计算和保存；首次语义检索会下载约 24 MB 模型。模型无法加载时会自动回退关键词检索。
        </p>
      </div>
      <div className="knowledge-layout">
        <form className="knowledge-compose" onSubmit={add}>
          <div className="knowledge-compose-head">
            <span>
              <FilePlus2 size={19} /> 添加一份资料
            </span>
            <small>PRIVATE / AI CONTEXT</small>
          </div>
          <label>
            资料标题
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：社团招新活动要求"
              maxLength={100}
              required
            />
          </label>
          <label>
            资料内容
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="粘贴你的活动规则、项目背景、约束条件或参考资料…"
              minLength={20}
              maxLength={20000}
              required
            />
          </label>
          <div className="knowledge-compose-foot">
            <div className="knowledge-import-control">
              <label className="knowledge-import">
                <Upload size={15} /> 导入资料文件
                <input
                  type="file"
                  accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.java,.go,.rs,.sql,.yaml,.yml,.toml,.sh,.log,.env.example,.docx,.xlsx,.pptx,.pdf,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    void importFile(file);
                  }}
                />
              </label>
              <small className="knowledge-import-hint">
                TXT · MD · CSV · DOCX · XLSX · PPTX · PDF · 代码 · 5 MB 内
              </small>
            </div>
            <button className="button-primary" disabled={mutationBusy}>
              {addMutation.isPending ? "保存中…" : "加入知识库"}
              <ArrowRight size={16} />
            </button>
          </div>
          {error && (
            <p className="knowledge-error" role="alert" aria-live="polite">
              {error}
            </p>
          )}
        </form>
        <div className="knowledge-library">
          <div className="knowledge-library-head">
            <div>
              <BookOpen size={19} />
              <strong>我的资料</strong>
              <span>{documents.length}</span>
              {knowledgeQuery.isFetching && !knowledgeQuery.isPending && (
                <small className="knowledge-sync" role="status">
                  同步中…
                </small>
              )}
            </div>
            <label>
              <Search size={16} />
              <input
                aria-label="搜索知识资料"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索资料"
              />
            </label>
          </div>
          {knowledgeQuery.isPending ? (
            <div className="knowledge-empty" role="status" aria-live="polite">
              <BookOpen size={30} />
              <h3>正在读取资料</h3>
              <p>正在同步你的私有知识库。</p>
              <span className="knowledge-loading-line" />
            </div>
          ) : knowledgeQuery.isError && !knowledgeQuery.data ? (
            <div className="knowledge-empty" role="alert">
              <BookOpen size={30} />
              <h3>知识库暂时无法读取</h3>
              <p>
                {knowledgeQuery.error instanceof Error
                  ? knowledgeQuery.error.message
                  : "请检查连接后重试。"}
              </p>
              <button
                type="button"
                className="knowledge-retry"
                disabled={knowledgeQuery.isFetching}
                onClick={() => void knowledgeQuery.refetch()}
              >
                {knowledgeQuery.isFetching ? "正在重试…" : "重试加载"}
              </button>
            </div>
          ) : filtered.length ? (
            <div className="knowledge-list">
              {filtered.map((doc) => (
                <article key={doc.id}>
                  <div>
                    <span>
                      {doc.id.startsWith("optimistic-") ? "正在保存" : "KNOWLEDGE SOURCE"}
                    </span>
                    <button
                      disabled={mutationBusy || doc.id.startsWith("optimistic-")}
                      onClick={() =>
                        setConfirmation({
                          title: "删除这份资料？",
                          description: `「${doc.title}」将从你的知识库中永久移除，Agent 后续规划也不会再检索它。`,
                          confirmLabel: "删除资料",
                          tone: "danger",
                          onConfirm: () => remove(doc.id),
                        })
                      }
                      aria-label={`删除${doc.title}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <button
                    className="knowledge-open"
                    disabled={doc.id.startsWith("optimistic-")}
                    onClick={() => setSelected(doc)}
                  >
                    <strong>{doc.title}</strong>
                    <p>{doc.content}</p>
                    <small>查看全文 ↗</small>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="knowledge-empty">
              <BookOpen size={30} />
              <h3>{query ? "没有找到匹配资料" : "知识库还是空的"}</h3>
              <p>{query ? "试试更短的关键词。" : "添加第一份资料，让 Agent 规划时有据可依。"}</p>
            </div>
          )}
        </div>
      </div>
      {selected && (
        <div
          className="knowledge-modal"
          onClick={() => {
            if (!updateMutation.isPending) {
              setSelected(null);
              setEditing(false);
              setEditError("");
            }
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-dialog-title"
            aria-describedby={editing ? undefined : "knowledge-dialog-content"}
            tabIndex={-1}
            onKeyDown={trapDialogFocus}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="knowledge-modal-actions">
              {!editing && (
                <button
                  type="button"
                  disabled={mutationBusy}
                  onClick={() => {
                    setEditTitle(selected.title);
                    setEditContent(selected.content);
                    setEditError("");
                    setEditing(true);
                  }}
                >
                  编辑资料
                </button>
              )}
              <button
                type="button"
                disabled={updateMutation.isPending}
                onClick={() => {
                  setSelected(null);
                  setEditing(false);
                  setEditError("");
                }}
                aria-label="关闭资料预览"
              >
                关闭 ✕
              </button>
            </div>
            <span>KNOWLEDGE SOURCE</span>
            {editing ? (
              <>
                <h2 id="knowledge-dialog-title">编辑资料</h2>
                <form className="knowledge-edit-form" onSubmit={saveEditedDocument}>
                  <label>
                    资料标题
                    <input
                      aria-label="编辑资料标题"
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      maxLength={100}
                      minLength={2}
                      required
                    />
                  </label>
                  <label>
                    资料内容
                    <textarea
                      aria-label="编辑资料内容"
                      value={editContent}
                      onChange={(event) => setEditContent(event.target.value)}
                      maxLength={20000}
                      minLength={20}
                      required
                    />
                  </label>
                  {editError && (
                    <p className="knowledge-error" role="alert" aria-live="polite">
                      {editError}
                    </p>
                  )}
                  <div className="knowledge-edit-actions">
                    <button
                      type="button"
                      className="knowledge-edit-cancel"
                      disabled={updateMutation.isPending}
                      onClick={() => {
                        setEditing(false);
                        setEditError("");
                      }}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="button-primary"
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending ? "保存中…" : "保存修改"}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h2 id="knowledge-dialog-title">{selected.title}</h2>
                <pre id="knowledge-dialog-content">{selected.content}</pre>
              </>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        request={confirmation}
        onClose={closeConfirmation}
        onActionError={(cause) =>
          setError(cause instanceof Error ? cause.message : "确认操作失败，请重试。")
        }
      />
    </section>
  );
}
