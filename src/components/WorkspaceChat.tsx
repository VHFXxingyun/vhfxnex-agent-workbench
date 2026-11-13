"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleStop,
  GitBranch,
  FileCode2,
  FileText,
  FileImage,
  LoaderCircle,
  Mic,
  MicOff,
  Plus,
  X,
  Sparkles,
  Wrench,
} from "lucide-react";
import type {
  Artifact,
  ChatAttachment,
  ConversationMessage,
  RouteOption,
  Workspace,
} from "@/lib/goal";
import { agentToolCatalog } from "@/lib/agent-tool-catalog.mjs";

type SpeechRecognitionResult = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
type SpeechRecognitionEventLike = { resultIndex: number; results: SpeechRecognitionResult };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export default function WorkspaceChat({
  workspace,
  route,
  draft,
  busy,
  streamedText,
  pendingExecutionContent,
  questionBusy,
  pendingQuestion,
  questionStreamText,
  questionError,
  queuedHandoffCount,
  error,
  onDraftChange,
  onSelectRoute,
  onSend,
  onAsk,
  onStop,
  onOpenArtifact,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  thinkingMode,
  onThinkingModeChange,
  blockedByOtherExecution,
  readOnly,
}: {
  workspace: Workspace;
  route: RouteOption;
  draft: string;
  busy: boolean;
  streamedText: string;
  pendingExecutionContent: string;
  questionBusy: boolean;
  pendingQuestion: string;
  questionStreamText: string;
  questionError: string;
  queuedHandoffCount: number;
  error: string;
  onDraftChange: (value: string) => void;
  onSelectRoute: (routeId: string) => void;
  onSend: () => void;
  onAsk: () => void;
  onStop: () => void;
  onOpenArtifact: (artifact: Artifact) => void;
  attachments: ChatAttachment[];
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  thinkingMode: "fast" | "deep";
  onThinkingModeChange: (mode: "fast" | "deep") => void;
  blockedByOtherExecution: { title: string; activity: string } | null;
  readOnly: boolean;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const draftRef = useRef(draft);
  const [speechListening, setSpeechListening] = useState(false);
  const [speechNotice, setSpeechNotice] = useState("");
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const followLatestRef = useRef(true);
  const wasBusyRef = useRef(busy);
  const prefersReducedMotion = useReducedMotion();
  const conversation = useMemo<ConversationMessage[]>(() => {
    if (workspace.conversation?.length) {
      const hasExecutionReply = workspace.conversation.some(
        (message) => message.role === "assistant" && message.toolEvents !== undefined,
      );
      return workspace.result && !hasExecutionReply
        ? [
            ...workspace.conversation,
            {
              id: "recovered-result",
              role: "assistant",
              agent: "workbench",
              content: workspace.result.summary,
              toolEvents: workspace.result.events,
            },
          ]
        : workspace.conversation;
    }
    return [
      { id: "legacy-user", role: "user", content: workspace.prompt },
      {
        id: "legacy-plan",
        role: "assistant",
        agent: "planner",
        content: workspace.plan.summary,
      },
      ...(workspace.result
        ? [
            {
              id: "legacy-result",
              role: "assistant" as const,
              agent: "workbench" as const,
              content: workspace.result.summary,
              toolEvents: workspace.result.events,
            },
          ]
        : []),
    ];
  }, [workspace]);
  const conversationSourceUrls = new Set(
    conversation.flatMap((message) =>
      (message.toolEvents || []).flatMap((event) =>
        (event.sources || []).map((source) => source.url),
      ),
    ),
  );
  const savedSearchSources = (workspace.result?.events || [])
    .flatMap((event) => event.sources || [])
    .filter((source) => !conversationSourceUrls.has(source.url));
  const artifacts = workspace.result?.artifacts || [];
  const selectedRoute =
    workspace.plan.routes.find((item) => item.id === workspace.selectedRouteId) || route;
  const anAgentIsWorking = busy || questionBusy || Boolean(blockedByOtherExecution);
  const interactionLocked = questionBusy || readOnly;
  const shouldShowPendingExecution =
    busy &&
    pendingExecutionContent &&
    !conversation.some(
      (message) => message.role === "user" && message.content === pendingExecutionContent,
    );
  const submitMessage = () => {
    if (questionBusy || readOnly) return;
    followLatestRef.current = true;
    if (!draft.trim() && attachments.length === 0 && !workspace.result) onSend();
    else onAsk();
  };

  useEffect(
    () => () => {
      speechRecognitionRef.current?.stop();
      speechRecognitionRef.current = null;
    },
    [],
  );

  const toggleSpeechInput = () => {
    if (speechListening) {
      speechRecognitionRef.current?.stop();
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechNotice("当前浏览器不支持语音识别，请使用文字输入。" );
      return;
    }
    setSpeechNotice("语音识别由浏览器提供；部分浏览器可能会将音频发送给其语音服务商。" );
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript.trim())
        .filter(Boolean)
        .join("。 ");
      if (transcript) {
        const current = draftRef.current.trimEnd();
        const next = `${current}${current ? " " : ""}${transcript}`;
        draftRef.current = next;
        onDraftChange(next);
      }
    };
    recognition.onerror = (event) => {
      setSpeechListening(false);
      setSpeechNotice(
        event.error === "not-allowed"
          ? "麦克风权限未开启；请在浏览器地址栏允许麦克风后重试。"
          : "语音识别中断，可以重试或改用文字输入。",
      );
    };
    recognition.onend = () => {
      setSpeechListening(false);
      speechRecognitionRef.current = null;
    };
    speechRecognitionRef.current = recognition;
    try {
      recognition.start();
      setSpeechListening(true);
    } catch {
      speechRecognitionRef.current = null;
      setSpeechListening(false);
      setSpeechNotice("无法启动语音识别，请检查麦克风权限后重试。" );
    }
  };

  useEffect(() => {
    const started = busy && !wasBusyRef.current;
    wasBusyRef.current = busy;
    if (started) followLatestRef.current = true;
    if (!followLatestRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const thread = threadRef.current;
      if (thread && followLatestRef.current) thread.scrollTop = thread.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    busy,
    conversation.length,
    pendingExecutionContent,
    pendingQuestion,
    questionBusy,
    questionStreamText,
    streamedText,
  ]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    let frame = 0;
    const keepLatestVisible = () => {
      if (!followLatestRef.current || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (followLatestRef.current && thread.isConnected) thread.scrollTop = thread.scrollHeight;
      });
    };
    const resizeObserver = new ResizeObserver(keepLatestVisible);
    const observeChildren = () => {
      resizeObserver.observe(thread);
      for (const child of thread.children) resizeObserver.observe(child);
    };
    observeChildren();
    const mutationObserver = new MutationObserver(() => {
      observeChildren();
      keepLatestVisible();
    });
    mutationObserver.observe(thread, { childList: true, characterData: true, subtree: true });
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section className="workspace-chat" aria-label="与目标 Agent 对话">
      <header className="workspace-chat-head">
        <span className="workspace-chat-avatar">
          <Sparkles size={18} />
        </span>
        <div>
          <strong>
            {questionBusy
              ? "对话 Agent 正在回应"
              : blockedByOtherExecution
                ? "工作台 Agent 正在执行其他目标"
                : busy
                  ? "工作台 Agent 正在执行"
                  : "对话 Agent · 工作台协作"}
          </strong>
          <span>
            {blockedByOtherExecution
              ? `${blockedByOtherExecution.title} · ${blockedByOtherExecution.activity}`
              : `${workspace.mode === "live" ? "DeepSeek 实时协作" : "本地演示模式"} · 对话负责交流，工作台负责执行`}
          </span>
        </div>
        <span
          className={`chat-execution-state${anAgentIsWorking ? " running" : ""}`}
          role="status"
          aria-label={
            anAgentIsWorking
              ? questionBusy
                ? "对话 Agent 正在回应"
                : "工作台 Agent 正在运行"
              : workspace.result
                ? "工作台 Agent 已完成当前工作"
                : "双 Agent 已就绪"
          }
        >
          {anAgentIsWorking ? (
            <LoaderCircle size={16} className="chat-spinner" aria-hidden="true" />
          ) : workspace.result ? (
            <Check size={16} aria-hidden="true" />
          ) : null}
          {busy || blockedByOtherExecution ? "运行中" : workspace.result ? "已完成" : "待启动"}
        </span>
      </header>

      {blockedByOtherExecution && (
        <div className="chat-remote-run-notice" role="status" aria-live="polite">
          <LoaderCircle size={16} className="chat-spinner" aria-hidden="true" />
          <span>
            <strong>工作台 Agent 正在推进「{blockedByOtherExecution.title}」</strong>
            <small>
              {blockedByOtherExecution.activity} · 仍可在这里交流；新的工作要求会排队，完成后自动接手。
            </small>
          </span>
        </div>
      )}

      <div
        ref={threadRef}
        className="workspace-chat-thread"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={(event) => {
          const thread = event.currentTarget;
          followLatestRef.current =
            thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
        }}
      >
        {conversation.map((message) => (
          <article
            className={`chat-message ${message.role === "user" ? "chat-user" : "chat-agent"}`}
            data-agent={message.role === "assistant" ? message.agent : undefined}
            key={message.id}
          >
            {message.role === "assistant" && (
              <span className="chat-message-mark" aria-hidden="true">
                <Sparkles size={14} />
              </span>
            )}
            <div className="chat-message-body">
              {message.role === "assistant" && (
                <span className="chat-message-author">
                  {message.agent === "planner"
                    ? "规划 Agent"
                    : message.agent === "dialogue"
                      ? "对话 Agent"
                      : message.agent === "workbench"
                        ? "工作台 Agent"
                        : "Agent"}
                </span>
              )}
              <p>{message.content}</p>
              {message.role === "assistant" &&
                message.toolEvents?.some((event) => event.sources?.length) && (
                  <p className="chat-source-line">
                    <span>参考来源：</span>
                    {[
                      ...new Map(
                        message.toolEvents
                          .flatMap((event) => event.sources || [])
                          .map((source) => [source.url, source] as const),
                      ).values(),
                    ].map((source, index) => (
                      <span key={source.url}>
                        {index > 0 ? " · " : ""}
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          {source.title}
                        </a>
                      </span>
                    ))}
                  </p>
                )}
            </div>
          </article>
        ))}

        {!workspace.result &&
          !busy &&
          !blockedByOtherExecution &&
          workspace.plan.routes.length > 0 && (
            <motion.section
              className="chat-route-picker"
              aria-label="执行路线选择"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 28 }}
            >
              <div className="chat-route-intro">
                <span className="chat-route-branch-icon" aria-hidden="true">
                  <GitBranch size={19} />
                </span>
                <div className="chat-route-intro-copy">
                  <span className="chat-route-kicker">
                    <i aria-hidden="true" /> ROUTE DECISION · {workspace.plan.routes.length} 条路线
                  </span>
                  <h3>选定执行路径</h3>
                  <p>
                    这里是本轮唯一的常规决策。选定后，Agent
                    会连续完成可交付工作；只有真正关键且无法合理推断的选择才会暂停确认。
                  </p>
                </div>
                <div
                  className="chat-route-score"
                  aria-label={`当前路线匹配度 ${selectedRoute.fit}%`}
                >
                  <strong>{selectedRoute.fit}%</strong>
                  <small>匹配度</small>
                </div>
              </div>

              <div className="chat-route-options" role="group" aria-label="选择一条执行路线">
                {workspace.plan.routes.map((item, index) => {
                  const selected = selectedRoute.id === item.id;
                  return (
                    <motion.button
                      type="button"
                      className={`chat-route-option${selected ? " selected" : ""}`}
                      key={item.id}
                      aria-pressed={selected}
                      data-recommended={index === 0 ? "true" : "false"}
                      data-route-id={item.id}
                      disabled={interactionLocked}
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={interactionLocked ? undefined : { y: -3 }}
                      whileTap={interactionLocked ? undefined : { scale: 0.99 }}
                      transition={{
                        type: "spring",
                        stiffness: 430,
                        damping: 34,
                        delay: prefersReducedMotion ? 0 : index * 0.06,
                      }}
                      onClick={() => onSelectRoute(item.id)}
                    >
                      {selected && (
                        <motion.span
                          className="chat-route-selection-indicator"
                          layoutId={`route-highlight-${workspace.id}`}
                          transition={{ type: "spring", stiffness: 480, damping: 38 }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="chat-route-meta">
                        <span>{index === 0 ? "AI 推荐" : `备选 0${index}`}</span>
                        <strong>{item.fit}%</strong>
                      </span>
                      <strong className="chat-route-title">{item.title}</strong>
                      <small>{item.subtitle}</small>
                      <span className="chat-route-fit" aria-hidden="true">
                        <i style={{ width: `${Math.max(0, Math.min(100, item.fit))}%` }} />
                      </span>
                      <span className="chat-route-reason">{item.reason}</span>
                      <span className="chat-route-action">
                        {selected ? (
                          <>
                            <Check size={14} /> 当前执行方向
                          </>
                        ) : (
                          <>
                            切换到这条路线 <ArrowRight size={14} />
                          </>
                        )}
                      </span>
                    </motion.button>
                  );
                })}
              </div>

              {workspace.plan.question && (
                <p className="chat-agent-question">
                  <Sparkles size={14} aria-hidden="true" />
                  <span>关键确认：{workspace.plan.question}</span>
                </p>
              )}
            </motion.section>
          )}

        {savedSearchSources.length > 0 && (
          <p className="chat-source-line chat-saved-search-sources">
            <span>联网搜索来源：</span>
            {savedSearchSources.map((source, index) => (
              <span key={source.url}>
                {index > 0 ? " · " : ""}
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              </span>
            ))}
          </p>
        )}

        {shouldShowPendingExecution && (
          <article className="chat-message chat-user chat-pending-user" aria-label="本轮执行指令">
            <div className="chat-message-body">
              <p>{pendingExecutionContent}</p>
            </div>
          </article>
        )}

        {pendingQuestion && (
          <article className="chat-message chat-user chat-pending-user" aria-label="正在提问">
            <div className="chat-message-body">
              <p>{pendingQuestion}</p>
            </div>
          </article>
        )}

        {questionBusy && (
          <article className="chat-message chat-agent chat-live-response chat-question-live">
            <span className="chat-message-mark" aria-hidden="true">
              <LoaderCircle size={14} className="chat-spinner" />
            </span>
            <div className="chat-message-body">
              <span className="chat-message-author">对话 Agent · 正在理解</span>
              <p className="chat-live-text">
                {questionStreamText || "正在结合你的上下文决定如何回应…"}
              </p>
            </div>
          </article>
        )}

        {busy && streamedText && (
          <article className="chat-message chat-agent chat-live-response">
            <span className="chat-message-mark" aria-hidden="true">
              <LoaderCircle size={14} className="chat-spinner" />
            </span>
            <div className="chat-message-body">
              {streamedText && <p className="chat-live-text">{streamedText}</p>}
            </div>
          </article>
        )}

        {artifacts.length > 0 && (
          <details className="chat-artifact-shelf">
            <summary>
              <span className="chat-artifact-shelf-icon" aria-hidden="true">
                <FileText size={15} />
              </span>
              <strong>生成成果</strong>
              <small>{artifacts.length} 项</small>
              <span className="chat-artifact-shelf-action">查看文件</span>
            </summary>
            <div className="chat-artifacts" aria-label="Agent 生成的成果">
              {artifacts.map((artifact) => (
                <motion.button
                  type="button"
                  className="chat-artifact-card"
                  key={artifact.id}
                  onClick={() => onOpenArtifact(artifact)}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.99 }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                >
                  <span className="chat-artifact-icon">
                    {artifact.type === "code" ? (
                      <FileCode2 size={18} />
                    ) : artifact.type === "spreadsheet" ? (
                      <FileText size={18} />
                    ) : artifact.type === "presentation" ? (
                      <Sparkles size={18} />
                    ) : (
                      <FileText size={18} />
                    )}
                  </span>
                  <span className="chat-artifact-copy">
                    <strong>{artifact.title}</strong>
                    <small>{artifact.description}</small>
                  </span>
                  {artifact.type === "code" ? (
                    <ArrowDownToLine size={17} />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                </motion.button>
              ))}
            </div>
          </details>
        )}
      </div>

      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {questionError && (
        <p className="chat-error chat-question-error" role="alert">
          {questionError}
        </p>
      )}

      <form
        className="workspace-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submitMessage();
        }}
      >
        <label className="sr-only" htmlFor="workspace-chat-input">
          {busy
            ? "与对话 Agent 交流"
            : workspace.result
              ? "与对话 Agent 交流，说明问题或提出工作要求"
              : "补充偏好、提出问题，或开始全程执行"}
        </label>
        <textarea
          id="workspace-chat-input"
          value={draft}
          disabled={readOnly}
          onChange={(event) => onDraftChange(event.target.value)}
          maxLength={busy ? 1600 : 4000}
          rows={3}
          placeholder={
            readOnly
              ? "这是只读共享工作区。你可以查看项目内容与成果，但不能发送消息或修改任务。"
              : busy
              ? "随时问进度或继续安排工作；新的执行要求会自动排队…"
              : workspace.result
                ? "和对话 Agent 继续交流；明确的修改或制作要求会自动交给工作台执行…"
                : "描述你想做的事，也可以先问问题；选定路线后会由工作台 Agent 完整推进…"
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submitMessage();
            }
          }}
        />
        <div className="chat-composer-tools">
          <button
            className={`chat-attach-button chat-voice-button${speechListening ? " is-listening" : ""}`}
            type="button"
            onClick={toggleSpeechInput}
            disabled={interactionLocked}
            title="语音输入由浏览器识别；音频是否发送至浏览器厂商由浏览器决定"
            aria-pressed={speechListening}
          >
            {speechListening ? <MicOff size={17} /> : <Mic size={17} />}
            <span>{speechListening ? "停止语音" : "语音输入"}</span>
          </button>
          <label
            className="chat-attach-button"
            title="视频会在本机抽取最多 6 帧画面；不会发送视频音轨。"
          >
            <Plus size={17} />
            <span>添加文件</span>
            <input
              type="file"
              multiple
              disabled={interactionLocked}
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.mjs,.py,.java,.go,.rs,.sql,.yaml,.yml,.toml,.sh,.log,.docx,.xlsx,.pptx,.pdf"
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files || []);
                if (files.length) onAttachFiles(files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <details className="chat-capabilities">
            <summary title="查看 Agent 支持的工具">
              <Wrench size={14} />
              <span>工具箱</span>
            </summary>
            <div className="chat-capabilities-popover">
              <div className="chat-capabilities-heading">
                <strong>描述目标，Agent 会自动调用工具</strong>
                <span>不用手动选择</span>
              </div>
              <div className="chat-capabilities-grid">
                {agentToolCatalog.map((category) => (
                  <div className="chat-capability-card" key={category.title}>
                    <strong>{category.title}</strong>
                    <span>{category.description}</span>
                    <small>
                      {category.toolNames.map((name) => (
                        <code key={name}>{name}</code>
                      ))}
                    </small>
                  </div>
                ))}
              </div>
              <p className="chat-capabilities-mode">
                {workspace.mode === "live"
                  ? "当前实时模式会按指令调用 DeepSeek；执行进度显示在工作区顶部，搜索来源以文字链接附在回复后。"
                  : "当前为演示模式，使用本地样例；联网搜索和实时生成需切换到实时 AI。"}
              </p>
            </div>
          </details>
          <span>视频仅发送最多 6 帧画面；语音识别由浏览器提供。</span>
          <label className="chat-thinking-control">
            <Sparkles size={14} />
            <span>思考强度</span>
            <select
              aria-label="Agent 思考强度"
              value={thinkingMode}
              onChange={(event) =>
                onThinkingModeChange(event.target.value === "deep" ? "deep" : "fast")
              }
              disabled={interactionLocked}
            >
              <option value="fast">快速</option>
              <option value="deep">深度</option>
            </select>
          </label>
          {attachments.length > 0 && <small>{attachments.length}/6 个附件</small>}
        </div>
        {speechNotice && <small className="chat-speech-notice">{speechNotice}</small>}
        {attachments.length > 0 && (
          <div className="chat-attachment-list" aria-label="待发送附件">
            {attachments.map((attachment) => (
              <div className="chat-attachment-chip" key={attachment.id}>
                {attachment.kind === "image" ? <FileImage size={14} /> : <FileText size={14} />}
                <span title={attachment.name}>{attachment.name}</span>
                <button
                  type="button"
                  disabled={interactionLocked}
                  onClick={() => onRemoveAttachment(attachment.id)}
                  aria-label={`移除附件：${attachment.name}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="workspace-chat-composer-footer">
          <span>
            {readOnly
              ? "共享权限：只读"
              : queuedHandoffCount > 0
              ? `${queuedHandoffCount} 项工作已排队，当前轮完成后自动接手。`
              : busy
                ? "对话 Agent 会回答问题；新的工作要求会在当前轮结束后自动执行。"
                : "对话 Agent 负责交流与判断；需要实际产出时会交给工作台 Agent 连续完成。"}
          </span>
          {busy && !readOnly ? (
            <div className="chat-execution-actions">
              <button
                className="chat-send-button chat-ask-button"
                type="submit"
                disabled={(!draft.trim() && attachments.length === 0) || questionBusy}
              >
                {questionBusy ? (
                  <>
                    <LoaderCircle size={15} className="chat-spinner" /> 交流中…
                  </>
                ) : (
                  <>
                    发送 <ArrowRight size={16} />
                  </>
                )}
              </button>
              <button className="chat-stop-button" type="button" onClick={onStop}>
                <CircleStop size={15} /> 停止任务
              </button>
            </div>
          ) : readOnly ? (
            <button className="chat-send-button" type="button" disabled>
              只读共享
            </button>
          ) : questionBusy ? (
            <button className="chat-send-button" type="button" disabled>
              <LoaderCircle size={15} className="chat-spinner" /> 交流中…
            </button>
          ) : (
            <button
              className="chat-send-button"
              type="submit"
              disabled={workspace.result !== null && !draft.trim() && attachments.length === 0}
            >
              {!draft.trim() && attachments.length === 0 && !workspace.result
                ? "开始全程执行"
                : "发送给 Agent"}{" "}
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
