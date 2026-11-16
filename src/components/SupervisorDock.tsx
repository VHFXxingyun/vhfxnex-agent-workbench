"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  Code2,
  FileText,
  LoaderCircle,
  Paperclip,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import type { ChatAttachment, ConversationMessage, Workspace } from "@/lib/goal";

type DockMessage = Pick<ConversationMessage, "id" | "role" | "content"> & {
  handoff?: boolean;
  route?: string;
  workspaceId?: string;
};
type DockWorkspace = Pick<Workspace, "id" | "plan" | "mode" | "conversation">;
const GLOBAL_SCOPE = "__global_supervisor__";

function setScopedValue<T>(
  setter: Dispatch<SetStateAction<Record<string, T>>>,
  scope: string,
  value: NoInfer<T>,
) {
  setter((current) => ({ ...current, [scope]: value }));
}

function getWorkspaceDialogueMessages(workspace: DockWorkspace | undefined): DockMessage[] {
  return (
    workspace?.conversation
      ?.filter((message) => message.role === "user" || message.agent === "dialogue")
      .slice(-8)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
      })) || []
  );
}

export default function SupervisorDock({
  workspaces,
  activeWorkspaceId,
  open,
  onOpenChange,
  onOpenWorkspace,
  onOpenTools,
  onOpenUserTool,
  onStartNewGoal,
  initialPrompt,
  onPromptConsumed,
  initialAttachments,
  onAttachmentsConsumed,
  onHandoff,
}: {
  workspaces: DockWorkspace[];
  activeWorkspaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenWorkspace: (id: string) => void;
  onOpenTools: () => void;
  onOpenUserTool: (
    tool: "documents" | "pdf" | "code" | "spreadsheet" | "json" | "presentation" | "search",
    instruction: string,
  ) => void;
  onStartNewGoal: (prompt: string) => void;
  initialPrompt: string;
  onPromptConsumed: () => void;
  initialAttachments: ChatAttachment[];
  onAttachmentsConsumed: () => void;
  onHandoff: () => void;
}) {
  const candidates = useMemo(() => workspaces.filter((item) => item.id), [workspaces]);
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId || GLOBAL_SCOPE);
  const [workspaceMessages, setWorkspaceMessages] = useState<Record<string, DockMessage[]>>({});
  const [globalMessages, setGlobalMessages] = useState<DockMessage[]>([]);
  const [draftByScope, setDraftByScope] = useState<Record<string, string>>({});
  const [sendingByScope, setSendingByScope] = useState<Record<string, boolean>>({});
  const [streamTextByScope, setStreamTextByScope] = useState<Record<string, string>>({});
  const [activityByScope, setActivityByScope] = useState<Record<string, string>>({});
  const [errorByScope, setErrorByScope] = useState<Record<string, string>>({});
  const [handoffNoticeByScope, setHandoffNoticeByScope] = useState<Record<string, string>>({});
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [conversationAttachments, setConversationAttachments] = useState<ChatAttachment[]>([]);
  const [resendConversationAttachments, setResendConversationAttachments] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const shouldFollowLatestRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const globalConversationLoaded = useRef(false);
  const globalConversationRevision = useRef(0);
  const selectedWorkspaceId =
    workspaceId === GLOBAL_SCOPE
      ? ""
      : candidates.some((item) => item.id === workspaceId)
        ? workspaceId
        : candidates.some((item) => item.id === activeWorkspaceId)
          ? (activeWorkspaceId as string)
          : "";
  const workspace = candidates.find((item) => item.id === selectedWorkspaceId);
  const activeScope = selectedWorkspaceId || GLOBAL_SCOPE;
  const activeScopeRef = useRef(activeScope);
  const sending = sendingByScope[activeScope] || false;
  const globalSupervisorSending = sendingByScope[GLOBAL_SCOPE] || false;
  const streamText = streamTextByScope[activeScope] || "";
  const activity = activityByScope[activeScope] || "";
  const error = errorByScope[activeScope] || "";
  const handoffNotice = handoffNoticeByScope[activeScope] || "";
  const draft = draftByScope[activeScope] || "";
  const messages = selectedWorkspaceId
    ? (workspaceMessages[selectedWorkspaceId] ?? getWorkspaceDialogueMessages(workspace))
    : globalMessages;
  useEffect(() => {
    if (activeScopeRef.current !== activeScope) {
      activeScopeRef.current = activeScope;
      shouldFollowLatestRef.current = true;
      setShowJumpToLatest(false);
    }
    const thread = threadRef.current;
    if (!thread || !shouldFollowLatestRef.current) return;
    thread.scrollTop = thread.scrollHeight;
  }, [activeScope, activity, handoffNotice, messages, streamText]);

  const updateMessagesForScope = (
    scopeWorkspaceId: string | null,
    update: DockMessage[] | ((current: DockMessage[]) => DockMessage[]),
  ) => {
    if (!scopeWorkspaceId) {
      globalConversationRevision.current += 1;
      setGlobalMessages(update);
      return;
    }
    setWorkspaceMessages((current) => {
      const initial =
        current[scopeWorkspaceId] ??
        getWorkspaceDialogueMessages(candidates.find((item) => item.id === scopeWorkspaceId));
      return {
        ...current,
        [scopeWorkspaceId]: typeof update === "function" ? update(initial) : update,
      };
    });
  };
  const setDraftForScope = (scope: string, value: string) =>
    setScopedValue(setDraftByScope, scope, value);
  const previousActiveWorkspaceId = useRef(activeWorkspaceId);

  const previousSelectedWorkspaceId = useRef(selectedWorkspaceId);
  useEffect(() => {
    if (selectedWorkspaceId === previousSelectedWorkspaceId.current) return;
    previousSelectedWorkspaceId.current = selectedWorkspaceId;
    setConversationAttachments([]);
    setResendConversationAttachments(false);
    onAttachmentsConsumed();
  }, [onAttachmentsConsumed, selectedWorkspaceId]);

  useEffect(() => {
    if (activeWorkspaceId === previousActiveWorkspaceId.current) return;
    previousActiveWorkspaceId.current = activeWorkspaceId;
    setWorkspaceId(activeWorkspaceId || GLOBAL_SCOPE);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (workspaceId !== GLOBAL_SCOPE || globalConversationLoaded.current) return;
    let cancelled = false;
    const requestRevision = globalConversationRevision.current;
    void fetch("/api/supervisor/conversation", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法载入总控历史对话。");
        return (await response.json()) as {
          messages?: Array<{
            id: string;
            role: "user" | "assistant";
            content: string;
            workspaceId?: string;
          }>;
        };
      })
      .then((payload) => {
        if (cancelled) return;
        setGlobalMessages((current) =>
          globalConversationRevision.current === requestRevision
            ? Array.isArray(payload.messages)
              ? payload.messages.map((message) => ({
                  id: message.id,
                  role: message.role,
                  content: message.content,
                  ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
                }))
              : []
            : current,
        );
        globalConversationLoaded.current = true;
      })
      .catch((cause) => {
        if (!cancelled)
          setScopedValue(
            setErrorByScope,
            GLOBAL_SCOPE,
            cause instanceof Error ? cause.message : "无法载入总控历史对话。",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!open || workspaceId !== GLOBAL_SCOPE || globalSupervisorSending) return;
    let cancelled = false;
    let refreshing = false;
    const refreshConversation = async () => {
      if (refreshing) return;
      refreshing = true;
      const requestRevision = globalConversationRevision.current;
      try {
        const response = await fetch("/api/supervisor/conversation", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          messages?: Array<{
            id: string;
            role: "user" | "assistant";
            content: string;
            workspaceId?: string;
          }>;
        };
        if (cancelled) return;
        setGlobalMessages((current) =>
          globalConversationRevision.current === requestRevision
            ? Array.isArray(payload.messages)
              ? payload.messages.map((message) => ({
                  id: message.id,
                  role: message.role,
                  content: message.content,
                  ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
                }))
              : []
            : current,
        );
        globalConversationLoaded.current = true;
      } catch {
        // Keep the last known chat visible if a background refresh briefly fails.
      } finally {
        refreshing = false;
      }
    };
    void refreshConversation();
    const interval = window.setInterval(() => void refreshConversation(), 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [globalSupervisorSending, open, workspaceId]);

  useEffect(
    () => () => {
      for (const controller of abortControllersRef.current.values()) controller.abort();
      abortControllersRef.current.clear();
    },
    [],
  );

  async function sendMessage() {
    const scopeKey = activeScope;
    const scopeWorkspaceId = selectedWorkspaceId || null;
    const question = draft.trim() || (scopeWorkspaceId ? "" : initialPrompt.trim());
    if (!question || sendingByScope[scopeKey]) return;
    const activeAttachments = initialAttachments.length
      ? initialAttachments
      : conversationAttachments;
    const includeAttachmentBody = initialAttachments.length > 0 || resendConversationAttachments;
    shouldFollowLatestRef.current = true;
    setShowJumpToLatest(false);
    const userMessage: DockMessage = { id: crypto.randomUUID(), role: "user", content: question };
    updateMessagesForScope(scopeWorkspaceId, (current) => [...current, userMessage]);
    setDraftForScope(scopeKey, "");
    if (initialPrompt) onPromptConsumed();
    setScopedValue(setErrorByScope, scopeKey, "");
    setScopedValue(setHandoffNoticeByScope, scopeKey, "");
    setScopedValue(setStreamTextByScope, scopeKey, "");
    setScopedValue(setActivityByScope, scopeKey, "");
    setScopedValue(setSendingByScope, scopeKey, true);
    const controller = new AbortController();
    abortControllersRef.current.set(scopeKey, controller);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : {}),
          question,
          thinkingMode: "deep",
          attachments: includeAttachmentBody ? activeAttachments : [],
          handoffAttachments: includeAttachmentBody ? [] : activeAttachments,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "管理员 Agent 暂时无法连接，请重试。");
      }
      if (!response.body) throw new Error("当前浏览器没有提供可用的流式连接。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let delegated = false;
      let routed = "";
      const handleEvent = (raw: string) => {
        const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) return;
        const event = JSON.parse(dataLine.slice(6)) as {
          type?: string;
          text?: string;
          error?: string;
          instruction?: string;
          acknowledgment?: string;
          tool?: "documents" | "pdf" | "code" | "spreadsheet" | "json" | "presentation" | "search";
          prompt?: string;
          workspaceTitle?: string;
          message?: string;
        };
        if (event.type === "text" && event.text) {
          answer += event.text;
          setScopedValue(setActivityByScope, scopeKey, "");
          setScopedValue(setStreamTextByScope, scopeKey, answer);
        } else if (event.type === "status") {
          setScopedValue(setActivityByScope, scopeKey, event.message || "管理员 Agent 正在处理…");
        } else if (event.type === "handoff") {
          delegated = true;
          const targetNote = event.workspaceTitle
            ? `已路由到「${event.workspaceTitle}」`
            : "已交给工作台 Agent";
          routed = targetNote;
          setScopedValue(
            setHandoffNoticeByScope,
            scopeKey,
            `${event.acknowledgment || "工作台 Agent 已接收任务。"} ${targetNote}，可切换页面，任务会在后台继续。`,
          );
          onHandoff();
        } else if (event.type === "launch_tool" && event.tool && event.instruction) {
          routed =
            event.tool === "documents"
              ? "已打开文档工作台"
              : event.tool === "pdf"
                ? "已打开 PDF 工具箱"
                : event.tool === "code"
                  ? "已打开代码工坊"
                  : event.tool === "spreadsheet"
                    ? "已打开表格工作台"
                    : event.tool === "json"
                      ? "已打开 JSON 工坊"
                      : event.tool === "presentation"
                        ? "已打开演示稿工坊"
                        : "已打开联网搜索工具";
          setScopedValue(
            setHandoffNoticeByScope,
            scopeKey,
            `${routed}，你可以直接操作；需要 Agent 代做时再交给工作台。`,
          );
          onOpenUserTool(event.tool, event.instruction);
        } else if (event.type === "start_new_goal" && event.prompt) {
          routed = "已交给规划器创建新目标";
          setScopedValue(setHandoffNoticeByScope, scopeKey, "正在为新目标生成执行路线…");
          onStartNewGoal(event.prompt);
        } else if (event.type === "error") {
          throw new Error(event.error || "交流没有完成，请重试。");
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) if (chunk.trim()) handleEvent(chunk);
        if (done) break;
      }
      if (buffer.trim()) handleEvent(buffer);
      const finalText = answer.trim() || (delegated ? "已完成交接。" : "Agent 没有返回文字回复。");
      updateMessagesForScope(scopeWorkspaceId, (current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: finalText,
          handoff: delegated,
          ...(routed ? { route: routed } : {}),
        },
      ]);
      setScopedValue(setStreamTextByScope, scopeKey, "");
      setScopedValue(setActivityByScope, scopeKey, "");
      if (delegated) {
        setConversationAttachments([]);
        setResendConversationAttachments(false);
        onAttachmentsConsumed();
      } else if (initialAttachments.length) {
        setConversationAttachments(initialAttachments);
        setResendConversationAttachments(false);
        onAttachmentsConsumed();
      } else if (resendConversationAttachments) {
        setResendConversationAttachments(false);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setScopedValue(setStreamTextByScope, scopeKey, "");
        return;
      }
      setScopedValue(
        setErrorByScope,
        scopeKey,
        cause instanceof Error ? cause.message : "交流失败，请重试。",
      );
      updateMessagesForScope(scopeWorkspaceId, (current) =>
        current.filter((message) => message.id !== userMessage.id),
      );
      setDraftForScope(scopeKey, question);
      setScopedValue(setStreamTextByScope, scopeKey, "");
      setScopedValue(setActivityByScope, scopeKey, "");
    } finally {
      if (abortControllersRef.current.get(scopeKey) === controller)
        abortControllersRef.current.delete(scopeKey);
      setScopedValue(setSendingByScope, scopeKey, false);
      setScopedValue(setActivityByScope, scopeKey, "");
    }
  }

  async function startNewConversation() {
    const scopeKey = activeScope;
    const scopeWorkspaceId = selectedWorkspaceId || null;
    abortControllersRef.current.get(scopeKey)?.abort();
    if (initialPrompt) onPromptConsumed();
    if (initialAttachments.length || conversationAttachments.length) onAttachmentsConsumed();
    setConversationAttachments([]);
    setResendConversationAttachments(false);
    updateMessagesForScope(scopeWorkspaceId, []);
    setDraftForScope(scopeKey, "");
    setScopedValue(setStreamTextByScope, scopeKey, "");
    setScopedValue(setActivityByScope, scopeKey, "");
    setScopedValue(setHandoffNoticeByScope, scopeKey, "");
    setScopedValue(setErrorByScope, scopeKey, "");
    if (workspace) {
      const prior =
        workspace.conversation
          ?.filter((message) => message.role !== "assistant" || message.agent === "dialogue")
          .slice(-10) || [];
      if (prior.length)
        updateMessagesForScope(
          scopeWorkspaceId,
          prior.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
          })),
        );
    } else {
      const previousMessages = globalMessages;
      try {
        const response = await fetch("/api/supervisor/conversation", { method: "DELETE" });
        if (!response.ok) throw new Error("总控历史没有清除成功。");
        globalConversationLoaded.current = true;
      } catch {
        globalConversationLoaded.current = true;
        setGlobalMessages(previousMessages);
        setScopedValue(
          setErrorByScope,
          scopeKey,
          "总控历史没有清除成功，已恢复原对话；请稍后重试。",
        );
      }
    }
  }

  return (
    <div className="supervisor-dock-root">
      <AnimatePresence>
        {open && (
          <motion.section
            className="supervisor-dock"
            aria-label="VHFXNEX 管理员 Agent"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
          >
            <header className="supervisor-dock-head">
              <div className="supervisor-avatar">
                <Sparkles size={18} />
              </div>
              <div>
                <strong>VHFXNEX 管理员</strong>
                <span>对话 · Agent 协作 · 工具调度</span>
              </div>
              <button
                type="button"
                title="新对话"
                aria-label="新对话"
                onClick={startNewConversation}
              >
                <Plus size={17} />
              </button>
              <button
                type="button"
                title="收起"
                aria-label="收起管理员 Agent"
                onClick={() => onOpenChange(false)}
              >
                <X size={17} />
              </button>
            </header>
            <div className="supervisor-context-row">
              <button
                type="button"
                className="supervisor-context-select"
                aria-expanded={selectorOpen}
                onClick={() => setSelectorOpen((value) => !value)}
              >
                <span>
                  <i
                    className={
                      workspaceId === GLOBAL_SCOPE
                        ? "live"
                        : workspace?.mode === "demo"
                          ? "demo"
                          : "live"
                    }
                  />
                  {workspaceId === GLOBAL_SCOPE
                    ? "VHFXNEX 全局管理员"
                    : workspace?.plan.title || "选择工作区"}
                </span>
                <ChevronDown size={15} />
              </button>
              {workspace && (
                <button
                  type="button"
                  className="supervisor-open-workspace"
                  onClick={() => onOpenWorkspace(workspace.id)}
                >
                  打开工作区 <ArrowRight size={14} />
                </button>
              )}
              {selectorOpen && (
                <div className="supervisor-context-menu">
                  <button
                    type="button"
                    className={!selectedWorkspaceId ? "selected" : ""}
                    onClick={() => {
                      setWorkspaceId(GLOBAL_SCOPE);
                      setSelectorOpen(false);
                      setScopedValue(setHandoffNoticeByScope, GLOBAL_SCOPE, "");
                      setScopedValue(setErrorByScope, GLOBAL_SCOPE, "");
                    }}
                  >
                    VHFXNEX 全局管理员
                    <small>协调规划、执行、复核 Agent 与用户工具</small>
                  </button>
                  {candidates.length ? (
                    candidates.slice(0, 12).map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={item.id === selectedWorkspaceId ? "selected" : ""}
                        onClick={() => {
                          setWorkspaceId(item.id);
                          setSelectorOpen(false);
                          setWorkspaceMessages((current) =>
                            current[item.id]
                              ? current
                              : { ...current, [item.id]: getWorkspaceDialogueMessages(item) },
                          );
                          setScopedValue(setHandoffNoticeByScope, item.id, "");
                          setScopedValue(setErrorByScope, item.id, "");
                        }}
                      >
                        {item.plan.title}
                        <small>{item.mode === "demo" ? "演示模式" : "实时工作区"}</small>
                      </button>
                    ))
                  ) : (
                    <p>尚无可调度的目标工作区</p>
                  )}
                </div>
              )}
            </div>
            <div className="supervisor-scope-note">
              {workspace
                ? "作为统一入口与你交流，并在你的权限内调度当前工作区 Agent 和所有注册工具。"
                : "统一入口可交流、查看后台概况、使用直接工具，并把工作交给你有权限的项目 Agent。"}
            </div>
            <div
              ref={threadRef}
              className="supervisor-thread"
              aria-live="polite"
              onScroll={(event) => {
                const thread = event.currentTarget;
                const isNearBottom =
                  thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 64;
                shouldFollowLatestRef.current = isNearBottom;
                setShowJumpToLatest(!isNearBottom);
              }}
            >
              {!messages.length && !streamText ? (
                <div className="supervisor-welcome">
                  <span className="supervisor-welcome-mark">
                    <Sparkles size={19} />
                  </span>
                  <h3>你的 VHFXNEX 管理员</h3>
                  <p>直接说需求即可。我会回答问题、调度专用 Agent 和工具，并持续推进明确的工作。</p>
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftForScope(activeScope, "告诉我当前目标进度和还没完成的工作")
                      }
                    >
                      查看项目进度
                    </button>
                    <button type="button" onClick={onOpenTools}>
                      打开直接工具 <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <article key={message.id} className={`supervisor-message ${message.role}`}>
                    <p>{message.content}</p>
                    {message.handoff && (
                      <small>
                        <Check size={13} /> 已交工作台 Agent 执行
                      </small>
                    )}
                    {message.route && (
                      <small>
                        <Check size={13} /> {message.route}
                      </small>
                    )}
                    {message.role === "assistant" &&
                      message.workspaceId &&
                      candidates.some((item) => item.id === message.workspaceId) && (
                        <button
                          className="supervisor-result-link"
                          type="button"
                          onClick={() => onOpenWorkspace(message.workspaceId!)}
                        >
                          查看项目成果 <ArrowRight size={13} />
                        </button>
                      )}
                  </article>
                ))
              )}
              {streamText && (
                <article className="supervisor-message assistant">
                  <p>
                    {streamText}
                    <span className="supervisor-caret" />
                  </p>
                </article>
              )}
              {sending && (activity || !streamText) && (
                <div className="supervisor-thinking">
                  <LoaderCircle size={15} className="chat-spinner" />{" "}
                  {activity || "管理员 Agent 正在理解请求…"}
                </div>
              )}
              {handoffNotice && (
                <div className="supervisor-handoff-note">
                  <Check size={15} />
                  <span>{handoffNotice}</span>
                </div>
              )}
              {showJumpToLatest && (
                <button
                  className="supervisor-jump-latest"
                  type="button"
                  aria-label="跳到最新消息"
                  onClick={() => {
                    shouldFollowLatestRef.current = true;
                    setShowJumpToLatest(false);
                    const thread = threadRef.current;
                    if (thread) thread.scrollTop = thread.scrollHeight;
                  }}
                >
                  <ChevronDown size={14} /> 跳到最新
                </button>
              )}
            </div>
            <div className="supervisor-quicktools">
              <button type="button" onClick={onOpenTools}>
                <FileText size={14} />
                用户工具库
              </button>
              <button
                type="button"
                onClick={() => {
                  if (workspace) onOpenWorkspace(workspace.id);
                }}
                disabled={!workspace}
              >
                <Code2 size={14} />
                工作台 Agent
              </button>
            </div>
            {error && (
              <div className="supervisor-error" role="alert">
                <CircleAlert size={14} />
                {error}
              </div>
            )}
            <form
              className="supervisor-compose"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              {(initialAttachments.length > 0 || conversationAttachments.length > 0) && (
                <div className="supervisor-pending-attachments" role="status">
                  <Paperclip size={14} />
                  <span>
                    {initialAttachments.length > 0 ? "将随消息发送 " : "对话保留附件 "}
                    <strong>
                      {
                        (initialAttachments.length
                          ? initialAttachments
                          : conversationAttachments)[0].name
                      }
                    </strong>
                    {(initialAttachments.length ? initialAttachments : conversationAttachments)
                      .length > 1
                      ? ` 等 ${
                          (initialAttachments.length ? initialAttachments : conversationAttachments)
                            .length
                        } 个文件`
                      : ""}
                    {" · "}
                    {Math.ceil(
                      (initialAttachments.length
                        ? initialAttachments
                        : conversationAttachments
                      ).reduce(
                        (total, attachment) =>
                          total + new TextEncoder().encode(attachment.content).byteLength,
                        0,
                      ) / 1024,
                    )}{" "}
                    KB ·{" "}
                    {initialAttachments.length
                      ? "本次发送会计入模型用量"
                      : resendConversationAttachments
                        ? "本次会把全文发给总控并计入用量"
                        : "后续交给工作台时附带，不重复发送给管理员"}
                  </span>
                  {conversationAttachments.length > 0 && initialAttachments.length === 0 && (
                    <div className="supervisor-attachment-actions">
                      <button
                        type="button"
                        aria-pressed={resendConversationAttachments}
                        onClick={() => setResendConversationAttachments((value) => !value)}
                      >
                        {resendConversationAttachments ? "取消重发全文" : "重新发送全文"}
                      </button>
                      <button
                        type="button"
                        aria-label="移除对话附件"
                        title="移除对话附件"
                        onClick={() => {
                          setConversationAttachments([]);
                          setResendConversationAttachments(false);
                          onAttachmentsConsumed();
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={draft || (!selectedWorkspaceId ? initialPrompt : "")}
                onChange={(event) => {
                  setDraftForScope(activeScope, event.target.value);
                  if (initialPrompt) onPromptConsumed();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="问进度、聊方案，或交代一项完整工作…"
                rows={2}
                maxLength={4000}
                aria-label="发送给管理员 Agent"
              />
              <div>
                <span>深度思考 · Enter 发送 · Shift+Enter 换行</span>
                <button
                  type="submit"
                  disabled={
                    sending || !(draft.trim() || (!selectedWorkspaceId && initialPrompt.trim()))
                  }
                  aria-label="发送消息"
                >
                  {sending ? (
                    <LoaderCircle size={16} className="chat-spinner" />
                  ) : (
                    <ArrowUp size={17} />
                  )}
                </button>
              </div>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
      <button
        className={`supervisor-launcher ${open ? "open" : ""}`}
        type="button"
        aria-label={open ? "收起管理员 Agent" : "打开管理员 Agent"}
        title="VHFXNEX 管理员 Agent：交流、跨工作区调度与工具协调"
        onClick={() => onOpenChange(!open)}
      >
        {open ? (
          <X size={19} />
        ) : (
          <>
            <Sparkles size={19} />
            <span>管理员</span>
            <i />
          </>
        )}
      </button>
    </div>
  );
}
