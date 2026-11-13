"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  Clock3,
  Compass,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Save,
  Share2,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import {
  combineAiUsage,
  demoFollowUp,
  sortMilestonesChronologically,
  type Artifact,
  type AiRunUsage,
  type ChatAttachment,
  type ConversationMessage,
  type ExecutionResult,
  type GoalPlan,
  type SearchSource,
  type Workspace,
} from "@/lib/goal";
import KnowledgeView from "@/components/KnowledgeView";
import AccountView from "@/components/AccountView";
import ProjectFlowPanel from "@/components/ProjectFlowPanel";
import WorkspaceChat from "@/components/WorkspaceChat";
import ArtifactPreview from "@/components/ArtifactPreview";
import ConfirmDialog, { type ConfirmRequest } from "@/components/ConfirmDialog";
import { clientSession } from "@/lib/client-session";
import { isSupportedImageDataUrl, MAX_IMAGE_BYTES } from "@/lib/image";
import { createCalendarExport, inspectCalendarSchedule } from "@/lib/calendar-export.mjs";
import { estimateDeepSeekFlashCost, isDeepSeekFlashModel } from "@/lib/deepseek-cost-estimate.mjs";
import { DEFAULT_THINKING_MODE } from "@/lib/thinking-mode.mjs";
import { createProjectZip } from "@/lib/project-zip";
import { isSupportedChatTextFile, readChatDocument } from "@/lib/attachment-reader";
import { createArtifactDownload } from "@/lib/artifact-export";
import { createVideoContactSheet, isVideoFile } from "@/lib/video-contact-sheet";

const SIDEBAR_COLLAPSED_PREFERENCE_KEY = "nexora:sidebar-collapsed:v1";
const SIDEBAR_PREFERENCE_EVENT = "nexora:sidebar-preference-change";

function subscribeToSidebarPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SIDEBAR_PREFERENCE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SIDEBAR_PREFERENCE_EVENT, onChange);
  };
}

function getSidebarCollapsedPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerSidebarCollapsedPreference() {
  return false;
}

function setSidebarCollapsedPreference(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY, String(collapsed));
  } catch {
    // Sidebar visibility remains usable when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(SIDEBAR_PREFERENCE_EVENT));
}

type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  createdAt: string;
  recoveryCodeConfigured: boolean;
};
type WorkspaceAccessRole = "owner" | "editor" | "viewer";
type ShareLinkView = {
  id: string;
  role: "editor" | "viewer";
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  useCount: number;
  maxUses: number;
};
type ShareMemberView = { id: string; name: string; email: string; role: "editor" | "viewer" };
type PlanDraftRecovery = {
  userId: string;
  prompt: string;
  image: string;
  imageName: string;
  attachments: ChatAttachment[];
  useDemo: boolean;
};
type View = "home" | "workspace" | "history" | "knowledge" | "admin" | "account";
type AdminData = {
  userCount: number;
  workspaceCount: number;
  completedCount: number;
  aiUsage: {
    requests: number;
    inputTokens: number;
    cachedInputTokens: number;
    cacheMeasuredInputTokens: number;
    cacheMeasuredHitTokens: number;
    outputTokens: number;
    totalTokens: number;
    flashInputTokens: number;
    flashOutputTokens: number;
    flashCacheMeasuredInputTokens: number;
    flashCacheMeasuredHitTokens: number;
    averageLatencyMs: number;
    planningRequests: number;
    dialogueRequests: number;
    workbenchRequests: number;
    healthcheckRequests: number;
    legacyRequests: number;
  };
  dailyAiUsage: {
    date: string;
    label: string;
    requests: number;
    inputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    cacheMeasuredInputTokens: number;
    cacheMeasuredHitTokens: number;
    latencyMs: number;
    planningRequests: number;
    dialogueRequests: number;
    workbenchRequests: number;
    healthcheckRequests: number;
    legacyRequests: number;
  }[];
  users: { id: string; name: string; email: string; role: string; created_at: string }[];
  workspaces: {
    id: string;
    title: string;
    category: string;
    owner: string;
    updated_at: string;
    aiRequests: number;
    aiTokens: number;
    plannerTokens: number;
    dialogueTokens: number;
    workbenchTokens: number;
    legacyTokens: number;
    flashInputTokens: number;
    flashOutputTokens: number;
    flashCacheMeasuredInputTokens: number;
    flashCacheMeasuredHitTokens: number;
  }[];
};
type AiHealth =
  | { state: "idle" | "checking"; message: string }
  | { state: "connected"; message: string; model: string; latencyMs: number }
  | { state: "error"; message: string };
function formatEstimatedUsd(value: number) {
  const digits = value < 0.01 ? 5 : value < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
function getInputCacheCoverage(inputTokens: number, measuredInputTokens: number) {
  const total = Number.isFinite(inputTokens) ? Math.max(0, Math.floor(inputTokens)) : 0;
  const reported = Number.isFinite(measuredInputTokens)
    ? Math.max(0, Math.floor(measuredInputTokens))
    : 0;
  const measured = Math.min(total, reported);
  const percent = total > 0 ? (measured / total) * 100 : 0;
  return {
    measured,
    total,
    percent,
    label: `缓存统计覆盖 ${percent.toFixed(1)}%`,
    title: `供应商提供缓存字段的输入 Token：${measured.toLocaleString("zh-CN")} / ${total.toLocaleString("zh-CN")}。命中率只在这部分已统计输入中计算。`,
  };
}
const examples = [
  {
    tag: "活动策划",
    title: "策划一场社团招新",
    text: "帮我在两周内策划一场校园 AI 社团招新活动，预算 3000 元，预计 80 人参加。",
    icon: Sparkles,
  },
  {
    tag: "日程安排",
    title: "重新安排这一周",
    text: "我这周要准备考试、完成课程作业，还想保持每天运动，请帮我安排时间。",
    icon: Clock3,
  },
  {
    tag: "项目推进",
    title: "推进一个 Web 项目",
    text: "我们三个人要在一周内完成一个 AI Web 作品，请拆解项目阶段和任务。",
    icon: FolderKanban,
  },
];
async function api<T>(url: string, options?: RequestInit, sessionBound = false): Promise<T> {
  const requestEpoch = clientSession.epoch;
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (
    response.status === 401 &&
    sessionBound &&
    requestEpoch === clientSession.epoch &&
    typeof window !== "undefined"
  ) {
    window.dispatchEvent(
      new CustomEvent("nexora:session-expired", { detail: { epoch: requestEpoch } }),
    );
  }
  if (!response.ok) throw new ApiError(data.error || "请求失败", response.status);
  return data as T;
}
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
type ExecutionProgressEvent =
  | { type: "status"; message: string }
  | { type: "tool-start"; id: string; name: string; title: string; detail: string }
  | {
      type: "tool";
      id?: string;
      name?: string;
      status?: "done" | "error";
      title: string;
      detail: string;
      sources?: SearchSource[];
    }
  | { type: "text"; text: string }
  | {
      type: "handoff";
      handoffId: string;
      instruction: string;
      userMessageId: string;
      userMessage: string;
      acknowledgment: string;
      queued: boolean;
    };

type DialogDispatchResult =
  | { kind: "reply"; answer: string }
  | {
      kind: "handoff";
      handoffId: string;
      instruction: string;
      userMessageId: string;
      userMessage: string;
      acknowledgment: string;
      queued: boolean;
    };

type QueuedWorkbenchHandoff = {
  id: string;
  workspaceId: string;
  workspaceTitle: string;
  instruction: string;
  userMessageId: string;
  userMessage: string;
  attachments: ChatAttachment[];
  createdAt: string;
};
type QueuedWorkbenchHandoffRef = Pick<QueuedWorkbenchHandoff, "id" | "workspaceId">;

type ActiveExecution = {
  workspaceId: string;
  workspaceTitle: string;
  state: "running" | "completed" | "failed";
  activity: string;
  message?: string;
  completedToolCalls?: number;
  cancelRequested?: boolean;
  startedAt?: string;
  updatedAt?: string;
};

function safeSearchSources(value: unknown): SearchSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Record<string, unknown>;
      if (
        typeof source.title !== "string" ||
        typeof source.url !== "string" ||
        typeof source.snippet !== "string"
      )
        return [];
      try {
        const url = new URL(source.url);
        if (url.protocol !== "https:" && url.protocol !== "http:") return [];
      } catch {
        return [];
      }
      return [
        {
          title: source.title.slice(0, 300),
          url: source.url,
          snippet: source.snippet.slice(0, 1200),
        },
      ];
    })
    .slice(0, 5);
}
async function streamApi<T>(
  url: string,
  options: RequestInit,
  onEvent: (event: ExecutionProgressEvent) => void,
  sessionBound = false,
): Promise<T> {
  const requestEpoch = clientSession.epoch;
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const dispatchSessionExpired = () => {
    if (
      response.status === 401 &&
      sessionBound &&
      requestEpoch === clientSession.epoch &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(
        new CustomEvent("nexora:session-expired", { detail: { epoch: requestEpoch } }),
      );
    }
  };
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    dispatchSessionExpired();
    throw new ApiError(data.error || "请求失败", response.status);
  }
  const contentType = response.headers.get("Content-Type") || "";
  const isEventStream = contentType.includes("text/event-stream");
  const isNdjson = contentType.includes("application/x-ndjson");
  if (!isEventStream && !isNdjson) {
    return (await response.json()) as T;
  }
  if (!response.body) throw new Error("Agent 流连接已关闭，请重试。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  const consumeData = (data: string) => {
    const trimmed = data.trim();
    if (!trimmed) return;
    const event = JSON.parse(trimmed) as Record<string, unknown>;
    if (event.type === "error") throw new Error(String(event.error || "Agent 执行失败"));
    if (event.type === "result") {
      result = event.data as T;
      return;
    }
    if (event.type === "status" && typeof event.message === "string") {
      onEvent({ type: "status", message: event.message });
    } else if (
      event.type === "tool" &&
      typeof event.title === "string" &&
      typeof event.detail === "string"
    ) {
      onEvent({
        type: "tool",
        ...(typeof event.id === "string" ? { id: event.id } : {}),
        ...(typeof event.name === "string" ? { name: event.name } : {}),
        status: event.status === "error" ? "error" : "done",
        title: event.title,
        detail: event.detail,
        ...(Array.isArray(event.sources) ? { sources: safeSearchSources(event.sources) } : {}),
      });
    } else if (
      event.type === "tool-start" &&
      typeof event.id === "string" &&
      typeof event.name === "string" &&
      typeof event.title === "string" &&
      typeof event.detail === "string"
    ) {
      onEvent({
        type: "tool-start",
        id: event.id,
        name: event.name,
        title: event.title,
        detail: event.detail,
      });
    } else if (event.type === "text" && typeof event.text === "string") {
      onEvent({ type: "text", text: event.text });
    } else if (
      event.type === "handoff" &&
      typeof event.handoffId === "string" &&
      typeof event.instruction === "string" &&
      typeof event.userMessageId === "string" &&
      typeof event.userMessage === "string" &&
      typeof event.acknowledgment === "string"
    ) {
      onEvent({
        type: "handoff",
        handoffId: event.handoffId,
        instruction: event.instruction,
        userMessageId: event.userMessageId,
        userMessage: event.userMessage,
        acknowledgment: event.acknowledgment,
        queued: event.queued === true,
      });
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (isEventStream) {
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) consumeData(data);
        }
      } else {
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) consumeData(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      if (isEventStream) {
        const data = buffer
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) consumeData(data);
      } else {
        consumeData(buffer);
      }
    }
  } catch (cause) {
    await reader.cancel(cause).catch(() => undefined);
    throw cause;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A failed read or cancellation can already have released the stream lock.
    }
  }
  if (result === undefined) throw new Error("Agent 执行没有返回工作结果，请重试。");
  return result;
}
const shortDate = (date: string) =>
  new Date(date).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      className={`brand-mark${compact ? " brand-mark-compact" : ""}`}
      viewBox="0 0 64 64"
      role="img"
      aria-label={compact ? undefined : "VHFXNEX 标志"}
      aria-hidden={compact ? true : undefined}
    >
      <rect x="2" y="2" width="60" height="60" rx="18" fill="#171621" stroke="#ffffff16" />
      <path
        d="M17 45V19l30 26V19"
        fill="none"
        stroke="#cbb2f3"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18 45 46 19" fill="none" stroke="#d8eeab" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="17" cy="19" r="3.2" fill="#e9dcff" />
      <circle cx="47" cy="45" r="3.2" fill="#d8eeab" />
    </svg>
  );
}

function Brand() {
  return (
    <div className="brand">
      <BrandMark />
      <span className="brand-name">
        <span>
          VHFX<b>NEX</b>
        </span>
        <small>GOAL → ACTION</small>
      </span>
    </div>
  );
}

function AuthScreen({
  onSuccess,
  initialMode,
  initialError,
}: {
  onSuccess: (user: User) => void;
  initialMode: "register" | "login";
  initialError: string;
}) {
  const [mode, setMode] = useState<"register" | "login" | "recover">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState("");
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const recoveryDialogRef = useRef<HTMLElement | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!pendingRecoveryCode) return;
    const dialog = recoveryDialogRef.current;
    const focusableSelector =
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';
    dialog?.querySelectorAll<HTMLElement>(focusableSelector)[0]?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialog?.querySelectorAll<HTMLElement>(focusableSelector);
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [pendingRecoveryCode]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if ((mode === "register" || mode === "recover") && password !== confirmPassword) {
      setError("两次输入的密码不一致，请检查后重试。");
      return;
    }
    if (mode === "recover" && recoveryCode.trim().length < 32) {
      setError("请输入账户恢复码。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api<{ user: User; recoveryCode?: string }>(
        `/api/auth/${mode === "recover" ? "recover" : mode}`,
        {
          method: "POST",
          body: JSON.stringify(
            mode === "recover"
              ? { email, recoveryCode, newPassword: password }
              : { name, email, password },
          ),
        },
      );
      if (mode === "register" || mode === "recover") {
        if (!data.recoveryCode) throw new Error("账户恢复码暂时无法生成，请稍后重试。");
        setPendingUser(data.user);
        setPendingRecoveryCode(data.recoveryCode);
        setRecoverySaved(false);
        setRecoveryCopied(false);
        setRecoveryMessage("");
      } else onSuccess(data.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请求失败");
    } finally {
      setBusy(false);
    }
  }
  async function copyRecoveryCode() {
    try {
      await navigator.clipboard.writeText(pendingRecoveryCode);
      setRecoveryCopied(true);
      setRecoverySaved(true);
    } catch {
      setRecoveryMessage("浏览器未开放剪贴板，请下载恢复码文件保存。");
    }
  }
  function downloadRecoveryCode() {
    const blob = new Blob(
      [
        `VHFXNEX 账户恢复码\n\n邮箱：${pendingUser?.email || ""}\n恢复码：${pendingRecoveryCode}\n\n请保存在安全位置。此恢复码只显示一次。`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vhfxnex-account-recovery.txt";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setRecoverySaved(true);
  }
  function enterWorkspace() {
    if (!pendingUser || !recoverySaved) return;
    onSuccess({ ...pendingUser, recoveryCodeConfigured: true });
    setPendingUser(null);
    setPendingRecoveryCode("");
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-grid" />
        <div className="auth-halo" />
        <div className="auth-top">
          <Brand />
          <span>YOUR IDEAS, IN MOTION.</span>
        </div>
        <div className="auth-story-body">
          <p className="eyebrow">
            <span className="pulse" /> 目标驱动的 AI 执行空间
          </p>
          <h1>
            想法很多。
            <br />
            <em>让它真正发生。</em>
          </h1>
          <p>说出你的目标，Agent 规划路线、调用工具并持续推进。你始终掌握关键选择。</p>
          <div className="auth-flow">
            <span>01 提出目标</span>
            <b /> <span>02 选择路线</span>
            <b /> <span>03 持续执行</span>
          </div>
        </div>
        <div className="auth-story-bottom">
          <span>01 / 03</span>
          <span>从一句话，抵达下一步。</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="auth-card">
          <div className="auth-switch">
            <button
              className={mode === "register" ? "active" : ""}
              aria-pressed={mode === "register"}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              创建账户
            </button>
            <button
              className={mode === "login" || mode === "recover" ? "active" : ""}
              aria-pressed={mode === "login" || mode === "recover"}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              登录账户
            </button>
          </div>
          <div className="auth-glyph">
            <ShieldCheck size={24} />
          </div>
          <h2>
            {mode === "register"
              ? "开启你的执行空间"
              : mode === "recover"
                ? "用恢复码找回账户"
                : "欢迎回来"}
          </h2>
          <p>
            {mode === "register"
              ? "一个目标，开启一段可持续推进的旅程。"
              : mode === "recover"
                ? "验证邮箱和一次性恢复码，重设密码后继续。"
                : "继续推进你已经开始的目标。"}
          </p>
          <form onSubmit={submit}>
            {mode === "register" && (
              <label>
                你的称呼
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  minLength={2}
                  maxLength={48}
                  autoComplete="name"
                  placeholder="例如：星云"
                  required
                />
              </label>
            )}
            <label>
              电子邮箱
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                maxLength={254}
                placeholder="you@example.com"
                required
              />
            </label>
            {mode === "recover" && (
              <label>
                账户恢复码
                <input
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  autoComplete="one-time-code"
                  minLength={32}
                  maxLength={128}
                  placeholder="粘贴注册时保存的恢复码"
                  required
                />
              </label>
            )}
            <label htmlFor="auth-password">
              {mode === "recover" ? "设置新密码" : mode === "register" ? "设置密码" : "密码"}
            </label>
            <div className="password-field">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={8}
                maxLength={128}
                placeholder="至少 8 位字符"
                required
              />
              <button
                type="button"
                className="password-visibility"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {(mode === "register" || mode === "recover") && (
              <>
                <label htmlFor="auth-confirm-password">确认密码</label>
                <div className="password-field">
                  <input
                    id="auth-confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    placeholder="再输入一次密码"
                    required
                  />
                  <button
                    type="button"
                    className="password-visibility"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </>
            )}
            {error && (
              <div className="form-error" role="alert" aria-live="polite">
                {error}
              </div>
            )}
            <button className="button-primary auth-submit" disabled={busy}>
              {busy
                ? "正在处理…"
                : mode === "register"
                  ? "创建空间"
                  : mode === "recover"
                    ? "重设密码并进入"
                    : "进入空间"}
              <ArrowRight size={18} />
            </button>
          </form>
          {mode === "login" && (
            <button
              className="auth-recovery-link"
              type="button"
              onClick={() => {
                setMode("recover");
                setError("");
              }}
            >
              忘记密码？使用账户恢复码找回
            </button>
          )}
          {mode === "recover" && (
            <button
              className="auth-recovery-link"
              type="button"
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              返回登录
            </button>
          )}
          <p className="auth-privacy">
            <ShieldCheck size={15} /> 你的工作空间仅在登录后可访问
          </p>
        </div>
        <div className="auth-panel-foot">
          VHFXNEX © 2026 <span>AI WEB CHALLENGE EDITION</span>
        </div>
      </section>
      <AnimatePresence>
        {pendingRecoveryCode && pendingUser && (
          <motion.div
            className="recovery-save-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.section
              className="recovery-save-dialog"
              ref={recoveryDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="recovery-save-title"
              tabIndex={-1}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.99 }}
            >
              <span className="account-card-icon">
                <ShieldCheck size={20} />
              </span>
              <p className="step-label">SAVE THIS ONCE</p>
              <h2 id="recovery-save-title">先保存账户恢复码</h2>
              <p>没有邮件找回功能。请把恢复码保存到安全位置；离开此窗口后不会再次显示。</p>
              <code className="recovery-code-value">{pendingRecoveryCode}</code>
              <div className="recovery-save-actions">
                <button className="button-outline" type="button" onClick={copyRecoveryCode}>
                  <Copy size={16} /> {recoveryCopied ? "已复制" : "复制恢复码"}
                </button>
                <button className="button-outline" type="button" onClick={downloadRecoveryCode}>
                  <Download size={16} /> 下载文件
                </button>
              </div>
              {recoveryMessage && (
                <p className="recovery-copy-error" role="status" aria-live="polite">
                  {recoveryMessage}
                </p>
              )}
              <label className="recovery-saved-check">
                <input
                  type="checkbox"
                  checked={recoverySaved}
                  onChange={(event) => setRecoverySaved(event.target.checked)}
                />
                我已将恢复码保存在安全位置
              </label>
              <button
                className="button-primary recovery-continue"
                type="button"
                disabled={!recoverySaved}
                onClick={enterWorkspace}
              >
                进入我的空间 <ArrowRight size={17} />
              </button>
              <span className="sr-only" role="status" aria-live="polite">
                {recoveryCopied ? "账户恢复码已复制" : ""}
              </span>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

export default function Home() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("home");
  const [mobileNav, setMobileNav] = useState(false);
  const desktopSidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarPreference,
    getSidebarCollapsedPreference,
    getServerSidebarCollapsedPreference,
  );
  const [workspaceSidebarExpanded, setWorkspaceSidebarExpanded] = useState(false);
  const sidebarCollapsed =
    view === "workspace" ? !workspaceSidebarExpanded : desktopSidebarCollapsed;
  const mobileNavRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const desktopSidebarCollapseButtonRef = useRef<HTMLButtonElement>(null);
  const desktopSidebarExpandButtonRef = useRef<HTMLButtonElement>(null);
  const [prompt, setPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [chatAttachmentStore, setChatAttachmentStore] = useState<Record<string, ChatAttachment[]>>(
    {},
  );
  const [busy, setBusy] = useState<"analyze" | "execute" | null>(null);
  const [activeExecution, setActiveExecution] = useState<ActiveExecution | null>(null);
  const [serverExecution, setServerExecution] = useState<ActiveExecution | null>(null);
  const activeExecutionStartedAt = Date.parse(activeExecution?.startedAt || "");
  const serverExecutionStartedAt = Date.parse(serverExecution?.startedAt || "");
  const serverExecutionMatchesActiveRun = Boolean(
    activeExecution &&
    serverExecution &&
    activeExecution.workspaceId === serverExecution.workspaceId &&
    Number.isFinite(activeExecutionStartedAt) &&
    Number.isFinite(serverExecutionStartedAt) &&
    serverExecutionStartedAt >= activeExecutionStartedAt - 1_000,
  );
  const visibleExecution = serverExecutionMatchesActiveRun
    ? serverExecution
    : serverExecution?.state === "running" &&
        activeExecution?.workspaceId !== serverExecution.workspaceId
      ? serverExecution
      : activeExecution || serverExecution;
  const [completedToolCalls, setCompletedToolCalls] = useState(0);
  const [executionStreamText, setExecutionStreamText] = useState("");
  const [questionBusy, setQuestionBusy] = useState(false);
  const [questionWorkspaceId, setQuestionWorkspaceId] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [questionStreamText, setQuestionStreamText] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [queuedHandoffCount, setQueuedHandoffCount] = useState(0);
  const [pendingExecutionContent, setPendingExecutionContent] = useState("");
  const [thinkingMode, setThinkingMode] = useState<"fast" | "deep">(DEFAULT_THINKING_MODE);
  const [pendingSave, setPendingSave] = useState<Workspace | null>(null);
  const [retryingSave, setRetryingSave] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [image, setImage] = useState("");
  const [imageName, setImageName] = useState("");
  const [planAttachments, setPlanAttachments] = useState<ChatAttachment[]>([]);
  const [useDemo, setUseDemo] = useState(true);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [history, setHistory] = useState<Workspace[]>([]);
  const [workspaceAccessById, setWorkspaceAccessById] = useState<
    Record<string, WorkspaceAccessRole>
  >({});
  const [historyStatus, setHistoryStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [workspaceExportNotice, setWorkspaceExportNotice] = useState("");
  const [sharingOpen, setSharingOpen] = useState(false);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [sharingSaving, setSharingSaving] = useState(false);
  const [sharingError, setSharingError] = useState("");
  const [shareRole, setShareRole] = useState<"editor" | "viewer">("editor");
  const [shareExpiryDays, setShareExpiryDays] = useState<1 | 7 | 30>(7);
  const [shareLinks, setShareLinks] = useState<ShareLinkView[]>([]);
  const [shareMembers, setShareMembers] = useState<ShareMemberView[]>([]);
  const [newShareUrl, setNewShareUrl] = useState("");
  const [shareCopyNotice, setShareCopyNotice] = useState("");
  const [calendarAnchorOpen, setCalendarAnchorOpen] = useState(false);
  const [calendarAnchorDate, setCalendarAnchorDate] = useState("");
  const [calendarDialogError, setCalendarDialogError] = useState("");
  const [calendarExportStatus, setCalendarExportStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [artifactDraft, setArtifactDraft] = useState("");
  const [editingArtifact, setEditingArtifact] = useState(false);
  const [savingArtifact, setSavingArtifact] = useState(false);
  const [artifactError, setArtifactError] = useState("");
  const [artifactActionStatus, setArtifactActionStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [admin, setAdmin] = useState<AdminData | null>(null);
  const [aiHealth, setAiHealth] = useState<AiHealth>({
    state: "idle",
    message: "尚未进行连接检查",
  });
  const [confirmation, setConfirmation] = useState<ConfirmRequest | null>(null);
  const saveQueuesRef = useRef(new Map<string, Promise<void>>());
  const deletingWorkspaceIdsRef = useRef(new Set<string>());
  const agentRequestControllerRef = useRef<AbortController | null>(null);
  const liveExecutionWorkspaceIdRef = useRef<string | null>(null);
  const questionRequestControllerRef = useRef<AbortController | null>(null);
  const questionRequestActiveRef = useRef(false);
  const queuedHandoffsRef = useRef<QueuedWorkbenchHandoffRef[]>([]);
  const queuedHandoffRunnerRef = useRef(false);
  const queuedHandoffRetryRef = useRef<number | null>(null);
  const activeHandoffClaimRef = useRef<{ id: string; token: string } | null>(null);
  const runNextQueuedHandoffRef = useRef<() => void>(() => {});
  const completedToolCallIdsRef = useRef(new Set<string>());
  const activeWorkspaceIdRef = useRef<string | null>(null);
  const pendingSaveRecoveryRef = useRef<{ workspace: Workspace; userId: string } | null>(null);
  const expiredSaveRecoveryRef = useRef<{ workspace: Workspace; userId: string } | null>(null);
  const planDraftRecoveryRef = useRef<PlanDraftRecovery | null>(null);
  const expiredPlanDraftRecoveryRef = useRef<PlanDraftRecovery | null>(null);
  const artifactDialogRef = useRef<HTMLDivElement>(null);
  const calendarDialogRef = useRef<HTMLDivElement>(null);
  const calendarAnchorInputRef = useRef<HTMLInputElement>(null);
  const closeConfirmation = useCallback(() => setConfirmation(null), []);
  const artifactReturnFocusRef = useRef<HTMLElement | null>(null);
  const calendarReturnFocusRef = useRef<HTMLElement | null>(null);
  function setActiveWorkspace(next: Workspace | null) {
    activeWorkspaceIdRef.current = next?.id ?? null;
    setWorkspace(next);
  }
  function openWorkspace(next: Workspace, accessRole = workspaceAccessById[next.id] || "owner") {
    setWorkspaceAccessById((current) => ({
      ...current,
      [next.id]: accessRole,
    }));
    setActiveWorkspace(next);
    setInstruction("");
    setActiveExecution((current) =>
      current?.workspaceId === next.id && current.state === "completed" ? null : current,
    );
    navigate("workspace");
  }
  const activeWorkspaceAccess: WorkspaceAccessRole = workspace
    ? workspaceAccessById[workspace.id] || "owner"
    : "owner";
  const chatAttachments = workspace ? chatAttachmentStore[workspace.id] || [] : [];
  function setChatAttachments(
    update: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[]),
  ) {
    if (!workspace) return;
    const workspaceId = workspace.id;
    setChatAttachmentStore((current) => {
      const next = typeof update === "function" ? update(current[workspaceId] || []) : update;
      if (!next.length) {
        const rest = { ...current };
        delete rest[workspaceId];
        return rest;
      }
      return { ...current, [workspaceId]: next };
    });
  }
  const artifactId = artifact?.id;
  const stopAgentRequest = useCallback(async () => {
    const liveWorkspaceId = liveExecutionWorkspaceIdRef.current;
    const visibleRunningWorkspaceId =
      visibleExecution?.state === "running" ? visibleExecution.workspaceId : null;
    const canCancelServerExecution = Boolean(
      visibleRunningWorkspaceId &&
      (liveWorkspaceId === visibleRunningWorkspaceId ||
        (serverExecution?.state === "running" &&
          serverExecution.workspaceId === visibleRunningWorkspaceId)),
    );
    if (canCancelServerExecution && visibleRunningWorkspaceId) {
      try {
        const result = await api<{ cancelled: boolean }>(
          "/api/executions",
          { method: "POST", body: JSON.stringify({ workspaceId: visibleRunningWorkspaceId }) },
          true,
        );
        if (result.cancelled) {
          setActiveExecution((current) =>
            current?.workspaceId === visibleRunningWorkspaceId
              ? { ...current, activity: "正在停止任务…", cancelRequested: true }
              : current,
          );
        } else {
          setError("这轮执行已经结束，无需停止。");
        }
      } catch (cause) {
        setError(
          cause instanceof Error ? `停止请求未发送：${cause.message}` : "停止请求未发送，请重试。",
        );
      }
      return;
    }
    const claim = activeHandoffClaimRef.current;
    if (claim)
      void api("/api/handoffs", {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel", id: claim.id, token: claim.token }),
      }).catch(() => {});
    agentRequestControllerRef.current?.abort();
  }, [
    serverExecution?.state,
    serverExecution?.workspaceId,
    visibleExecution?.state,
    visibleExecution?.workspaceId,
  ]);
  const loadHistory = useCallback(async () => {
    const requestEpoch = clientSession.epoch;
    setHistoryStatus("loading");
    try {
      const data = await api<{
        workspaces: Workspace[];
        accessByWorkspaceId?: Record<string, WorkspaceAccessRole>;
      }>("/api/workspaces", undefined, true);
      if (requestEpoch === clientSession.epoch) {
        setHistory(data.workspaces);
        setWorkspaceAccessById(data.accessByWorkspaceId || {});
        setHistoryStatus("ready");
        try {
          const queued = await api<{ handoffs: QueuedWorkbenchHandoff[] }>(
            "/api/handoffs",
            undefined,
            true,
          );
          if (requestEpoch !== clientSession.epoch) return;
          queuedHandoffsRef.current = queued.handoffs;
          setQueuedHandoffCount(queued.handoffs.length);
          if (queued.handoffs.length) scheduleQueuedHandoffRetry(0);
        } catch {
          // The saved workspaces remain available if queue recovery is temporarily unavailable.
        }
      }
    } catch (cause) {
      if (requestEpoch === clientSession.epoch) {
        setHistoryStatus("error");
        setError(
          cause instanceof Error
            ? `目标列表加载失败：${cause.message}`
            : "目标列表加载失败，请重试。",
        );
      }
    }
  }, []);
  const clearPrivateSessionState = useCallback(() => {
    const activeAgentRequest = agentRequestControllerRef.current;
    agentRequestControllerRef.current = null;
    activeAgentRequest?.abort();
    questionRequestControllerRef.current?.abort();
    questionRequestControllerRef.current = null;
    questionRequestActiveRef.current = false;
    queuedHandoffsRef.current = [];
    queuedHandoffRunnerRef.current = false;
    activeHandoffClaimRef.current = null;
    if (queuedHandoffRetryRef.current !== null) {
      window.clearTimeout(queuedHandoffRetryRef.current);
      queuedHandoffRetryRef.current = null;
    }
    clientSession.epoch += 1;
    queryClient.clear();
    setActiveWorkspace(null);
    setHistory([]);
    setWorkspaceAccessById({});
    setHistoryStatus("idle");
    setAdmin(null);
    setSharingOpen(false);
    setShareLinks([]);
    setShareMembers([]);
    setNewShareUrl("");
    setAiHealth({ state: "idle", message: "尚未进行连接检查" });
    setPrompt("");
    setInstruction("");
    setChatAttachmentStore({});
    setImage("");
    setImageName("");
    setPlanAttachments([]);
    setUseDemo(false);
    setArtifact(null);
    setArtifactDraft("");
    setEditingArtifact(false);
    setSavingArtifact(false);
    setArtifactError("");
    setArtifactActionStatus(null);
    setCalendarAnchorOpen(false);
    setCalendarAnchorDate("");
    setCalendarDialogError("");
    setCalendarExportStatus(null);
    setBusy(null);
    setActiveExecution(null);
    setServerExecution(null);
    setCompletedToolCalls(0);
    setQuestionBusy(false);
    setQuestionWorkspaceId(null);
    setPendingQuestion("");
    setQuestionStreamText("");
    setQuestionError("");
    setQueuedHandoffCount(0);
    setPendingExecutionContent("");
    completedToolCallIdsRef.current.clear();
    setPendingSave(null);
    setRetryingSave(false);
    pendingSaveRecoveryRef.current = null;
    planDraftRecoveryRef.current = null;
    saveQueuesRef.current.clear();
    deletingWorkspaceIdsRef.current.clear();
    setSavingTaskId(null);
    setMobileNav(false);
    setView("home");
  }, [queryClient]);
  useEffect(
    () => () => {
      const activeAgentRequest = agentRequestControllerRef.current;
      agentRequestControllerRef.current = null;
      activeAgentRequest?.abort();
      if (queuedHandoffRetryRef.current !== null)
        window.clearTimeout(queuedHandoffRetryRef.current);
    },
    [],
  );
  useEffect(() => {
    api<{ user: User | null; aiConfigured: boolean }>("/api/auth/me")
      .then((data) => {
        setUser(data.user);
        setAiConfigured(data.aiConfigured);
        setUseDemo(!data.aiConfigured);
        if (data.user) loadHistory();
      })
      .catch(() => setError("暂时无法连接服务。请检查网络后重试登录，已有数据不会因此删除。"))
      .finally(() => setLoading(false));
  }, [loadHistory]);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const refreshExecutionStatus = async () => {
      try {
        const data = await api<{ executions: ActiveExecution[] }>(
          "/api/executions",
          undefined,
          true,
        );
        if (!active) return;
        const running = data.executions.find((execution) => execution.state === "running");
        const recentFailure = data.executions.find(
          (execution) =>
            execution.state === "failed" &&
            Date.now() - Date.parse(execution.updatedAt || "") < 12 * 60 * 60_000,
        );
        setServerExecution((current) => {
          if (running) return running;
          const currentStatus = current
            ? data.executions.find((execution) => execution.workspaceId === current.workspaceId)
            : undefined;
          if (
            currentStatus &&
            Date.now() - Date.parse(currentStatus.updatedAt || "") < 12 * 60 * 60_000
          )
            return currentStatus;
          return recentFailure || null;
        });
      } catch {
        // Keep the last known status visible if a brief poll fails.
      }
    };
    void refreshExecutionStatus();
    const interval = window.setInterval(() => void refreshExecutionStatus(), 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user?.id]);
  const recoveredExecutionSignature = useRef("");
  useEffect(() => {
    if (visibleExecution?.state !== "completed" || !visibleExecution.updatedAt) return;
    const signature = `${visibleExecution.workspaceId}:${visibleExecution.updatedAt}`;
    if (recoveredExecutionSignature.current === signature) return;
    recoveredExecutionSignature.current = signature;
    let active = true;
    api<{ workspace: Workspace }>(
      `/api/workspaces/${visibleExecution.workspaceId}`,
      undefined,
      true,
    )
      .then(({ workspace: saved }) => {
        if (!active) return;
        setHistory((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
        if (activeWorkspaceIdRef.current === saved.id) setActiveWorkspace(saved);
      })
      .catch(() => {
        if (activeWorkspaceIdRef.current === visibleExecution.workspaceId)
          setError("执行已完成，但暂时无法读取最新成果；重新打开工作区即可恢复。 ");
      });
    return () => {
      active = false;
    };
  }, [visibleExecution?.state, visibleExecution?.updatedAt, visibleExecution?.workspaceId]);
  useEffect(() => {
    const resetExpiredSession = (event: Event) => {
      const expiredEpoch = (event as CustomEvent<{ epoch?: number }>).detail?.epoch;
      if (expiredEpoch !== clientSession.epoch) return;
      const recovery = pendingSaveRecoveryRef.current;
      const planDraftRecovery = planDraftRecoveryRef.current;
      expiredSaveRecoveryRef.current = recovery;
      expiredPlanDraftRecoveryRef.current = planDraftRecovery;
      setUser(null);
      clearPrivateSessionState();
      setAuthMode("login");
      setError(
        recovery
          ? "登录状态已过期。使用原账户重新登录后，会恢复并重试刚才尚未完成的工作空间保存。"
          : planDraftRecovery
            ? "登录状态已过期。使用原账户重新登录后，会恢复刚才提交的目标描述、参考图和资料；请检查后再开始规划。"
            : "登录状态已过期，请重新登录后重新加载工作空间。",
      );
    };
    window.addEventListener("nexora:session-expired", resetExpiredSession);
    return () => window.removeEventListener("nexora:session-expired", resetExpiredSession);
  }, [clearPrivateSessionState]);
  useEffect(() => {
    if (!mobileNav) return;
    const menuButton = mobileMenuButtonRef.current;
    mobileCloseButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNav(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      menuButton?.focus();
    };
  }, [mobileNav]);
  useEffect(() => {
    if (artifactId) artifactDialogRef.current?.focus();
    else {
      artifactReturnFocusRef.current?.focus();
      artifactReturnFocusRef.current = null;
    }
  }, [artifactId]);
  useEffect(() => {
    if (!calendarAnchorOpen) {
      calendarReturnFocusRef.current?.focus();
      calendarReturnFocusRef.current = null;
      return;
    }
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    calendarAnchorInputRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setCalendarAnchorOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = calendarDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [calendarAnchorOpen]);
  async function persistWorkspace(next: Workspace, requestEpoch: number) {
    if (requestEpoch !== clientSession.epoch || deletingWorkspaceIdsRef.current.has(next.id))
      return;
    const previous = saveQueuesRef.current.get(next.id);
    const operation = (previous || Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (requestEpoch !== clientSession.epoch || deletingWorkspaceIdsRef.current.has(next.id))
          return;
        await api(
          "/api/workspaces",
          { method: "POST", body: JSON.stringify({ workspace: next }) },
          true,
        );
        if (requestEpoch !== clientSession.epoch) return;
        setPendingSave((current) => (current === next ? null : current));
        if (pendingSaveRecoveryRef.current?.workspace === next) {
          pendingSaveRecoveryRef.current = null;
        }
      });
    saveQueuesRef.current.set(next.id, operation);
    try {
      await operation;
    } finally {
      if (saveQueuesRef.current.get(next.id) === operation) {
        saveQueuesRef.current.delete(next.id);
      }
    }
  }
  async function save(
    next: Workspace,
    requestEpoch = clientSession.epoch,
    preserveCurrentWorkspace = false,
  ) {
    if (requestEpoch !== clientSession.epoch) return;
    if (!preserveCurrentWorkspace || activeWorkspaceIdRef.current === next.id) {
      setActiveWorkspace(next);
    }
    setHistory((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    setPendingSave(next);
    if (user) pendingSaveRecoveryRef.current = { workspace: next, userId: user.id };
    await persistWorkspace(next, requestEpoch);
  }
  async function retrySave() {
    const next = pendingSave;
    const requestEpoch = clientSession.epoch;
    if (!next || retryingSave) return;
    setRetryingSave(true);
    setError("");
    try {
      await persistWorkspace(next, requestEpoch);
    } catch (cause) {
      if (requestEpoch === clientSession.epoch) {
        setError(cause instanceof Error ? cause.message : "保存仍未完成，请稍后重试。");
      }
    } finally {
      if (requestEpoch === clientSession.epoch) setRetryingSave(false);
    }
  }
  function openArtifact(item: Artifact) {
    artifactReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setArtifact(item);
    setArtifactDraft(item.content);
    setEditingArtifact(false);
    setArtifactError("");
    setArtifactActionStatus(null);
  }
  async function refreshSharing(workspaceId: string) {
    setSharingLoading(true);
    setSharingError("");
    try {
      const data = await api<{ links: ShareLinkView[]; members: ShareMemberView[] }>(
        `/api/workspaces/${workspaceId}/sharing`,
        undefined,
        true,
      );
      setShareLinks(data.links);
      setShareMembers(data.members);
    } catch (cause) {
      setSharingError(cause instanceof Error ? cause.message : "共享信息加载失败。");
    } finally {
      setSharingLoading(false);
    }
  }
  function openSharing() {
    if (!workspace || activeWorkspaceAccess !== "owner") return;
    setSharingOpen(true);
    setShareRole("editor");
    setShareExpiryDays(7);
    setNewShareUrl("");
    setShareCopyNotice("");
    void refreshSharing(workspace.id);
  }
  async function createShareLink() {
    if (!workspace || sharingSaving) return;
    setSharingSaving(true);
    setSharingError("");
    setNewShareUrl("");
    try {
      const data = await api<{ inviteUrl: string }>(`/api/workspaces/${workspace.id}/sharing`, {
        method: "POST",
        body: JSON.stringify({ role: shareRole, expiresInDays: shareExpiryDays }),
      });
      setNewShareUrl(data.inviteUrl);
      await refreshSharing(workspace.id);
    } catch (cause) {
      setSharingError(cause instanceof Error ? cause.message : "邀请链接创建失败。");
    } finally {
      setSharingSaving(false);
    }
  }
  async function copyShareLink() {
    if (!newShareUrl) return;
    try {
      await navigator.clipboard.writeText(newShareUrl);
      setShareCopyNotice("邀请链接已复制，可发给团队成员。");
    } catch {
      setShareCopyNotice("浏览器未允许剪贴板访问，请手动复制下方链接。");
    }
  }
  async function updateSharing(action: { memberId: string } | { linkId: string }) {
    if (!workspace) return;
    setSharingSaving(true);
    setSharingError("");
    try {
      await api(`/api/workspaces/${workspace.id}/sharing`, {
        method: "DELETE",
        body: JSON.stringify(action),
      });
      await refreshSharing(workspace.id);
    } catch (cause) {
      setSharingError(cause instanceof Error ? cause.message : "共享权限更新失败。");
    } finally {
      setSharingSaving(false);
    }
  }
  function exportWorkspace() {
    if (!workspace) return;
    const result = workspace.result;
    const progressRecords = (workspace.conversation || [])
      .filter((message) => message.role === "assistant" && message.progress?.length)
      .flatMap((message, index) => [
        `### 对话执行阶段 ${index + 1}`,
        "",
        ...(message.progress || []).map((step, stepIndex) => `${stepIndex + 1}. ${step}`),
        "",
      ]);
    const selectedRoute = workspace.plan.routes.find(
      (route) => route.id === workspace.selectedRouteId,
    );
    const tasks = result?.tasks ?? workspace.plan.tasks;
    const lines = [
      `# ${workspace.plan.title}`,
      "",
      `> 导出时间：${new Date().toLocaleString("zh-CN")}`,
      `> 目标类型：${workspace.plan.category}`,
      `> 工作模式：${workspace.mode === "demo" ? "演示模式" : "实时 AI"}`,
      `> 执行状态：${result ? "已开始执行" : "路线待确认"}`,
      "",
      "## 原始目标",
      "",
      workspace.prompt,
      "",
      "## 目标摘要",
      "",
      workspace.plan.summary,
      "",
      "## 执行路线",
      "",
      ...workspace.plan.routes.flatMap((route) => [
        `### ${route.title}${route.id === selectedRoute?.id ? "（当前选择）" : ""}`,
        "",
        `${route.subtitle} · 匹配度 ${route.fit}%`,
        "",
        route.reason,
        "",
      ]),
      "## 约束与补充问题",
      "",
      ...(workspace.plan.constraints.length
        ? workspace.plan.constraints.map((item) => `- ${item}`)
        : ["- 暂无明确约束"]),
      "",
      workspace.plan.question ? `> 待确认：${workspace.plan.question}` : "",
      "",
      "## 任务清单",
      "",
      ...tasks.map(
        (task, index) =>
          `${index + 1}. [${task.status === "done" ? "x" : " "}] **${task.title}**（${task.phase}）\n   ${task.detail}`,
      ),
      "",
      "## 推进时间线",
      "",
      ...(result?.milestones.length
        ? sortMilestonesChronologically(result.milestones).map(
            (item) => `- **${item.date} · ${item.label}**：${item.note}`,
          )
        : ["- 尚未生成时间线"]),
      "",
      "## 预算",
      "",
      ...(result?.budget
        ? [
            `- 预计总额：¥${result.budget.total.toLocaleString("zh-CN")}`,
            `- 预算上限：${result.budget.limit === null ? "未设置" : `¥${result.budget.limit.toLocaleString("zh-CN")}`}`,
            `- 预算状态：${result.budget.status === "within" ? "范围内" : result.budget.status === "over" ? "超出上限" : "待确认"}`,
            ...(result.budget.remaining === null
              ? []
              : [`- 剩余预算：¥${result.budget.remaining.toLocaleString("zh-CN")}`]),
          ]
        : ["- 尚未核算"]),
      "",
      "## Agent 运行记录",
      "",
      ...(result?.events.length
        ? result.events.map(
            (event, index) => `${index + 1}. **${event.title}**（${event.name}）：${event.detail}`,
          )
        : ["- 尚未开始执行"]),
      "",
      ...progressRecords,
      "",
      "## 模型调用用量",
      "",
      ...(workspace.usage
        ? [
            `- 模型：${workspace.usage.model}`,
            `- Tokens：输入 ${workspace.usage.inputTokens.toLocaleString("zh-CN")}${workspace.usage.cachedInputTokens === undefined ? "" : `（缓存命中 ${workspace.usage.cachedInputTokens.toLocaleString("zh-CN")}）`} · 输出 ${workspace.usage.outputTokens.toLocaleString("zh-CN")} · 合计 ${workspace.usage.totalTokens.toLocaleString("zh-CN")}`,
            `- 请求次数：${workspace.usage.requests} · 累计耗时：${(workspace.usage.latencyMs / 1000).toFixed(1)} 秒`,
          ]
        : ["- 尚无实时模型用量记录；演示模式不会生成虚构用量。"]),
      "",
      "## 生成的产物",
      "",
      ...(result?.artifacts.length
        ? result.artifacts.flatMap((item) => [
            `### ${item.title}`,
            "",
            item.description,
            "",
            item.content,
            "",
          ])
        : ["- 尚未生成产物"]),
      "",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = workspace.plan.title
      .replace(/[<>:\"/\\|?*\u0000-\u001f]/g, "-")
      .trim()
      .slice(0, 64);
    link.href = url;
    link.download = `${safeTitle || "VHFXNEX-目标"}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setWorkspaceExportNotice("完整工作区已导出为 Markdown");
    window.setTimeout(() => setWorkspaceExportNotice(""), 4000);
  }
  function finishCalendarDownload(content: string, eventCount: number) {
    if (!workspace) return;
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = workspace.plan.title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .trim()
      .slice(0, 64);
    link.href = url;
    link.download = `${safeTitle || "VHFXNEX-日程"}.ics`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setCalendarExportStatus({
      kind: "success",
      message: `已导出 ${eventCount} 个日程；日历时间按中国标准时间（UTC+8）生成。`,
    });
    setCalendarDialogError("");
    setCalendarAnchorOpen(false);
  }
  function requestCalendarExport() {
    if (!workspace?.result) return;
    setCalendarExportStatus(null);
    const exported = createCalendarExport(workspace.result.milestones);
    if (!exported.ok && exported.code === "anchor-required") {
      calendarReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setCalendarAnchorDate("");
      setCalendarDialogError("");
      setCalendarAnchorOpen(true);
      return;
    }
    if (!exported.ok) {
      setCalendarExportStatus({ kind: "error", message: exported.message });
      return;
    }
    finishCalendarDownload(exported.content, exported.eventCount);
  }
  function submitCalendarExport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace?.result) return;
    const exported = createCalendarExport(workspace.result.milestones, calendarAnchorDate);
    if (!exported.ok) {
      setCalendarDialogError(exported.message);
      return;
    }
    finishCalendarDownload(exported.content, exported.eventCount);
  }
  function discardArtifactChanges() {
    setArtifact(null);
    setEditingArtifact(false);
    setArtifactError("");
    setArtifactActionStatus(null);
  }
  function closeArtifact() {
    if (editingArtifact && artifactDraft !== artifact?.content) {
      setConfirmation({
        title: "放弃未保存的修改？",
        description: "这份方案的编辑内容还没有保存。关闭后，这些修改会丢失。",
        confirmLabel: "放弃修改并关闭",
        tone: "danger",
        onConfirm: discardArtifactChanges,
      });
      return;
    }
    discardArtifactChanges();
  }
  async function copyArtifact() {
    try {
      const content =
        artifact?.type === "code"
          ? artifact.files?.map((file) => `// ${file.path}\n${file.content}`).join("\n\n") ||
            artifactDraft
          : artifactDraft;
      await navigator.clipboard.writeText(content);
      setArtifactActionStatus({
        kind: "success",
        message:
          artifact?.type === "code" ? "项目源码已复制到剪贴板。" : "方案内容已复制到剪贴板。",
      });
    } catch {
      setArtifactActionStatus({
        kind: "error",
        message: "复制失败。请手动选择方案文本，或下载文件。",
      });
    }
  }
  async function downloadArtifact(format: "primary" | "markdown" = "primary") {
    if (!artifact) return;
    let blob: Blob;
    let extension: string;
    let successMessage = "";
    try {
      if (artifact.type === "code" && format === "primary") {
        if (!artifact.files?.length) throw new Error("这个代码产物缺少源文件。请重新生成项目。");
        const archive = createProjectZip(artifact.files);
        blob = new Blob([archive.buffer as ArrayBuffer], { type: "application/zip" });
        extension = "zip";
        successMessage = "项目 ZIP 已开始下载。解压后按 README.md 的步骤运行。";
      } else {
        const exported = await createArtifactDownload(artifact, artifactDraft, format);
        blob = exported.blob;
        extension = exported.extension;
        successMessage = exported.message;
      }
    } catch (cause) {
      setArtifactActionStatus({
        kind: "error",
        message: cause instanceof Error ? cause.message : "项目打包失败。",
      });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = artifact.title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .trim()
      .slice(0, 64);
    link.href = url;
    link.download = `${safeTitle || "VHFXNEX-产物"}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setArtifactActionStatus({
      kind: "success",
      message: successMessage || "文件下载已开始，请检查浏览器下载栏。",
    });
  }
  function handleArtifactDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeArtifact();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = artifactDialogRef.current?.querySelectorAll<HTMLElement>(
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
      (document.activeElement === first || document.activeElement === artifactDialogRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  async function saveArtifact() {
    if (!artifact || !workspace?.result) return;
    const requestEpoch = clientSession.epoch;
    const updated = { ...artifact, content: artifactDraft.trim() };
    if (!updated.content) {
      setArtifactError("内容不能为空。");
      return;
    }
    setSavingArtifact(true);
    setArtifactError("");
    try {
      const next = {
        ...workspace,
        result: {
          ...workspace.result,
          artifacts: workspace.result.artifacts.map((item) =>
            item.id === updated.id ? updated : item,
          ),
        },
      };
      await save(next, requestEpoch);
      if (requestEpoch !== clientSession.epoch) return;
      setArtifact(updated);
      setArtifactDraft(updated.content);
      setEditingArtifact(false);
      setArtifactActionStatus(null);
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setArtifactError(cause instanceof Error ? cause.message : "方案保存失败");
    } finally {
      if (requestEpoch === clientSession.epoch) setSavingArtifact(false);
    }
  }
  async function analyze(text = prompt) {
    if (agentRequestControllerRef.current) return;
    if (text.trim().length < 6) {
      setError("请再详细描述一下你的目标。");
      return;
    }
    const requestEpoch = clientSession.epoch;
    const submittedImage = image;
    const submittedImageName = imageName;
    const submittedAttachments = planAttachments;
    const submittedDemoMode = useDemo;
    const plannedWorkspaceId = crypto.randomUUID();
    const draftRecovery = user
      ? {
          userId: user.id,
          prompt: text,
          image: submittedImage,
          imageName: submittedImageName,
          attachments: submittedAttachments,
          useDemo: submittedDemoMode,
        }
      : null;
    planDraftRecoveryRef.current = draftRecovery;
    const controller = new AbortController();
    agentRequestControllerRef.current = controller;
    setBusy("analyze");
    setError("");
    try {
      const data = await api<{
        plan: GoalPlan;
        mode: "live" | "demo";
        usage?: AiRunUsage;
        persisted?: boolean;
        workspace?: Workspace;
      }>(
        "/api/plan",
        {
          method: "POST",
          body: JSON.stringify({
            prompt: text,
            image: submittedImage,
            attachments: submittedAttachments,
            demo: submittedDemoMode,
            workspaceId: plannedWorkspaceId,
            thinkingMode,
          }),
          signal: controller.signal,
        },
        true,
      );
      if (planDraftRecoveryRef.current === draftRecovery) planDraftRecoveryRef.current = null;
      if (requestEpoch !== clientSession.epoch) return;
      const next: Workspace = data.workspace || {
        id: plannedWorkspaceId,
        prompt: text,
        plan: data.plan,
        selectedRouteId: data.plan.routes[0].id,
        result: null,
        conversation: [
          {
            id: crypto.randomUUID(),
            role: "user",
            content: [
              text,
              ...(submittedAttachments.length
                ? [`附件：${submittedAttachments.map((item) => item.name).join("、")}`]
                : []),
            ].join("\n"),
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            agent: "planner",
            content: `${data.plan.summary}\n\n我最推荐「${data.plan.routes[0].title}」：${data.plan.routes[0].reason}`,
          },
        ],
        usage: data.usage,
        mode: data.mode,
        createdAt: new Date().toISOString(),
      };
      setImage("");
      setImageName("");
      setPlanAttachments([]);
      setInstruction("");
      setWorkspaceSidebarExpanded(false);
      setView("workspace");
      if (data.persisted && data.workspace) {
        setActiveWorkspace(next);
        setHistory((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      } else {
        await save(next, requestEpoch);
      }
    } catch (cause) {
      if (requestEpoch === clientSession.epoch) {
        if (!controller.signal.aborted && !(cause instanceof ApiError)) {
          try {
            const recovered = await api<{ workspace: Workspace }>(
              `/api/workspaces/${plannedWorkspaceId}`,
              undefined,
              true,
            );
            if (recovered.workspace.prompt === text) {
              const savedWorkspace = recovered.workspace;
              setActiveWorkspace(savedWorkspace);
              setHistory((current) => [
                savedWorkspace,
                ...current.filter((item) => item.id !== savedWorkspace.id),
              ]);
              setImage("");
              setImageName("");
              setPlanAttachments([]);
              setInstruction("");
              setWorkspaceSidebarExpanded(false);
              setView("workspace");
              setError("");
              return;
            }
          } catch {
            // Preserve the original request error if recovery is not available.
          }
        }
        setError(
          controller.signal.aborted
            ? "已停止本次分析。你的目标仍保留在输入框中。"
            : cause instanceof Error
              ? cause.message
              : "分析失败",
        );
      }
    } finally {
      if (planDraftRecoveryRef.current === draftRecovery) planDraftRecoveryRef.current = null;
      if (agentRequestControllerRef.current === controller)
        agentRequestControllerRef.current = null;
      if (requestEpoch === clientSession.epoch) setBusy(null);
    }
  }
  async function attachImage(file?: File) {
    if (!file) return;
    if (isVideoFile(file)) {
      setError("");
      try {
        const contactSheet = await createVideoContactSheet(file);
        if (!isSupportedImageDataUrl(contactSheet)) {
          setError("视频关键帧生成失败，请重试。");
          return;
        }
        setImage(contactSheet);
        setImageName(`${file.name} · 关键帧`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "视频处理失败，请重试。");
      }
      return;
    }
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type) || file.size > MAX_IMAGE_BYTES) {
      setError("请选择 6 MB 以下的 JPG、PNG、GIF 或 WebP 图片。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        if (!isSupportedImageDataUrl(reader.result)) {
          setError("文件内容与图片类型不一致，请换一张图片。");
          return;
        }
        setImage(reader.result);
        setImageName(file.name);
        setError("");
      }
    };
    reader.onerror = () => setError("图片读取失败，请重试。");
    reader.readAsDataURL(file);
  }
  async function attachPlanFiles(files: File[]) {
    setError("");
    if (files.length > 6 - planAttachments.length) {
      setError("一次最多添加 6 个资料文件。");
      return;
    }
    let totalTextBytes = planAttachments.reduce(
      (total, attachment) => total + new TextEncoder().encode(attachment.content).byteLength,
      0,
    );
    const next: ChatAttachment[] = [];
    try {
      for (const file of files) {
        if (!isSupportedChatTextFile(file))
          throw new Error(
            `暂不支持「${file.name}」。可添加 DOCX、XLSX、PPTX、PDF、Markdown、TXT 或代码文件。`,
          );
        const content = await readChatDocument(file);
        totalTextBytes += new TextEncoder().encode(content).byteLength;
        if (totalTextBytes > 200_000) throw new Error("资料文件提取的文字合计不能超过 200 KB。");
        next.push({
          id: crypto.randomUUID(),
          name: file.name.slice(0, 160),
          mimeType: file.type || "text/plain",
          kind: "text",
          content,
        });
      }
      setPlanAttachments((current) => [...current, ...next]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "资料读取失败，请重试。");
    }
  }
  async function attachChatFiles(files: File[]) {
    setError("");
    const remaining = 6 - chatAttachments.length;
    if (files.length > remaining) {
      setError("一次最多添加 6 个附件。");
      return;
    }
    const next: ChatAttachment[] = [];
    let hasImage = chatAttachments.some((attachment) => attachment.kind === "image");
    let totalTextBytes = chatAttachments
      .filter((attachment) => attachment.kind === "text")
      .reduce(
        (total, attachment) => total + new TextEncoder().encode(attachment.content).byteLength,
        0,
      );
    try {
      for (const file of files) {
        if (isVideoFile(file)) {
          if (hasImage) throw new Error("每轮最多附加一张图片或一个视频。");
          const contactSheet = await createVideoContactSheet(file);
          if (!isSupportedImageDataUrl(contactSheet))
            throw new Error("视频画面提取失败，请换一个文件后重试。");
          hasImage = true;
          next.push({
            id: crypto.randomUUID(),
            name: `${file.name.slice(0, 120)} · 关键帧`,
            mimeType: "image/jpeg",
            kind: "image",
            content: contactSheet,
          });
          continue;
        }
        if (/^image\/(jpeg|png|gif|webp)$/.test(file.type)) {
          if (hasImage) throw new Error("每轮最多附加 1 张图片。");
          if (file.size > MAX_IMAGE_BYTES) throw new Error("图片不能超过 6 MB。");
          const content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              typeof reader.result === "string"
                ? resolve(reader.result)
                : reject(new Error("图片读取失败。"));
            reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
            reader.readAsDataURL(file);
          });
          if (!isSupportedImageDataUrl(content))
            throw new Error("图片文件内容无效，请换一张图片。");
          hasImage = true;
          next.push({
            id: crypto.randomUUID(),
            name: file.name.slice(0, 160),
            mimeType: file.type,
            kind: "image",
            content,
          });
        } else {
          if (!isSupportedChatTextFile(file))
            throw new Error(
              `暂不支持「${file.name}」。可添加图片、DOCX、XLSX、PPTX、PDF、Markdown 或代码文件。`,
            );
          const content = await readChatDocument(file);
          totalTextBytes += new TextEncoder().encode(content).byteLength;
          if (totalTextBytes > 200_000) throw new Error("文本附件合计不能超过 200 KB。");
          next.push({
            id: crypto.randomUUID(),
            name: file.name.slice(0, 160),
            mimeType: file.type || "text/plain",
            kind: "text",
            content,
          });
        }
      }
      setChatAttachments((current) => [...current, ...next]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "附件读取失败，请重试。");
    }
  }
  async function execute(
    attachmentsForTurn: ChatAttachment[] = chatAttachments,
    options?: {
      workspaceOverride?: Workspace;
      instructionOverride?: string;
      displayMessage?: string;
      dialogMessageId?: string;
      handoffJobId?: string;
      handoffClaimToken?: string;
    },
  ) {
    const targetWorkspace = options?.workspaceOverride || workspace;
    const workInstruction = options?.instructionOverride?.trim() ?? instruction.trim();
    const userFacingMessage = options?.displayMessage?.trim() || workInstruction;
    const delegatedMessageId = options?.dialogMessageId;
    const handoffClaim =
      options?.handoffJobId && options.handoffClaimToken
        ? { id: options.handoffJobId, token: options.handoffClaimToken }
        : null;
    if (!targetWorkspace) {
      if (handoffClaim)
        void api("/api/handoffs", {
          method: "PATCH",
          body: JSON.stringify({ action: "release", ...handoffClaim }),
        }).catch(() => {});
      return;
    }
    if (agentRequestControllerRef.current) {
      if (handoffClaim)
        void api("/api/handoffs", {
          method: "PATCH",
          body: JSON.stringify({ action: "release", ...handoffClaim }),
        }).catch(() => {});
      return;
    }
    if (targetWorkspace.mode === "demo" && attachmentsForTurn.length > 0) {
      setError("附件解析需要实时 AI。请切换到实时模式后发送，附件不会在演示模式中被忽略。");
      if (handoffClaim)
        void api("/api/handoffs", {
          method: "PATCH",
          body: JSON.stringify({ action: "release", ...handoffClaim }),
        }).catch(() => {});
      return;
    }
    const requestEpoch = clientSession.epoch;
    if (targetWorkspace.mode === "demo" && targetWorkspace.result && workInstruction) {
      const note = workInstruction;
      const controller = new AbortController();
      agentRequestControllerRef.current = controller;
      if (handoffClaim) activeHandoffClaimRef.current = handoffClaim;
      if (!delegatedMessageId) setInstruction("");
      setBusy("execute");
      setPendingExecutionContent(userFacingMessage);
      setActiveExecution({
        workspaceId: targetWorkspace.id,
        workspaceTitle: targetWorkspace.plan.title,
        state: "running",
        activity: `演示模式：正在整理「${userFacingMessage.slice(0, 72)}」。`,
      });
      setExecutionStreamText("");
      setError("");
      try {
        const demoResult = demoFollowUp(targetWorkspace.result, note);
        const conversation: ConversationMessage[] = [
          ...(targetWorkspace.conversation || [
            { id: crypto.randomUUID(), role: "user" as const, content: targetWorkspace.prompt },
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              agent: "planner" as const,
              content: targetWorkspace.plan.summary,
            },
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              agent: "workbench" as const,
              content: targetWorkspace.result.summary,
              toolEvents: targetWorkspace.result.events,
            },
          ]),
          ...(delegatedMessageId
            ? []
            : [{ id: crypto.randomUUID(), role: "user" as const, content: userFacingMessage }]),
        ].slice(-39);
        const nextWorkspace = {
          ...targetWorkspace,
          conversation: [
            ...conversation,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              agent: "workbench" as const,
              content: demoResult?.summary || "这条指示已保存为备注。演示模式没有调用模型。",
              toolEvents: demoResult?.events.slice(-3),
              progress: ["演示模式：按本地规则处理了这条指示，没有调用模型。"],
            },
          ].slice(-40),
          result: demoResult || {
            ...targetWorkspace.result,
            summary: "这条指示已保存为备注。演示模式可模拟新增任务示例；其他复杂修改需要实时 AI。",
            events: [
              ...targetWorkspace.result.events,
              {
                id: crypto.randomUUID(),
                name: "record_instruction",
                title: "演示备注已保存",
                detail: `${note}（未调用模型）`,
                status: "done" as const,
              },
            ].slice(-100),
            artifacts: [
              ...targetWorkspace.result.artifacts.filter(
                (artifact) => artifact.type !== "document" || artifact.title !== "补充指示",
              ),
              {
                id: crypto.randomUUID(),
                type: "document",
                title: "补充指示",
                description: "本地演示备注，未调用模型",
                content: note,
              },
            ],
          },
        };
        if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
        await save(nextWorkspace, requestEpoch);
        if (requestEpoch !== clientSession.epoch) return;
        if (handoffClaim)
          await api("/api/handoffs", {
            method: "PATCH",
            body: JSON.stringify({ action: "complete", ...handoffClaim }),
          }).catch(() => {});
        if (!delegatedMessageId && attachmentsForTurn.length) {
          setChatAttachmentStore((current) => {
            if (!current[targetWorkspace.id]) return current;
            const next = { ...current };
            delete next[targetWorkspace.id];
            return next;
          });
        }
        setActiveExecution({
          workspaceId: targetWorkspace.id,
          workspaceTitle: targetWorkspace.plan.title,
          state: "completed",
          activity: "补充要求已保存到工作区。",
        });
      } catch (cause) {
        if (handoffClaim && !controller.signal.aborted)
          await api("/api/handoffs", {
            method: "PATCH",
            body: JSON.stringify({ action: "release", ...handoffClaim }),
          }).catch(() => {});
        if (requestEpoch === clientSession.epoch) {
          if (controller.signal.aborted) {
            setActiveExecution((current) =>
              current?.workspaceId === targetWorkspace.id ? null : current,
            );
            setError("已停止本轮处理；原工作区内容保留。已提交的保存无法撤回。");
          } else {
            const message = cause instanceof Error ? cause.message : "指示保存失败";
            setActiveExecution({
              workspaceId: targetWorkspace.id,
              workspaceTitle: targetWorkspace.plan.title,
              state: "failed",
              activity: "补充要求保存失败",
              message,
            });
            setError(message);
          }
        }
      } finally {
        if (handoffClaim?.id === activeHandoffClaimRef.current?.id)
          activeHandoffClaimRef.current = null;
        if (agentRequestControllerRef.current === controller)
          agentRequestControllerRef.current = null;
        if (requestEpoch === clientSession.epoch) {
          setBusy(null);
          setPendingExecutionContent("");
          void runNextQueuedHandoff();
        }
      }
      return;
    }
    const controller = new AbortController();
    agentRequestControllerRef.current = controller;
    if (handoffClaim) activeHandoffClaimRef.current = handoffClaim;
    const attachmentSummary = attachmentsForTurn.length
      ? `附件：${attachmentsForTurn.map((item) => item.name).join("、")}`
      : "";
    const executionTurnContent = [
      userFacingMessage,
      ...(attachmentSummary && !userFacingMessage.includes(attachmentSummary)
        ? [attachmentSummary]
        : []),
    ]
      .filter(Boolean)
      .join("\n");
    setPendingExecutionContent(executionTurnContent);
    if (!delegatedMessageId) setInstruction("");
    setBusy("execute");
    const isDemoExecution = targetWorkspace.mode === "demo";
    liveExecutionWorkspaceIdRef.current = isDemoExecution ? null : targetWorkspace.id;
    const initialActivity = isDemoExecution
      ? "演示模式：正在准备本地示例结果。"
      : "正在连接 Agent…";
    completedToolCallIdsRef.current.clear();
    setCompletedToolCalls(0);
    setActiveExecution({
      workspaceId: targetWorkspace.id,
      workspaceTitle: targetWorkspace.plan.title,
      state: "running",
      activity: initialActivity,
      startedAt: new Date().toISOString(),
    });
    setExecutionStreamText("");
    setError("");
    try {
      const route =
        targetWorkspace.plan.routes.find((item) => item.id === targetWorkspace.selectedRouteId) ||
        targetWorkspace.plan.routes[0];
      const data = await streamApi<{ result: ExecutionResult; mode: "live" | "demo" }>(
        "/api/execute",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId: targetWorkspace.id,
            goal: targetWorkspace.prompt,
            instruction: workInstruction,
            displayMessage: userFacingMessage,
            ...(delegatedMessageId ? { dialogMessageId: delegatedMessageId } : {}),
            ...(handoffClaim
              ? { handoffJobId: handoffClaim.id, handoffClaimToken: handoffClaim.token }
              : {}),
            attachments: attachmentsForTurn,
            continuation: Boolean(targetWorkspace.result),
            plan: targetWorkspace.plan,
            route,
            currentTasks: targetWorkspace.result?.tasks || [],
            currentMilestones: targetWorkspace.result?.milestones || [],
            currentBudget: targetWorkspace.result?.budget,
            demo: targetWorkspace.mode === "demo",
            thinkingMode,
          }),
          signal: controller.signal,
        },
        (event) => {
          if (event.type === "status") {
            setActiveExecution((current) =>
              current?.workspaceId === targetWorkspace.id && current.state === "running"
                ? { ...current, activity: event.message }
                : current,
            );
          }
          if (event.type === "tool-start") {
            setActiveExecution((current) =>
              current?.workspaceId === targetWorkspace.id && current.state === "running"
                ? { ...current, activity: `正在调用：${event.title}` }
                : current,
            );
          }
          if (event.type === "tool") {
            if (event.status === "done") {
              if (!event.id || !completedToolCallIdsRef.current.has(event.id)) {
                if (event.id) completedToolCallIdsRef.current.add(event.id);
                setCompletedToolCalls((count) => count + 1);
              }
            }
            setActiveExecution((current) =>
              current?.workspaceId === targetWorkspace.id && current.state === "running"
                ? {
                    ...current,
                    activity:
                      event.status === "error"
                        ? `${event.title} 遇到问题，Agent 正在调整`
                        : `${event.title} 已完成，Agent 正在继续`,
                  }
                : current,
            );
          }
          if (event.type === "text")
            setExecutionStreamText((current) => `${current}${event.text}`.slice(-5000));
        },
        true,
      );
      if (requestEpoch !== clientSession.epoch) return;
      if (data.mode === "live") {
        const latest = await api<{ workspace: Workspace }>(
          `/api/workspaces/${targetWorkspace.id}`,
          undefined,
          true,
        );
        if (requestEpoch !== clientSession.epoch) return;
        if (activeWorkspaceIdRef.current === targetWorkspace.id)
          setActiveWorkspace(latest.workspace);
        setHistory((current) => [
          latest.workspace,
          ...current.filter((item) => item.id !== latest.workspace.id),
        ]);
      } else {
        const previous = targetWorkspace.result;
        const baseConversation = targetWorkspace.conversation || [
          { id: crypto.randomUUID(), role: "user" as const, content: targetWorkspace.prompt },
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            agent: "planner" as const,
            content: targetWorkspace.plan.summary,
          },
          ...(previous
            ? [
                {
                  id: crypto.randomUUID(),
                  role: "assistant" as const,
                  agent: "workbench" as const,
                  content: previous.summary,
                  toolEvents: previous.events,
                },
              ]
            : []),
        ];
        const userTurn: ConversationMessage[] =
          executionTurnContent && !delegatedMessageId
            ? [{ id: crypto.randomUUID(), role: "user", content: executionTurnContent }]
            : [];
        const assistantTurn: ConversationMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          agent: "workbench",
          content: data.result.summary,
          toolEvents: data.result.events.slice(-20),
        };
        const nextResult =
          previous && workInstruction
            ? {
                summary: data.result.events.length
                  ? `已根据补充指示更新工作空间，完成 ${data.result.events.length} 次相关工具操作；当前共 ${data.result.tasks.length} 项任务。你可以继续调整计划。`
                  : data.result.summary,
                tasks: data.result.tasks,
                milestones: data.result.milestones.length
                  ? data.result.milestones
                  : previous.milestones,
                artifacts: [
                  ...previous.artifacts.filter(
                    (current) =>
                      !data.result.artifacts.some((updated) => updated.type === current.type),
                  ),
                  ...data.result.artifacts,
                ],
                events: [...previous.events, ...data.result.events],
                budget: data.result.budget ?? previous.budget,
              }
            : data.result;
        await save(
          {
            ...targetWorkspace,
            conversation: [...baseConversation, ...userTurn, assistantTurn].slice(-40),
            result: nextResult,
            usage: combineAiUsage(targetWorkspace.usage, data.result.usage),
            mode: data.mode,
          },
          requestEpoch,
          true,
        );
      }
      if (requestEpoch !== clientSession.epoch) return;
      if (handoffClaim)
        await api("/api/handoffs", {
          method: "PATCH",
          body: JSON.stringify({ action: "complete", ...handoffClaim }),
        }).catch(() => {});
      if (!delegatedMessageId && activeWorkspaceIdRef.current === targetWorkspace.id)
        setInstruction("");
      setPendingExecutionContent("");
      if (!delegatedMessageId) {
        setChatAttachmentStore((current) => {
          if (!current[targetWorkspace.id]) return current;
          const next = { ...current };
          delete next[targetWorkspace.id];
          return next;
        });
      }
      setActiveExecution((current) =>
        current?.workspaceId === targetWorkspace.id
          ? { ...current, state: "completed", activity: "本轮执行已完成 · 点击查看结果" }
          : current,
      );
    } catch (cause) {
      const serverCancelled =
        !controller.signal.aborted &&
        cause instanceof Error &&
        cause.message.includes("已取消本次 AI 请求");
      if (handoffClaim && !controller.signal.aborted)
        await api("/api/handoffs", {
          method: "PATCH",
          body: JSON.stringify({ action: "release", ...handoffClaim }),
        }).catch(() => {});
      if (requestEpoch === clientSession.epoch) {
        if (targetWorkspace.mode === "live") {
          try {
            const statusSnapshot = await api<{ executions: ActiveExecution[] }>(
              "/api/executions",
              undefined,
              true,
            ).catch(() => ({ executions: [] }));
            const recoveredExecution = statusSnapshot.executions
              .filter((execution) => execution.workspaceId === targetWorkspace.id)
              .sort(
                (left, right) =>
                  Date.parse(right.updatedAt || right.startedAt || "") -
                  Date.parse(left.updatedAt || left.startedAt || ""),
              )[0];
            if (recoveredExecution) setServerExecution(recoveredExecution);

            // A dropped browser stream does not stop the durable server-side run.
            // Reflect that fact immediately, even if reading the saved workspace
            // snapshot below also fails during the same network interruption.
            if (recoveredExecution?.state === "running") {
              setActiveExecution({
                workspaceId: targetWorkspace.id,
                workspaceTitle: targetWorkspace.plan.title,
                state: "running",
                activity: "连接已断开 · Agent 仍在后台推进",
                message: recoveredExecution.activity,
                completedToolCalls: recoveredExecution.completedToolCalls,
                startedAt: recoveredExecution.startedAt,
                updatedAt: recoveredExecution.updatedAt,
                cancelRequested: recoveredExecution.cancelRequested,
              });
              if (activeWorkspaceIdRef.current === targetWorkspace.id) setError("");
              return;
            }

            const recovered = await api<{ workspace: Workspace }>(
              `/api/workspaces/${targetWorkspace.id}`,
              undefined,
              true,
            );
            const saved = recovered.workspace;
            const previousEventCount = targetWorkspace.result?.events.length || 0;
            const savedEventCount = saved.result?.events.length || 0;
            const previousTokens = targetWorkspace.usage?.totalTokens || 0;
            const savedTokens = saved.usage?.totalTokens || 0;
            const resultChanged =
              JSON.stringify(saved.result) !== JSON.stringify(targetWorkspace.result);
            const usageChanged = savedTokens > previousTokens;
            const conversationChanged =
              JSON.stringify(saved.conversation || []) !==
              JSON.stringify(targetWorkspace.conversation || []);
            if (resultChanged || usageChanged || conversationChanged) {
              const recoveredWorkspace = saved;
              if (activeWorkspaceIdRef.current === targetWorkspace.id) {
                setActiveWorkspace(recoveredWorkspace);
              }
              setHistory((current) => [
                recoveredWorkspace,
                ...current.filter((item) => item.id !== recoveredWorkspace.id),
              ]);
              if (resultChanged || savedEventCount > previousEventCount) {
                if (!delegatedMessageId && activeWorkspaceIdRef.current === targetWorkspace.id)
                  setInstruction("");
                if (!delegatedMessageId) {
                  setChatAttachmentStore((current) => {
                    if (!current[targetWorkspace.id]) return current;
                    const next = { ...current };
                    delete next[targetWorkspace.id];
                    return next;
                  });
                }
                setActiveExecution(
                  resultChanged || savedEventCount > previousEventCount
                    ? (current) => {
                        if (current?.workspaceId !== targetWorkspace.id) return current;
                        const state = recoveredExecution?.state || "failed";
                        return {
                          ...current,
                          state,
                          completedToolCalls:
                            recoveredExecution?.completedToolCalls ?? current.completedToolCalls,
                          startedAt: recoveredExecution?.startedAt || current.startedAt,
                          updatedAt: recoveredExecution?.updatedAt || current.updatedAt,
                          activity:
                            state === "completed"
                              ? "本轮结果已恢复 · 点击查看"
                              : "本轮已中断 · 阶段成果已保存",
                          ...(state === "failed"
                            ? {
                                message:
                                  recoveredExecution?.message ||
                                  (cause instanceof Error
                                    ? cause.message
                                    : "执行中断；已保存的阶段成果已恢复。"),
                              }
                            : {}),
                        };
                      }
                    : controller.signal.aborted
                      ? (current) => (current?.workspaceId === targetWorkspace.id ? null : current)
                      : {
                          workspaceId: targetWorkspace.id,
                          workspaceTitle: targetWorkspace.plan.title,
                          state: "failed",
                          activity: serverCancelled ? "本轮执行已停止" : "执行中断",
                          message:
                            cause instanceof Error
                              ? cause.message
                              : "执行中断；已保存的对话已恢复。",
                        },
                );
                if (
                  activeWorkspaceIdRef.current === targetWorkspace.id &&
                  controller.signal.aborted
                )
                  setError(
                    `已停止本次执行；已保存 ${savedEventCount - previousEventCount} 项阶段成果。`,
                  );
                else if (
                  activeWorkspaceIdRef.current === targetWorkspace.id &&
                  recoveredExecution?.state === "failed"
                )
                  setError(
                    recoveredExecution.message || "本轮执行已中断；已保存的阶段成果已恢复。",
                  );
              } else {
                const failureMessage = controller.signal.aborted
                  ? "已停止本次执行；本轮内容未提交，已完成步骤的模型用量已记录，原工作区内容保留。"
                  : cause instanceof Error
                    ? cause.message
                    : "执行失败";
                if (controller.signal.aborted) {
                  setActiveExecution((current) =>
                    current?.workspaceId === targetWorkspace.id ? null : current,
                  );
                  if (activeWorkspaceIdRef.current === targetWorkspace.id) setError(failureMessage);
                } else {
                  setActiveExecution({
                    workspaceId: targetWorkspace.id,
                    workspaceTitle: targetWorkspace.plan.title,
                    state: "failed",
                    activity: serverCancelled ? "本轮执行已停止" : "执行中断",
                    message: failureMessage,
                  });
                  if (activeWorkspaceIdRef.current === targetWorkspace.id) setError(failureMessage);
                }
              }
              return;
            }
          } catch {
            // Keep the original stream error visible if the saved workspace cannot be recovered.
          }
        }
        const failureMessage = controller.signal.aborted
          ? "已停止本次执行；未保存本轮生成结果，已有工作区内容保留。"
          : cause instanceof Error
            ? cause.message
            : "执行失败";
        if (controller.signal.aborted) {
          setActiveExecution((current) =>
            current?.workspaceId === targetWorkspace.id ? null : current,
          );
          if (activeWorkspaceIdRef.current === targetWorkspace.id) setError(failureMessage);
        } else {
          setActiveExecution({
            workspaceId: targetWorkspace.id,
            workspaceTitle: targetWorkspace.plan.title,
            state: "failed",
            activity: "执行中断",
            message: failureMessage,
          });
          if (activeWorkspaceIdRef.current === targetWorkspace.id) setError(failureMessage);
        }
      }
    } finally {
      if (handoffClaim?.id === activeHandoffClaimRef.current?.id)
        activeHandoffClaimRef.current = null;
      if (agentRequestControllerRef.current === controller)
        agentRequestControllerRef.current = null;
      if (liveExecutionWorkspaceIdRef.current === targetWorkspace.id)
        liveExecutionWorkspaceIdRef.current = null;
      if (requestEpoch === clientSession.epoch) {
        setBusy(null);
        setPendingExecutionContent("");
        void runNextQueuedHandoff();
      }
    }
  }
  async function chatWithDialogAgent() {
    const target = workspace;
    const question = instruction.trim();
    const attachmentsForTurn = chatAttachments;
    if (!target || questionRequestActiveRef.current) return;
    if (target.mode === "demo" && attachmentsForTurn.length > 0) {
      setError("附件需要实时 AI 才能读取。切换到实时模式后再发送，附件仍会保留。");
      return;
    }
    if (!question && !attachmentsForTurn.length) {
      if (!target.result) void execute([], { workspaceOverride: target });
      return;
    }

    const requestEpoch = clientSession.epoch;
    const controller = new AbortController();
    const originalConversationIds = new Set((target.conversation || []).map((item) => item.id));
    questionRequestActiveRef.current = true;
    questionRequestControllerRef.current = controller;
    setQuestionWorkspaceId(target.id);
    setQuestionBusy(true);
    setPendingQuestion(question);
    setQuestionStreamText("");
    setQuestionError("");
    setInstruction("");
    let handoff: Extract<DialogDispatchResult, { kind: "handoff" }> | null = null;

    const updateWorkspace = (saved: Workspace) => {
      if (requestEpoch !== clientSession.epoch) return;
      setHistory((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      if (activeWorkspaceIdRef.current === saved.id) setActiveWorkspace(saved);
    };

    try {
      const result = await streamApi<DialogDispatchResult>(
        "/api/chat",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId: target.id,
            question,
            attachments: attachmentsForTurn,
            thinkingMode,
          }),
          signal: controller.signal,
        },
        (event) => {
          if (requestEpoch === clientSession.epoch && event.type === "text") {
            setQuestionStreamText((current) => `${current}${event.text}`.slice(-5000));
          }
          if (requestEpoch === clientSession.epoch && event.type === "handoff") {
            handoff = {
              kind: "handoff",
              handoffId: event.handoffId,
              instruction: event.instruction,
              userMessageId: event.userMessageId,
              userMessage: event.userMessage,
              acknowledgment: event.acknowledgment,
              queued: event.queued,
            };
          }
        },
        true,
      );
      const latest = await api<{ workspace: Workspace }>(
        `/api/workspaces/${target.id}`,
        undefined,
        true,
      );
      updateWorkspace(latest.workspace);
      const dispatch = result.kind === "handoff" ? result : handoff;
      if (dispatch) {
        if (!dispatch.handoffId)
          throw new Error("对话 Agent 已判断需要执行，但服务器没有确认交接，请重试。");
        if (requestEpoch !== clientSession.epoch) return;
        setChatAttachmentStore((current) => {
          if (!current[target.id]) return current;
          const next = { ...current };
          delete next[target.id];
          return next;
        });
        const run = visibleExecution?.state === "running" ? visibleExecution : null;
        if (!queuedHandoffsRef.current.some((item) => item.id === dispatch.handoffId))
          queuedHandoffsRef.current.push({ id: dispatch.handoffId, workspaceId: target.id });
        setQueuedHandoffCount(queuedHandoffsRef.current.length);
        void runNextQueuedHandoff();
        setQuestionStreamText(
          dispatch.queued || run || agentRequestControllerRef.current
            ? `这项工作已由服务器保存到队列。${run ? `等「${run.workspaceTitle}」当前执行完成后` : "当前工作台任务结束后"}，工作台 Agent 会自动接手。`
            : "工作要求和附件已保存，工作台 Agent 正在接手。",
        );
      } else {
        setChatAttachmentStore((current) => {
          if (!current[target.id]) return current;
          const next = { ...current };
          delete next[target.id];
          return next;
        });
      }
    } catch (cause) {
      if (requestEpoch !== clientSession.epoch) return;
      let questionWasSaved = false;
      try {
        const latest = await api<{ workspace: Workspace }>(
          `/api/workspaces/${target.id}`,
          undefined,
          true,
        );
        questionWasSaved = (latest.workspace.conversation || []).some(
          (message) =>
            message.role === "user" &&
            message.content === question &&
            !originalConversationIds.has(message.id),
        );
        updateWorkspace(latest.workspace);
      } catch {
        // Keep the conversational error visible if the workspace cannot be refreshed.
      }
      if (requestEpoch === clientSession.epoch) {
        if (!questionWasSaved) setInstruction(question);
        setQuestionError(cause instanceof Error ? cause.message : "这次交流没有完成，请重试。");
      }
    } finally {
      if (questionRequestControllerRef.current === controller)
        questionRequestControllerRef.current = null;
      questionRequestActiveRef.current = false;
      if (requestEpoch === clientSession.epoch) {
        setQuestionBusy(false);
        setPendingQuestion("");
      }
    }
  }
  function scheduleQueuedHandoffRetry(delay = 1200) {
    if (queuedHandoffRetryRef.current !== null) return;
    queuedHandoffRetryRef.current = window.setTimeout(() => {
      queuedHandoffRetryRef.current = null;
      runNextQueuedHandoffRef.current();
    }, delay);
  }
  async function runNextQueuedHandoff() {
    if (queuedHandoffRunnerRef.current || queuedHandoffsRef.current.length === 0) return;
    if (agentRequestControllerRef.current) {
      scheduleQueuedHandoffRetry();
      return;
    }
    const queued = queuedHandoffsRef.current.shift();
    if (!queued) return;
    queuedHandoffRunnerRef.current = true;
    setQueuedHandoffCount(queuedHandoffsRef.current.length);
    const requestEpoch = clientSession.epoch;
    let claim: { id: string; token: string } | null = null;
    try {
      const claimed = await api<{
        status: "claimed" | "busy" | "missing";
        handoff?: QueuedWorkbenchHandoff;
        token?: string;
      }>("/api/handoffs", {
        method: "PATCH",
        body: JSON.stringify({ action: "claim", id: queued.id }),
      });
      if (requestEpoch !== clientSession.epoch) return;
      if (claimed.status === "busy") {
        queuedHandoffsRef.current.unshift(queued);
        setQueuedHandoffCount(queuedHandoffsRef.current.length);
        scheduleQueuedHandoffRetry(5000);
        return;
      }
      if (claimed.status !== "claimed" || !claimed.handoff || !claimed.token) {
        setQueuedHandoffCount(queuedHandoffsRef.current.length);
        return;
      }
      const handoff = claimed.handoff;
      claim = { id: handoff.id, token: claimed.token };
      const latest = await api<{ workspace: Workspace }>(
        `/api/workspaces/${handoff.workspaceId}`,
        undefined,
        true,
      );
      if (requestEpoch !== clientSession.epoch) return;
      if (agentRequestControllerRef.current) {
        void api("/api/handoffs", {
          method: "PATCH",
          body: JSON.stringify({ action: "release", ...claim }),
        }).catch(() => {});
        claim = null;
        queuedHandoffsRef.current.unshift(queued);
        setQueuedHandoffCount(queuedHandoffsRef.current.length);
        return;
      }
      setHistory((current) => [
        latest.workspace,
        ...current.filter((item) => item.id !== latest.workspace.id),
      ]);
      if (activeWorkspaceIdRef.current === latest.workspace.id)
        setActiveWorkspace(latest.workspace);
      queuedHandoffRunnerRef.current = false;
      activeHandoffClaimRef.current = claim;
      void execute(handoff.attachments, {
        workspaceOverride: latest.workspace,
        instructionOverride: handoff.instruction,
        displayMessage: handoff.userMessage,
        dialogMessageId: handoff.userMessageId,
        handoffJobId: handoff.id,
        handoffClaimToken: claimed.token,
      });
    } catch (cause) {
      if (claim)
        await api("/api/handoffs", {
          method: "PATCH",
          body: JSON.stringify({ action: "release", ...claim }),
        }).catch(() => {});
      queuedHandoffsRef.current.unshift(queued);
      setQueuedHandoffCount(queuedHandoffsRef.current.length);
      if (activeWorkspaceIdRef.current === queued.workspaceId)
        setError(
          cause instanceof Error
            ? `排队任务暂时没有启动，要求仍已保留：${cause.message}`
            : "排队任务暂时没有启动，要求仍已保留。",
        );
    } finally {
      queuedHandoffRunnerRef.current = false;
      if (queuedHandoffsRef.current.length) scheduleQueuedHandoffRetry(2000);
    }
  }
  runNextQueuedHandoffRef.current = () => {
    void runNextQueuedHandoff();
  };
  async function toggleTask(id: string) {
    if (!workspace?.result || savingTaskId || busy) return;
    const requestEpoch = clientSession.epoch;
    setSavingTaskId(id);
    const tasks = workspace.result.tasks.map((task) =>
      task.id === id
        ? { ...task, status: task.status === "done" ? ("pending" as const) : ("done" as const) }
        : task,
    );
    try {
      await save({ ...workspace, result: { ...workspace.result, tasks } }, requestEpoch);
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setError(cause instanceof Error ? cause.message : "任务保存失败");
    } finally {
      if (requestEpoch === clientSession.epoch) setSavingTaskId(null);
    }
  }
  async function remove(id: string) {
    const requestEpoch = clientSession.epoch;
    const wasPendingSave = pendingSave?.id === id;
    deletingWorkspaceIdsRef.current.add(id);
    let removed = false;
    try {
      const queuedSave = saveQueuesRef.current.get(id);
      if (queuedSave) await queuedSave.catch(() => undefined);
      if (requestEpoch !== clientSession.epoch) return;
      try {
        await api(`/api/workspaces/${id}`, { method: "DELETE" }, true);
      } catch (cause) {
        if (!(wasPendingSave && cause instanceof ApiError && cause.status === 404)) throw cause;
      }
      removed = true;
      if (requestEpoch !== clientSession.epoch) return;
      setPendingSave((current) => (current?.id === id ? null : current));
      if (pendingSaveRecoveryRef.current?.workspace.id === id) {
        pendingSaveRecoveryRef.current = null;
      }
      if (expiredSaveRecoveryRef.current?.workspace.id === id) {
        expiredSaveRecoveryRef.current = null;
      }
      setHistory((current) => current.filter((item) => item.id !== id));
      setError("");
      if (workspace?.id === id) {
        setActiveWorkspace(null);
        setView("home");
      }
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      if (!removed) deletingWorkspaceIdsRef.current.delete(id);
    }
  }
  async function openAdmin() {
    const requestEpoch = clientSession.epoch;
    setView("admin");
    setMobileNav(false);
    setError("");
    try {
      const data = await api<AdminData>("/api/admin/overview", undefined, true);
      if (requestEpoch === clientSession.epoch) setAdmin(data);
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setError(cause instanceof Error ? cause.message : "加载失败");
    }
  }
  async function checkAiConnection() {
    const requestEpoch = clientSession.epoch;
    setAiHealth({ state: "checking", message: "正在验证 Key 与模型响应…" });
    try {
      const result = await api<{ model: string; latencyMs: number }>(
        "/api/admin/ai-status",
        { method: "POST" },
        true,
      );
      if (requestEpoch === clientSession.epoch) {
        setAiHealth({
          state: "connected",
          message: "连接正常",
          model: result.model,
          latencyMs: result.latencyMs,
        });
      }
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setAiHealth({
          state: "error",
          message: cause instanceof Error ? cause.message : "连接检查失败",
        });
    }
  }
  async function changeRole(id: string, role: "admin" | "member") {
    const requestEpoch = clientSession.epoch;
    try {
      await api(
        `/api/admin/users/${id}`,
        { method: "PATCH", body: JSON.stringify({ role }) },
        true,
      );
      if (requestEpoch !== clientSession.epoch) return;
      const data = await api<AdminData>("/api/admin/overview", undefined, true);
      if (requestEpoch === clientSession.epoch) setAdmin(data);
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setError(cause instanceof Error ? cause.message : "权限修改失败");
    }
  }
  async function adminRemoveUser(item: AdminData["users"][number]) {
    const requestEpoch = clientSession.epoch;
    try {
      await api(`/api/admin/users/${item.id}`, { method: "DELETE" }, true);
      if (requestEpoch !== clientSession.epoch) return;
      const data = await api<AdminData>("/api/admin/overview", undefined, true);
      if (requestEpoch === clientSession.epoch) setAdmin(data);
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setError(cause instanceof Error ? cause.message : "账户删除失败");
    }
  }
  async function adminRemove(id: string) {
    const requestEpoch = clientSession.epoch;
    try {
      await api(`/api/admin/workspaces/${id}`, { method: "DELETE" }, true);
      if (requestEpoch !== clientSession.epoch) return;
      const data = await api<AdminData>("/api/admin/overview", undefined, true);
      if (requestEpoch !== clientSession.epoch) return;
      setAdmin(data);
      await loadHistory();
      if (workspace?.id === id) setActiveWorkspace(null);
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setError(cause instanceof Error ? cause.message : "删除失败");
    }
  }
  async function logout() {
    const requestEpoch = clientSession.epoch;
    try {
      if (pendingSave) {
        const queuedSave = saveQueuesRef.current.get(pendingSave.id);
        if (queuedSave) await queuedSave;
        else await persistWorkspace(pendingSave, requestEpoch);
        if (requestEpoch !== clientSession.epoch) return;
      }
      await api("/api/auth/logout", { method: "POST" }, true);
      if (requestEpoch !== clientSession.epoch) return;
      expiredSaveRecoveryRef.current = null;
      expiredPlanDraftRecoveryRef.current = null;
      setUser(null);
      clearPrivateSessionState();
      setAuthMode("login");
      setError("");
    } catch (cause) {
      if (requestEpoch === clientSession.epoch)
        setError(cause instanceof Error ? cause.message : "退出登录失败");
    }
  }
  function navigate(next: View) {
    if (next === "workspace") setWorkspaceSidebarExpanded(false);
    setView(next);
    setMobileNav(false);
    setError("");
  }
  function toggleDesktopSidebar() {
    const nextCollapsed = !sidebarCollapsed;
    if (view === "workspace") {
      setWorkspaceSidebarExpanded(!nextCollapsed);
    } else {
      setSidebarCollapsedPreference(nextCollapsed);
    }
    window.requestAnimationFrame(() => {
      const nextControl = nextCollapsed
        ? desktopSidebarExpandButtonRef.current
        : desktopSidebarCollapseButtonRef.current;
      nextControl?.focus();
    });
  }
  function trapMobileNavFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (!mobileNav || event.key !== "Tab") return;
    const focusable = mobileNavRef.current?.querySelectorAll<HTMLElement>(
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
      (document.activeElement === first || document.activeElement === mobileNavRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (loading)
    return (
      <div className="boot">
        <Brand />
        <div className="boot-line">
          <span />
        </div>
      </div>
    );
  if (!user)
    return (
      <AuthScreen
        initialMode={authMode}
        initialError={error}
        onSuccess={(current) => {
          const recovery = expiredSaveRecoveryRef.current;
          const draftRecovery = expiredPlanDraftRecoveryRef.current;
          expiredSaveRecoveryRef.current = null;
          expiredPlanDraftRecoveryRef.current = null;
          clearPrivateSessionState();
          setUser(current);
          setUseDemo(!aiConfigured);
          setAuthMode("login");
          setError("");
          if (recovery?.userId === current.id) {
            pendingSaveRecoveryRef.current = recovery;
            setPendingSave(recovery.workspace);
            setActiveWorkspace(recovery.workspace);
            setHistory([recovery.workspace]);
            setWorkspaceSidebarExpanded(false);
            setView("workspace");
            const requestEpoch = clientSession.epoch;
            void persistWorkspace(recovery.workspace, requestEpoch)
              .then(() => loadHistory())
              .catch((cause) => {
                if (requestEpoch === clientSession.epoch) {
                  setError(
                    cause instanceof Error
                      ? `工作空间恢复失败：${cause.message}`
                      : "工作空间恢复失败，请重试保存。",
                  );
                }
              });
          } else if (draftRecovery?.userId === current.id) {
            setPrompt(draftRecovery.prompt);
            setImage(draftRecovery.image);
            setImageName(draftRecovery.imageName);
            setPlanAttachments(draftRecovery.attachments);
            setUseDemo(draftRecovery.useDemo);
            setError("已恢复刚才提交的目标描述、参考图和资料。请检查内容后，再开始规划。");
            loadHistory();
          } else {
            loadHistory();
          }
        }}
      />
    );
  const calendarScheduleInfo = workspace?.result
    ? inspectCalendarSchedule(workspace.result.milestones)
    : null;
  const adminAiCostEstimate = admin
    ? estimateDeepSeekFlashCost({
        inputTokens: admin.aiUsage.flashInputTokens,
        outputTokens: admin.aiUsage.flashOutputTokens,
        cacheMeasuredInputTokens: admin.aiUsage.flashCacheMeasuredInputTokens,
        cacheMeasuredHitTokens: admin.aiUsage.flashCacheMeasuredHitTokens,
      })
    : null;
  const currentWorkspaceFlashCostEstimate =
    workspace?.mode === "live" && workspace.usage && isDeepSeekFlashModel(workspace.usage.model)
      ? estimateDeepSeekFlashCost(workspace.usage)
      : null;
  const workspaceCacheCoverage = workspace?.usage
    ? getInputCacheCoverage(
        workspace.usage.inputTokens,
        workspace.usage.cacheMeasuredInputTokens ?? 0,
      )
    : null;
  const adminCacheCoverage = admin
    ? getInputCacheCoverage(admin.aiUsage.inputTokens, admin.aiUsage.cacheMeasuredInputTokens)
    : null;
  const adminWorkspaceCostEstimates = new Map(
    admin?.workspaces.map((item) => [
      item.id,
      estimateDeepSeekFlashCost({
        inputTokens: item.flashInputTokens,
        outputTokens: item.flashOutputTokens,
        cacheMeasuredInputTokens: item.flashCacheMeasuredInputTokens,
        cacheMeasuredHitTokens: item.flashCacheMeasuredHitTokens,
      }),
    ]) ?? [],
  );
  const workspaceExecution =
    workspace && visibleExecution?.workspaceId === workspace.id ? visibleExecution : null;
  return (
    <div className={`app-shell view-shell-${view}${sidebarCollapsed ? " nav-collapsed" : ""}`}>
      {mobileNav && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="关闭导航菜单"
          tabIndex={-1}
          onClick={() => setMobileNav(false)}
        />
      )}
      {sidebarCollapsed && (
        <button
          className="desktop-sidebar-expand"
          ref={desktopSidebarExpandButtonRef}
          type="button"
          onClick={toggleDesktopSidebar}
          aria-expanded={false}
          aria-controls="primary-sidebar"
          aria-label="展开导航栏"
          title="展开导航栏"
        >
          <ChevronRight size={17} />
        </button>
      )}
      <aside
        id="primary-sidebar"
        ref={mobileNavRef}
        className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}
        role={mobileNav ? "dialog" : undefined}
        aria-modal={mobileNav ? true : undefined}
        aria-label={mobileNav ? "导航菜单" : undefined}
        onKeyDown={trapMobileNavFocus}
      >
        <div className="sidebar-brand">
          <Brand />
          <button
            className="mobile-close"
            ref={mobileCloseButtonRef}
            type="button"
            onClick={() => setMobileNav(false)}
            aria-label="关闭菜单"
          >
            <X size={20} />
          </button>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav className="side-nav" aria-label="主导航">
          <button
            className={view === "home" ? "active" : ""}
            aria-current={view === "home" ? "page" : undefined}
            onClick={() => navigate("home")}
          >
            <Compass size={18} /> 探索入口 <ArrowUpRight size={15} />
          </button>
          <button
            className={view === "workspace" ? "active" : ""}
            aria-current={view === "workspace" ? "page" : undefined}
            onClick={() => navigate(workspace ? "workspace" : "home")}
          >
            <Target size={18} /> 当前工作区
          </button>
          <button
            className={view === "knowledge" ? "active" : ""}
            aria-current={view === "knowledge" ? "page" : undefined}
            onClick={() => navigate("knowledge")}
          >
            <BookOpen size={18} /> 我的知识库
          </button>
          <button
            className={view === "history" ? "active" : ""}
            aria-current={view === "history" ? "page" : undefined}
            onClick={() => navigate("history")}
          >
            <FolderKanban size={18} /> 我的目标 <small>{history.length}</small>
          </button>
          <button
            className={view === "account" ? "active" : ""}
            aria-current={view === "account" ? "page" : undefined}
            onClick={() => navigate("account")}
          >
            <Settings size={18} /> 账户设置
          </button>
          {user.role === "admin" && (
            <button
              className={view === "admin" ? "active" : ""}
              aria-current={view === "admin" ? "page" : undefined}
              onClick={openAdmin}
            >
              <ShieldCheck size={18} /> 管理控制台
            </button>
          )}
        </nav>
        <p className="nav-label recent-label">RECENT JOURNEYS</p>
        <div className="recent-list">
          {(visibleExecution
            ? [
                ...history.filter((item) => item.id === visibleExecution.workspaceId),
                ...history.filter((item) => item.id !== visibleExecution.workspaceId),
              ].slice(0, 3)
            : history.slice(0, 3)
          ).map((item) => {
            const executionForItem =
              visibleExecution?.workspaceId === item.id ? visibleExecution : null;
            return (
              <button
                key={item.id}
                className={executionForItem ? `has-execution ${executionForItem.state}` : undefined}
                onClick={() => openWorkspace(item)}
              >
                {executionForItem?.state === "running" ? (
                  <LoaderCircle
                    className="recent-run-indicator chat-spinner"
                    size={13}
                    aria-hidden="true"
                  />
                ) : executionForItem?.state === "failed" ? (
                  <CircleAlert
                    className="recent-run-indicator failed"
                    size={13}
                    aria-hidden="true"
                  />
                ) : executionForItem?.state === "completed" ? (
                  <Check className="recent-run-indicator completed" size={13} aria-hidden="true" />
                ) : (
                  <i />
                )}
                <span>
                  {item.plan.category}
                  <small>{item.plan.title}</small>
                  {executionForItem && (
                    <small className="recent-execution-activity">
                      {executionForItem.state === "failed"
                        ? executionForItem.message || executionForItem.activity
                        : executionForItem.activity}
                    </small>
                  )}
                </span>
              </button>
            );
          })}
          {history.length === 0 && <p>你的第一个目标将出现在这里</p>}
        </div>
        {view === "home" && (
          <section className="mobile-example-list" aria-label="目标示例">
            <p className="nav-label">快速开始</p>
            {examples.map((item) => (
              <button
                key={item.tag}
                type="button"
                onClick={() => {
                  setPrompt(item.text);
                  setMobileNav(false);
                }}
              >
                <item.icon size={16} strokeWidth={1.7} />
                <span>
                  <small>{item.tag}</small>
                  <strong>{item.title}</strong>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </section>
        )}
        <div className="sidebar-foot">
          <div className="agent-ready">
            <span>
              <Sparkles size={17} />
            </span>
            <div>
              <strong>Agent 已就绪</strong>
              <small>等待你的下一步指令</small>
            </div>
            <i />
          </div>
          <div className="profile">
            <span>{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role === "admin" ? "管理员" : "个人工作空间"}</small>
            </div>
            <button onClick={logout} aria-label="退出登录" title="退出登录">
              <LogOut size={17} />
            </button>
          </div>
        </div>
        <button
          className="desktop-sidebar-toggle"
          ref={desktopSidebarCollapseButtonRef}
          type="button"
          onClick={toggleDesktopSidebar}
          aria-expanded={!sidebarCollapsed}
          aria-controls="primary-sidebar"
          aria-label="收起导航栏"
          title="收起导航栏"
        >
          <ChevronLeft size={17} />
        </button>
      </aside>
      <div className="main-column">
        <header className={`topbar${visibleExecution ? " has-active-execution" : ""}`}>
          <div>
            <button
              className="mobile-menu"
              ref={mobileMenuButtonRef}
              type="button"
              aria-expanded={mobileNav}
              aria-controls="primary-sidebar"
              onClick={() => setMobileNav(true)}
              aria-label="打开菜单"
            >
              <Menu size={20} />
            </button>
            <span className="topbar-brand">
              <BrandMark compact />
              <strong>
                VHFX<span>NEX</span>
              </strong>
            </span>
            <b>/</b>
            {view === "home"
              ? "探索入口"
              : view === "workspace"
                ? "执行工作区"
                : view === "admin"
                  ? "管理控制台"
                  : view === "knowledge"
                    ? "我的知识库"
                    : view === "account"
                      ? "账户设置"
                      : "我的目标"}
          </div>
          <div>
            {visibleExecution && (
              <button
                className={`topbar-execution-chip ${visibleExecution.state}`}
                type="button"
                title={`${visibleExecution.workspaceTitle} · ${visibleExecution.message || visibleExecution.activity}`}
                onClick={() => {
                  const target =
                    history.find((item) => item.id === visibleExecution.workspaceId) ||
                    (workspace?.id === visibleExecution.workspaceId ? workspace : null);
                  if (target) openWorkspace(target);
                }}
              >
                {visibleExecution.state === "running" ? (
                  <LoaderCircle size={15} className="chat-spinner" aria-hidden="true" />
                ) : visibleExecution.state === "completed" ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <CircleAlert size={15} aria-hidden="true" />
                )}
                <span>
                  <strong>
                    {visibleExecution.state === "running"
                      ? visibleExecution.cancelRequested
                        ? "正在停止"
                        : "正在执行"
                      : visibleExecution.state === "completed"
                        ? "执行已完成"
                        : visibleExecution.activity === "本轮执行已停止"
                          ? "执行已停止"
                          : "执行中断"}{" "}
                    · {visibleExecution.workspaceTitle}
                  </strong>
                  <small>
                    {visibleExecution.message || visibleExecution.activity}
                    {visibleExecution.state === "running" &&
                    (visibleExecution.completedToolCalls ?? completedToolCalls) > 0
                      ? ` · 已完成 ${visibleExecution.completedToolCalls ?? completedToolCalls} 次工具操作`
                      : ""}
                  </small>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
            <span className="model-label">
              ✦ &nbsp;{" "}
              {(view === "workspace" && workspace?.mode === "demo") || (view === "home" && useDemo)
                ? "DEMO AGENT"
                : "DEEPSEEK V4.1 FLASH"}
            </span>
            <span className="top-avatar">{user.name.slice(0, 1)}</span>
          </div>
        </header>
        <main className={`content view-${view}`}>
          {error && (view !== "workspace" || pendingSave) && (
            <div className="error-banner" role="alert" aria-live="polite">
              <span className="error-message">{error}</span>
              {pendingSave && (
                <button
                  className="retry-save"
                  onClick={retrySave}
                  disabled={retryingSave}
                  aria-label="重试保存工作空间"
                >
                  {retryingSave ? "正在重试…" : "重试保存"}
                </button>
              )}
              <button onClick={() => setError("")} aria-label="关闭提示">
                <X size={16} />
              </button>
            </div>
          )}
          {view === "home" && (
            <section className="home">
              <div className="home-glow" />
              <div className="home-primary">
                <div className="home-top">
                  <span>
                    <i className="pulse" /> AN INTELLIGENT SPACE FOR WHAT&apos;S NEXT
                  </span>
                  <span>YOUR NEXT CHAPTER STARTS HERE ↘</span>
                </div>
                <div className="hero">
                  <p>
                    <Sparkles size={16} /> 你的想法，值得被认真执行
                  </p>
                  <h1>
                    接下来，
                    <br />
                    <em>我们做什么？</em>
                  </h1>
                  <div>
                    把目标告诉 Agent。它会理解方向、提出路线、调用工具，与你一起把事情推进到底。
                  </div>
                </div>
                <form
                  className="composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    analyze();
                  }}
                >
                  <div className="composer-top">
                    <span>✦ &nbsp; NEW MISSION</span>
                    <span>CTRL / ⌘ + ENTER</span>
                  </div>
                  <textarea
                    aria-label="描述你想完成的目标"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        analyze();
                      }
                    }}
                    placeholder="描述你想完成的事。无论是一次活动、一周安排，还是一个复杂项目…"
                    maxLength={4000}
                  />
                  <div className="composer-attachments">
                    {useDemo || !aiConfigured ? (
                      <button
                        type="button"
                        className="image-attach image-attach-disabled"
                        disabled
                        title="图片理解需要配置 Key 并关闭演示模式"
                      >
                        <ImagePlus size={16} /> 添加截图
                      </button>
                    ) : (
                      <label className="image-attach">
                        <ImagePlus size={16} /> 添加截图或参考图
                        <input
                          className="plan-image-input"
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                          onChange={(event) => {
                            attachImage(event.target.files?.[0]);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    )}
                    {useDemo || !aiConfigured ? (
                      <button
                        type="button"
                        className="image-attach image-attach-disabled"
                        disabled
                        title="资料提取需要配置 Key 并关闭演示模式"
                      >
                        <FileText size={16} /> 添加资料
                      </button>
                    ) : (
                      <label className="image-attach">
                        <FileText size={16} /> 添加资料
                        <input
                          className="plan-document-input"
                          type="file"
                          multiple
                          accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.java,.go,.rs,.sql,.yaml,.yml,.toml,.sh,.log,.env.example,.docx,.xlsx,.pptx,.pdf"
                          onChange={(event) => {
                            void attachPlanFiles(Array.from(event.target.files || []));
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    )}
                    {imageName && (
                      <span className="image-chip">
                        {imageName}
                        <button
                          type="button"
                          onClick={() => {
                            setImage("");
                            setImageName("");
                          }}
                          aria-label="移除图片"
                        >
                          <X size={13} />
                        </button>
                      </span>
                    )}
                    {planAttachments.length > 0 && (
                      <div className="plan-attachment-list" aria-label="本次规划资料">
                        {planAttachments.map((attachment) => (
                          <span
                            className="image-chip plan-attachment-chip"
                            key={attachment.id}
                            title={attachment.name}
                          >
                            {attachment.name}
                            <button
                              type="button"
                              onClick={() =>
                                setPlanAttachments((current) =>
                                  current.filter((item) => item.id !== attachment.id),
                                )
                              }
                              aria-label={`移除资料 ${attachment.name}`}
                            >
                              <X size={13} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <span className={useDemo || !aiConfigured ? "mode-hint" : undefined}>
                      {!aiConfigured
                        ? "未配置 DeepSeek Key · 正在使用演示数据"
                        : useDemo
                          ? "演示模式不处理图片和资料"
                          : "图片与资料只用于本次目标规划"}
                    </span>
                    <button
                      type="button"
                      className={`demo-toggle ${useDemo ? "on" : ""}`}
                      onClick={() => {
                        setUseDemo(!useDemo);
                        setImage("");
                        setImageName("");
                        setPlanAttachments([]);
                      }}
                    >
                      {useDemo ? "演示模式已开启" : "切换演示模式"}
                    </button>
                  </div>
                  <div className="composer-bottom">
                    <span>
                      <i /> 不用先选功能，Agent 会理解你的意图
                    </span>
                    <div className="composer-actions">
                      <button className="button-primary" disabled={busy === "analyze"}>
                        {busy === "analyze" ? "正在理解目标…" : "开始探索"}
                        <ArrowUpRight size={18} />
                      </button>
                      {busy === "analyze" && (
                        <button
                          type="button"
                          className="button-outline"
                          onClick={stopAgentRequest}
                          aria-label="停止目标分析"
                        >
                          停止
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </div>
              <aside className="home-examples" aria-label="目标示例">
                <div className="example-header">
                  <span>从这些目标开始</span>
                  <span>选择一个方向，内容还可继续修改</span>
                </div>
                <div className="example-grid">
                  {examples.map((item, index) => (
                    <button
                      key={item.tag}
                      onClick={() => {
                        setPrompt(item.text);
                      }}
                    >
                      <span className="example-number">0{index + 1}</span>
                      <item.icon size={24} strokeWidth={1.5} />
                      <small>{item.tag}</small>
                      <strong>{item.title}</strong>
                      <ArrowUpRight size={19} className="example-arrow" />
                    </button>
                  ))}
                </div>
              </aside>
            </section>
          )}
          {view === "workspace" && workspace && (
            <section className="workspace">
              <div className="workspace-head">
                <div>
                  <p className="eyebrow">
                    <span className="pulse" /> ACTIVE MISSION <span className="line" />{" "}
                    {workspace.plan.category}
                    {activeWorkspaceAccess !== "owner" && (
                      <span className="workspace-access-pill">
                        共享 · {activeWorkspaceAccess === "editor" ? "可编辑" : "只读"}
                      </span>
                    )}
                  </p>
                  <h1>{workspace.plan.title}</h1>
                  <p>{workspace.plan.summary}</p>
                </div>
                <div className="workspace-head-actions">
                  {activeWorkspaceAccess === "owner" && (
                    <button className="button-outline" onClick={openSharing}>
                      <Share2 size={16} /> 共享工作区
                    </button>
                  )}
                  <button
                    className="button-outline"
                    onClick={exportWorkspace}
                    aria-label="导出完整工作区"
                  >
                    <Download size={16} /> 导出完整工作区
                  </button>
                  <button className="button-outline" onClick={() => navigate("home")}>
                    <Plus size={16} /> 新建目标
                  </button>
                  <span className="sr-only" role="status" aria-live="polite">
                    {workspaceExportNotice}
                  </span>
                </div>
              </div>
              {workspaceExecution && (
                <div
                  className={`workspace-live-progress ${workspaceExecution.state}`}
                  role="status"
                  aria-live="polite"
                >
                  <span className="workspace-live-progress-icon" aria-hidden="true">
                    {workspaceExecution.state === "running" ? (
                      <LoaderCircle className="chat-spinner" size={18} />
                    ) : workspaceExecution.state === "completed" ? (
                      <Check size={18} />
                    ) : (
                      <CircleAlert size={18} />
                    )}
                  </span>
                  <span className="workspace-live-progress-copy">
                    <strong>
                      {workspaceExecution.state === "running"
                        ? `Agent 正在推进 · 已完成 ${workspaceExecution.completedToolCalls ?? completedToolCalls} 项工具操作`
                        : workspaceExecution.state === "completed"
                          ? `本轮执行完成 · 共完成 ${workspaceExecution.completedToolCalls ?? completedToolCalls} 项工具操作`
                          : "本轮执行中断"}
                    </strong>
                    <small>{workspaceExecution.message || workspaceExecution.activity}</small>
                  </span>
                  {workspaceExecution.state === "running" && (
                    <span className="workspace-live-progress-track" aria-hidden="true">
                      <i />
                    </span>
                  )}
                </div>
              )}
              <div className="goal-strip">
                <Target size={17} />
                <span>{workspace.prompt}</span>
                <b className={workspace.mode === "demo" ? "demo" : "live"}>
                  {workspace.mode === "demo" ? "演示模式" : "实时 AI"}
                </b>
              </div>
              {workspace.plan.sources?.length > 0 && (
                <div className="source-strip">
                  <BookOpen size={17} />
                  <span>{workspace.mode === "demo" ? "知识库检索命中" : "本次规划参考了"}</span>
                  {workspace.plan.sources.map((source) => (
                    <span className="source-pill" key={source.id} title={source.excerpt}>
                      {source.title}
                    </span>
                  ))}
                </div>
              )}
              <div className="workspace-layout">
                <ProjectFlowPanel
                  category={workspace.plan.category}
                  prompt={workspace.prompt}
                  tasks={workspace.result?.tasks || workspace.plan.tasks}
                  artifactCount={workspace.result?.artifacts.length || 0}
                />
                <div className="workspace-chat-column">
                  <WorkspaceChat
                    workspace={workspace}
                    readOnly={activeWorkspaceAccess === "viewer"}
                    route={
                      workspace.plan.routes.find((item) => item.id === workspace.selectedRouteId) ||
                      workspace.plan.routes[0]
                    }
                    draft={instruction}
                    busy={
                      visibleExecution?.workspaceId === workspace.id &&
                      visibleExecution.state === "running"
                    }
                    blockedByOtherExecution={
                      visibleExecution?.state === "running" &&
                      visibleExecution.workspaceId !== workspace.id
                        ? {
                            title: visibleExecution.workspaceTitle,
                            activity: visibleExecution.activity,
                          }
                        : null
                    }
                    streamedText={
                      visibleExecution?.workspaceId === workspace.id ? executionStreamText : ""
                    }
                    pendingExecutionContent={
                      visibleExecution?.workspaceId === workspace.id &&
                      visibleExecution.state === "running"
                        ? pendingExecutionContent
                        : ""
                    }
                    questionBusy={questionBusy && questionWorkspaceId === workspace.id}
                    pendingQuestion={questionWorkspaceId === workspace.id ? pendingQuestion : ""}
                    questionStreamText={
                      questionWorkspaceId === workspace.id ? questionStreamText : ""
                    }
                    questionError={questionWorkspaceId === workspace.id ? questionError : ""}
                    queuedHandoffCount={queuedHandoffCount}
                    error={
                      visibleExecution?.workspaceId === workspace.id &&
                      visibleExecution.state === "failed"
                        ? visibleExecution.message || visibleExecution.activity
                        : error
                    }
                    onDraftChange={setInstruction}
                    onSelectRoute={(routeId) => {
                      void save({ ...workspace, selectedRouteId: routeId }).catch((cause) =>
                        setError(cause instanceof Error ? cause.message : "路线保存失败"),
                      );
                    }}
                    onSend={() => execute()}
                    onAsk={chatWithDialogAgent}
                    onStop={stopAgentRequest}
                    onOpenArtifact={openArtifact}
                    attachments={chatAttachments}
                    onAttachFiles={attachChatFiles}
                    onRemoveAttachment={(id) =>
                      setChatAttachments((current) => current.filter((item) => item.id !== id))
                    }
                    thinkingMode={thinkingMode}
                    onThinkingModeChange={setThinkingMode}
                  />
                </div>
                <aside className="workspace-side-panel" aria-label="行动计划">
                  <div className="workspace-details">
                    <div className="workspace-details-head">
                      <span>行动计划</span>
                      <small>
                        {workspace.result
                          ? `${workspace.result.tasks.filter((task) => task.status === "done").length}/${workspace.result.tasks.length} 项完成`
                          : `${workspace.plan.tasks.length} 项待确认任务`}
                      </small>
                    </div>
                    {!workspace.result ? (
                      <div
                        className="pending-action-plan"
                        role="region"
                        aria-label="待确认的行动计划"
                        tabIndex={0}
                      >
                        {workspace.plan.routes.find(
                          (item) => item.id === workspace.selectedRouteId,
                        ) && (
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                              className="plan-route-current"
                              key={workspace.selectedRouteId}
                              aria-label="当前选择的执行方向"
                              initial={{ opacity: 0, x: 8 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -8 }}
                              transition={{ duration: 0.18, ease: "easeOut" }}
                            >
                              <span className="plan-route-current-mark">
                                <Check size={14} />
                              </span>
                              <div>
                                <small>当前执行方向</small>
                                <strong>
                                  {
                                    workspace.plan.routes.find(
                                      (item) => item.id === workspace.selectedRouteId,
                                    )?.title
                                  }
                                </strong>
                              </div>
                              <b>
                                {
                                  workspace.plan.routes.find(
                                    (item) => item.id === workspace.selectedRouteId,
                                  )?.fit
                                }
                                %
                              </b>
                            </motion.div>
                          </AnimatePresence>
                        )}
                        {workspace.mode === "live" && workspace.usage && (
                          <div className="plan-usage-brief" aria-label="本次路线规划模型用量">
                            <Sparkles size={15} />
                            <span>
                              {workspace.usage.model} · 规划阶段 · {workspace.usage.requests} 次请求
                            </span>
                            <strong>
                              {workspace.usage.totalTokens.toLocaleString("zh-CN")} tokens ·{" "}
                              {(workspace.usage.latencyMs / 1000).toFixed(1)} 秒
                            </strong>
                            {!workspace.result && currentWorkspaceFlashCostEstimate && (
                              <small
                                className="workspace-flash-cost-estimate"
                                title="仅对当前目标已记录的 DeepSeek Flash 用量按当前公开美元价回算；不等于历史人民币账单，也不含未知模型或汇率。"
                              >
                                当前价费用估值{" "}
                                {formatEstimatedUsd(currentWorkspaceFlashCostEstimate.lowerUsd)} –{" "}
                                {formatEstimatedUsd(currentWorkspaceFlashCostEstimate.upperUsd)}
                              </small>
                            )}
                          </div>
                        )}
                        <div className="section-title planned-task-title">
                          <span>
                            <Target size={16} /> 行动计划{" "}
                            <small>{workspace.plan.tasks.length}</small>
                          </span>
                          <span>确认后开始推进</span>
                        </div>
                        <div className="planned-task-list">
                          {workspace.plan.tasks.map((task, index) => (
                            <article key={`${task.title}-${index}`}>
                              <span>{String(index + 1).padStart(2, "0")}</span>
                              <div>
                                <strong>{task.title}</strong>
                                <small>
                                  {task.phase} · {task.detail}
                                </small>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="execution"
                        role="region"
                        aria-label="行动计划、任务与时间线"
                        tabIndex={0}
                      >
                        <section className="execution-main">
                          <div className="section-title">
                            <span>
                              <Target size={17} /> 行动计划{" "}
                              <small>
                                {
                                  workspace.result.tasks.filter((item) => item.status === "done")
                                    .length
                                }
                                /{workspace.result.tasks.length}
                              </small>
                            </span>
                            <span>点击任务标记完成</span>
                          </div>
                          <div className="progress-overview">
                            <div>
                              <span>任务确认进度</span>
                              <strong>
                                {workspace.result.tasks.length
                                  ? Math.round(
                                      (workspace.result.tasks.filter(
                                        (item) => item.status === "done",
                                      ).length /
                                        workspace.result.tasks.length) *
                                        100,
                                    )
                                  : 0}
                                %
                              </strong>
                            </div>
                            <div className="progress-track">
                              <i
                                style={{
                                  width: `${workspace.result.tasks.length ? (workspace.result.tasks.filter((item) => item.status === "done").length / workspace.result.tasks.length) * 100 : 0}%`,
                                }}
                              />
                            </div>
                          </div>
                          {workspace.mode === "live" && workspace.usage && (
                            <div
                              className="usage-strip workspace-plan-usage"
                              aria-label="当前目标累计模型用量"
                            >
                              <div>
                                <span>当前目标累计用量</span>
                                <strong>
                                  {workspace.usage.totalTokens.toLocaleString("zh-CN")} tokens
                                </strong>
                              </div>
                              <small>
                                输入 {workspace.usage.inputTokens.toLocaleString("zh-CN")}
                                {workspace.usage.cachedInputTokens !== undefined &&
                                  "（缓存命中 " +
                                    workspace.usage.cachedInputTokens.toLocaleString("zh-CN") +
                                    "）"}
                                {" · 输出 "}
                                {workspace.usage.outputTokens.toLocaleString("zh-CN")}
                              </small>
                              {workspace.usage.cacheMeasuredInputTokens !== undefined &&
                              workspace.usage.cacheMeasuredInputTokens > 0 ? (
                                <small
                                  title={`命中率 = 供应商报告的缓存命中输入 Token ÷ 已统计输入 Token。${workspaceCacheCoverage?.title ?? ""} 按 Token 加权，不是命中请求占比；未提供统计的请求不参与。缓存只影响输入费，不影响输出费。`}
                                >
                                  输入 Token 缓存命中率{" "}
                                  {(
                                    ((workspace.usage.cacheMeasuredHitTokens || 0) /
                                      workspace.usage.cacheMeasuredInputTokens) *
                                    100
                                  ).toFixed(1)}
                                  % · {workspaceCacheCoverage?.label}（
                                  {workspaceCacheCoverage?.measured.toLocaleString("zh-CN")}/
                                  {workspaceCacheCoverage?.total.toLocaleString("zh-CN")}）
                                </small>
                              ) : (
                                <small
                                  title={`供应商未提供缓存统计字段，无法计算输入缓存命中率。${workspaceCacheCoverage?.title ?? ""}`}
                                >
                                  输入 Token 缓存命中率暂无样本 · {workspaceCacheCoverage?.label}（
                                  {workspaceCacheCoverage?.measured.toLocaleString("zh-CN")}/
                                  {workspaceCacheCoverage?.total.toLocaleString("zh-CN")}）
                                </small>
                              )}
                              {currentWorkspaceFlashCostEstimate && (
                                <small
                                  className="workspace-flash-cost-estimate"
                                  title="仅对当前目标已记录的 DeepSeek Flash 用量按当前公开美元价回算；不等于历史人民币账单，也不含未知模型或汇率。"
                                >
                                  Flash 当前价费用估值：
                                  {formatEstimatedUsd(currentWorkspaceFlashCostEstimate.lowerUsd)} –
                                  {formatEstimatedUsd(currentWorkspaceFlashCostEstimate.upperUsd)}
                                </small>
                              )}
                              <small>
                                {workspace.usage.model} · {workspace.usage.requests} 次请求 ·{" "}
                                {(workspace.usage.latencyMs / 1000).toFixed(1)} 秒
                              </small>
                            </div>
                          )}
                          {workspace.result.budget && (
                            <div
                              className={`budget-control budget-${workspace.result.budget.status}`}
                            >
                              <div className="budget-control-head">
                                <span>
                                  <Target size={16} /> 预算约束核验
                                </span>
                                <strong>
                                  {workspace.result.budget.status === "over"
                                    ? "超过预算上限"
                                    : workspace.result.budget.status === "within"
                                      ? "预算范围内"
                                      : "尚未设置上限"}
                                </strong>
                              </div>
                              <div className="budget-control-values">
                                <div>
                                  <small>当前方案估算</small>
                                  <b>¥{workspace.result.budget.total.toLocaleString("zh-CN")}</b>
                                </div>
                                <div>
                                  <small>预算上限</small>
                                  <b>
                                    {workspace.result.budget.limit === null
                                      ? "未提供"
                                      : `¥${workspace.result.budget.limit.toLocaleString("zh-CN")}`}
                                  </b>
                                </div>
                                {workspace.result.budget.remaining !== null && (
                                  <div>
                                    <small>
                                      {workspace.result.budget.remaining < 0
                                        ? "超出金额"
                                        : "可用余额"}
                                    </small>
                                    <b>
                                      {workspace.result.budget.remaining < 0 ? "−" : ""}¥
                                      {Math.abs(workspace.result.budget.remaining).toLocaleString(
                                        "zh-CN",
                                      )}
                                    </b>
                                  </div>
                                )}
                              </div>
                              <p>
                                {workspace.result.budget.status === "over"
                                  ? "这版费用估算高于你给出的上限。调整范围或补充优先级后，可以让 Agent 重新核算。"
                                  : workspace.result.budget.status === "within"
                                    ? "费用项目已与目标预算逐项比对；这是规划估算，实际支出仍需按现场报价确认。"
                                    : "已汇总费用项目。补充预算上限后，Agent 可以在后续执行中检查是否超支。"}
                              </p>
                            </div>
                          )}
                          <div className="task-list" aria-busy={savingTaskId !== null}>
                            {workspace.result.tasks.map((task, index) => (
                              <motion.button
                                key={task.id}
                                className={task.status === "done" ? "done" : ""}
                                aria-pressed={task.status === "done"}
                                disabled={
                                  activeWorkspaceAccess === "viewer" ||
                                  busy !== null ||
                                  savingTaskId !== null
                                }
                                onClick={() => toggleTask(task.id)}
                                layout
                                whileHover={
                                  activeWorkspaceAccess !== "viewer" &&
                                  busy === null &&
                                  savingTaskId === null
                                    ? { x: 2 }
                                    : undefined
                                }
                                whileTap={
                                  activeWorkspaceAccess !== "viewer" &&
                                  busy === null &&
                                  savingTaskId === null
                                    ? { scale: 0.995 }
                                    : undefined
                                }
                                transition={{ type: "spring", stiffness: 480, damping: 36 }}
                              >
                                <span className="task-check">
                                  <AnimatePresence mode="wait" initial={false}>
                                    {savingTaskId === task.id ? (
                                      <motion.span
                                        key="saving"
                                        initial={{ opacity: 0, scale: 0.65 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.65 }}
                                        transition={{ duration: 0.16 }}
                                        aria-label="正在保存任务状态"
                                      >
                                        <LoaderCircle size={15} className="chat-spinner" />
                                      </motion.span>
                                    ) : task.status === "done" ? (
                                      <motion.span
                                        key="done"
                                        initial={{ opacity: 0, scale: 0.65, rotate: -12 }}
                                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                                        exit={{ opacity: 0, scale: 0.65, rotate: 12 }}
                                        transition={{ duration: 0.16 }}
                                      >
                                        <Check size={15} />
                                      </motion.span>
                                    ) : (
                                      <motion.span
                                        key="pending"
                                        initial={{ opacity: 0, scale: 0.65 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.65 }}
                                        transition={{ duration: 0.16 }}
                                      >
                                        <Circle size={17} />
                                      </motion.span>
                                    )}
                                  </AnimatePresence>
                                </span>
                                <span className="task-index">
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <span className="task-copy">
                                  <strong>{task.title}</strong>
                                  <small>{task.detail}</small>
                                </span>
                                <span className="phase">{task.phase}</span>
                              </motion.button>
                            ))}
                          </div>
                          <div className="section-title timeline-title">
                            <span>
                              <Clock3 size={17} /> 推进时间线
                            </span>
                            {calendarScheduleInfo?.eventCount ? (
                              <button
                                className="timeline-export"
                                type="button"
                                onClick={requestCalendarExport}
                              >
                                <CalendarDays size={14} /> 导出日历
                              </button>
                            ) : (
                              <span>Agent 整理的关键节点</span>
                            )}
                          </div>
                          <div className="timeline">
                            {sortMilestonesChronologically(workspace.result.milestones).map(
                              (item, index) => (
                                <div key={index}>
                                  <span className="timeline-dot" />
                                  <span className="timeline-date">{item.date}</span>
                                  <span>
                                    <strong>{item.label}</strong>
                                    <small>{item.note}</small>
                                  </span>
                                </div>
                              ),
                            )}
                            {workspace.result.milestones.length === 0 && (
                              <p>补充日期后，可重新规划时间线。</p>
                            )}
                          </div>
                          {calendarExportStatus && (
                            <p
                              className={`calendar-export-status ${calendarExportStatus.kind}`}
                              role={calendarExportStatus.kind === "error" ? "alert" : "status"}
                            >
                              {calendarExportStatus.message}
                            </p>
                          )}
                        </section>
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </section>
          )}
          {view === "knowledge" && <KnowledgeView userId={user.id} />}
          {view === "account" && (
            <AccountView
              user={user}
              onUserUpdated={setUser}
              onWorkspacesImported={async () => {
                await loadHistory();
                await queryClient.invalidateQueries({
                  queryKey: ["knowledge", user.id],
                  refetchType: "all",
                });
              }}
            />
          )}
          {view === "history" && (
            <section className="listing">
              <div className="listing-head">
                <p className="eyebrow">
                  <span className="pulse" /> YOUR JOURNEYS
                </p>
                <h1>每个目标，都在向前。</h1>
                <p>回到任意工作空间，继续推进或调整方向。</p>
              </div>
              <div className="listing-bar">
                <span>{history.length} 个工作空间</span>
                <button className="button-outline" onClick={() => navigate("home")}>
                  <Plus size={16} /> 新建目标
                </button>
              </div>
              {historyStatus === "error" && (
                <div className="history-load-error" role="alert">
                  <span>列表读取失败，已有工作空间没有被删除。</span>
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      void loadHistory();
                    }}
                  >
                    重试加载
                  </button>
                </div>
              )}
              <div className="history-grid">
                {history.map((item) => (
                  <article key={item.id}>
                    <button
                      className="history-card-open"
                      type="button"
                      onClick={() => openWorkspace(item)}
                      aria-label={`打开工作区：${item.plan.title}`}
                    >
                      <span className="history-card-category">
                        {item.plan.category}
                        {workspaceAccessById[item.id] && workspaceAccessById[item.id] !== "owner"
                          ? ` · ${workspaceAccessById[item.id] === "editor" ? "共享编辑" : "只读共享"}`
                          : ""}
                      </span>
                      <h3>{item.plan.title}</h3>
                      <p>{item.prompt}</p>
                      <footer>
                        <span>
                          <Clock3 size={14} /> {shortDate(item.createdAt)}
                        </span>
                      </footer>
                    </button>
                    {(!workspaceAccessById[item.id] ||
                      workspaceAccessById[item.id] === "owner") && (
                      <button
                        className="history-card-delete"
                        type="button"
                        onClick={() =>
                          setConfirmation({
                            title: "删除这个目标？",
                            description: `「${item.plan.title}」及其路线、任务和执行记录都会永久删除，无法恢复。`,
                            confirmLabel: "删除目标",
                            tone: "danger",
                            onConfirm: () => remove(item.id),
                          })
                        }
                        aria-label={`删除目标：${item.plan.title}`}
                        title="删除目标"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </article>
                ))}
                {history.length === 0 && historyStatus === "loading" && (
                  <div className="history-empty" role="status" aria-live="polite">
                    <Compass size={35} />
                    <h3>正在读取你的目标</h3>
                    <p>正在从工作空间加载已保存的数据…</p>
                  </div>
                )}
                {history.length === 0 && historyStatus === "ready" && (
                  <div className="history-empty">
                    <Compass size={35} />
                    <h3>还没有开始的目标</h3>
                    <p>从一句想法开始，Agent 会建立第一个工作空间。</p>
                    <button className="button-primary" onClick={() => navigate("home")}>
                      提出目标 <ArrowRight size={17} />
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
          {view === "admin" && (
            <section className="listing admin">
              <div className="listing-head">
                <p className="eyebrow">
                  <span className="pulse" /> SYSTEM OVERVIEW
                </p>
                <h1>管理控制台</h1>
                <p>查看平台运行概况、用户与目标工作空间。</p>
              </div>
              {admin ? (
                <>
                  <div className="admin-stats">
                    <div>
                      <span>注册用户</span>
                      <strong>{admin.userCount.toString().padStart(2, "0")}</strong>
                      <Users size={22} />
                    </div>
                    <div>
                      <span>工作空间</span>
                      <strong>{admin.workspaceCount.toString().padStart(2, "0")}</strong>
                      <FolderKanban size={22} />
                    </div>
                    <div>
                      <span>已执行目标</span>
                      <strong>{admin.completedCount.toString().padStart(2, "0")}</strong>
                      <Zap size={22} />
                    </div>
                    <div className="admin-usage-stat">
                      <span>累计 AI Token</span>
                      <strong>{admin.aiUsage.totalTokens.toLocaleString("zh-CN")}</strong>
                      <small>
                        {admin.aiUsage.requests.toLocaleString("zh-CN")} 次请求 · 平均{" "}
                        {admin.aiUsage.averageLatencyMs.toLocaleString("zh-CN")} ms
                      </small>
                      <small>
                        输入 {admin.aiUsage.inputTokens.toLocaleString("zh-CN")} · 缓存命中{" "}
                        {admin.aiUsage.cachedInputTokens.toLocaleString("zh-CN")} · 输出{" "}
                        {admin.aiUsage.outputTokens.toLocaleString("zh-CN")}
                      </small>
                      <small
                        title={`命中率 = 供应商报告的缓存命中输入 Token ÷ 已统计输入 Token。${adminCacheCoverage?.title ?? ""} 按 Token 加权，不是命中请求占比；未提供统计的请求不参与。缓存只影响输入费，不影响输出费。`}
                      >
                        {admin.aiUsage.cacheMeasuredInputTokens > 0
                          ? "输入 Token 缓存命中率 " +
                            (
                              (admin.aiUsage.cacheMeasuredHitTokens /
                                admin.aiUsage.cacheMeasuredInputTokens) *
                              100
                            ).toFixed(1) +
                            "% · 缓存统计覆盖 " +
                            (adminCacheCoverage?.percent.toFixed(1) ?? "0.0") +
                            "%"
                          : "输入 Token 缓存命中率暂无样本 · 缓存统计覆盖 " +
                            (adminCacheCoverage?.percent.toFixed(1) ?? "0.0") +
                            "%"}
                      </small>
                      {adminAiCostEstimate && (
                        <small
                          className="admin-cost-estimate"
                          title="按 2026-11-13 的 DeepSeek V4.1 Flash 公开美元单价回算 DeepSeek Flash 及其当前计费别名的历史 Token；低值假设未测输入命中缓存且全部为非高峰计费，高值假设未测输入未命中且全部为高峰计费。其它或未知模型、历史单价、人民币换算、赠送额度及独立搜索/抓取费用不包含在内，实际账单请以 DeepSeek 平台为准。"
                        >
                          当前价回算估值：
                          {formatEstimatedUsd(adminAiCostEstimate.lowerUsd)} –
                          {formatEstimatedUsd(adminAiCostEstimate.upperUsd)}
                        </small>
                      )}
                      {adminAiCostEstimate?.measuredHitTokens ? (
                        <small title="只按供应商明确报告的缓存命中 Token 计算相对缓存未命中的输入节省；仅限 DeepSeek Flash 及其当前计费别名，并使用 2026-11-13 公开价，不推测没有缓存统计的请求。">
                          已确认缓存命中可少付输入费约{" "}
                          {formatEstimatedUsd(adminAiCostEstimate.confirmedCacheSavingsUsd.lower)} –
                          {formatEstimatedUsd(adminAiCostEstimate.confirmedCacheSavingsUsd.upper)}
                        </small>
                      ) : null}
                      <WandSparkles size={22} />
                    </div>
                  </div>
                  <section className="usage-panel" aria-labelledby="usage-panel-title">
                    <div className="usage-panel-head">
                      <div>
                        <span>LAST 7 DAYS · ASIA/SHANGHAI</span>
                        <h2 id="usage-panel-title">AI 调用趋势</h2>
                      </div>
                      <div className="usage-total">
                        <strong>
                          {admin.dailyAiUsage
                            .reduce((total, item) => total + item.totalTokens, 0)
                            .toLocaleString("zh-CN")}
                        </strong>
                        <small>近 7 日 Token</small>
                      </div>
                    </div>
                    <p className="usage-note">
                      Token 用量用于定位消耗来源，不等同人民币账单金额；实际费用以 DeepSeek
                      开放平台为准。
                    </p>
                    {(() => {
                      const days = admin.dailyAiUsage;
                      const maximum = Math.max(0, ...days.map((item) => item.totalTokens));
                      const planningRequests = days.reduce(
                        (total, item) => total + item.planningRequests,
                        0,
                      );
                      const dialogueRequests = days.reduce(
                        (total, item) => total + item.dialogueRequests,
                        0,
                      );
                      const workbenchRequests = days.reduce(
                        (total, item) => total + item.workbenchRequests,
                        0,
                      );
                      const healthcheckRequests = days.reduce(
                        (total, item) => total + item.healthcheckRequests,
                        0,
                      );
                      const legacyRequests = days.reduce(
                        (total, item) => total + item.legacyRequests,
                        0,
                      );
                      const cachedInputTokens = days.reduce(
                        (total, item) => total + item.cachedInputTokens,
                        0,
                      );
                      const cacheMeasuredInputTokens = days.reduce(
                        (total, item) => total + item.cacheMeasuredInputTokens,
                        0,
                      );
                      const cacheMeasuredHitTokens = days.reduce(
                        (total, item) => total + item.cacheMeasuredHitTokens,
                        0,
                      );
                      const totalInputTokens = days.reduce(
                        (total, item) => total + item.inputTokens,
                        0,
                      );
                      const cacheCoverage = getInputCacheCoverage(
                        totalInputTokens,
                        cacheMeasuredInputTokens,
                      );
                      const totalRequests = days.reduce((total, item) => total + item.requests, 0);
                      const averageLatencyMs = totalRequests
                        ? Math.round(
                            days.reduce((total, item) => total + item.latencyMs, 0) / totalRequests,
                          )
                        : 0;
                      return (
                        <>
                          <div
                            className="usage-chart"
                            role="img"
                            aria-label={`近七日 AI 请求量：规划 ${planningRequests} 次，对话 ${dialogueRequests} 次，工作台 ${workbenchRequests} 次，连接诊断 ${healthcheckRequests} 次，旧记录 ${legacyRequests} 次`}
                          >
                            {days.map((item) => {
                              const height = maximum
                                ? Math.max(5, (item.totalTokens / maximum) * 100)
                                : 3;
                              const value =
                                item.totalTokens >= 1000
                                  ? `${(item.totalTokens / 1000).toFixed(1)}k`
                                  : item.totalTokens.toString();
                              return (
                                <div
                                  className="usage-day"
                                  key={item.date}
                                  title={`${item.date} · ${item.totalTokens.toLocaleString("zh-CN")} Token · ${item.requests} 次请求`}
                                >
                                  <span>{value}</span>
                                  <div className="usage-bar-track">
                                    <i style={{ height: `${height}%` }} />
                                  </div>
                                  <small>{item.label}</small>
                                </div>
                              );
                            })}
                          </div>
                          <p className="usage-breakdown">
                            <span>{planningRequests.toLocaleString("zh-CN")} 次规划</span>
                            <span>{dialogueRequests.toLocaleString("zh-CN")} 次对话</span>
                            <span>{workbenchRequests.toLocaleString("zh-CN")} 次工作台执行</span>
                            <span>{healthcheckRequests.toLocaleString("zh-CN")} 次连接诊断</span>
                            {legacyRequests > 0 && (
                              <span title="这些历史记录未保存来源分类。">
                                {legacyRequests.toLocaleString("zh-CN")} 次旧记录
                              </span>
                            )}
                            <span>
                              输入缓存命中 {cachedInputTokens.toLocaleString("zh-CN")} tokens
                            </span>
                            <span
                              title={`命中率 = 供应商报告的缓存命中输入 Token ÷ 已统计输入 Token。${cacheCoverage.title} 按 Token 加权，不是命中请求占比；未提供统计的请求不参与。缓存只影响输入费，不影响输出费。`}
                            >
                              {cacheMeasuredInputTokens > 0
                                ? "输入 Token 缓存命中率 " +
                                  (
                                    (cacheMeasuredHitTokens / cacheMeasuredInputTokens) *
                                    100
                                  ).toFixed(1) +
                                  "% · 覆盖 " +
                                  cacheCoverage.percent.toFixed(1) +
                                  "%"
                                : "暂无缓存统计样本 · 覆盖 " +
                                  cacheCoverage.percent.toFixed(1) +
                                  "%"}
                            </span>
                            <span>平均响应 {averageLatencyMs.toLocaleString("zh-CN")} ms</span>
                          </p>
                        </>
                      );
                    })()}
                  </section>
                  <section className={`ai-health ai-health-${aiHealth.state}`}>
                    <div className="ai-health-mark">
                      <Sparkles size={19} />
                    </div>
                    <div className="ai-health-copy">
                      <span>AI SERVICE · DEEPSEEK V4.1 FLASH</span>
                      <strong>
                        {aiHealth.state === "connected"
                          ? `${aiHealth.message} · ${aiHealth.latencyMs} ms`
                          : aiHealth.state === "checking"
                            ? aiHealth.message
                            : aiHealth.state === "error"
                              ? aiHealth.message
                              : aiConfigured
                                ? "Key 已配置，尚未进行连接检查"
                                : "尚未配置 Key · 可继续使用演示模式"}
                      </strong>
                      {aiHealth.state === "connected" && (
                        <small>{aiHealth.model} · 仅发送最小连接探测，不提交用户资料</small>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={checkAiConnection}
                      disabled={!aiConfigured || aiHealth.state === "checking"}
                    >
                      {aiHealth.state === "checking"
                        ? "正在检查…"
                        : aiHealth.state === "connected" || aiHealth.state === "error"
                          ? "重新检查"
                          : "测试连接"}
                      <ArrowRight size={15} />
                    </button>
                    <span className="sr-only" role="status" aria-live="polite">
                      {aiHealth.message}
                    </span>
                  </section>
                  <div className="admin-table">
                    <h2>
                      用户 <small>平台账户概览</small>
                    </h2>
                    <div className="table-scroll">
                      <table aria-label="平台用户">
                        <thead>
                          <tr>
                            <th scope="col">用户</th>
                            <th scope="col">邮箱</th>
                            <th scope="col">权限</th>
                            <th scope="col">加入时间</th>
                            <th scope="col">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {admin.users.map((item) => (
                            <tr key={item.id}>
                              <td data-label="用户">
                                <span className="admin-user-cell">
                                  <i>{item.name.slice(0, 1)}</i>
                                  <span>{item.name}</span>
                                </span>
                              </td>
                              <td data-label="邮箱">
                                <span>{item.email}</span>
                              </td>
                              <td data-label="权限">
                                <span className="role">
                                  {item.role === "admin" ? "管理员" : "成员"}
                                </span>
                              </td>
                              <td data-label="加入时间">
                                <span>{shortDate(item.created_at)}</span>
                              </td>
                              <td data-label="操作">
                                {item.id !== user.id && (
                                  <div className="admin-actions">
                                    <button
                                      className="table-action"
                                      onClick={() => {
                                        const role = item.role === "admin" ? "member" : "admin";
                                        setConfirmation({
                                          title: "调整账户权限？",
                                          description:
                                            role === "admin"
                                              ? `将「${item.name}」设为管理员后，对方可以查看所有用户与工作空间，并管理账户权限。`
                                              : `将「${item.name}」设为成员后，对方将失去管理后台权限。`,
                                          confirmLabel:
                                            role === "admin" ? "设为管理员" : "设为成员",
                                          tone: "access",
                                          onConfirm: () => changeRole(item.id, role),
                                        });
                                      }}
                                    >
                                      {item.role === "admin" ? "设为成员" : "设为管理员"}
                                    </button>
                                    <button
                                      className="table-action danger"
                                      onClick={() =>
                                        setConfirmation({
                                          title: "删除这个账户？",
                                          description: `「${item.name}」的账户、工作空间和知识资料都会永久删除，无法恢复。`,
                                          confirmLabel: "删除账户和资料",
                                          tone: "danger",
                                          onConfirm: () => adminRemoveUser(item),
                                        })
                                      }
                                      aria-label={`删除账户：${item.name}`}
                                    >
                                      删除账户
                                    </button>
                                  </div>
                                )}
                                {item.id === user.id && (
                                  <span className="admin-current-user">当前账户</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="admin-table">
                    <h2>
                      最近的目标 <small>按最后更新时间排序 · Token 按规划、对话和工作台拆分</small>
                    </h2>
                    <div className="table-scroll">
                      <table aria-label="最近的目标工作空间">
                        <thead>
                          <tr>
                            <th scope="col">目标</th>
                            <th scope="col">类型</th>
                            <th scope="col">创建者</th>
                            <th scope="col">AI 用量</th>
                            <th scope="col">更新时间</th>
                            <th scope="col">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {admin.workspaces.map((item) => (
                            <tr key={item.id}>
                              <td data-label="目标">
                                <span>{item.title}</span>
                              </td>
                              <td data-label="类型">
                                <span>{item.category}</span>
                              </td>
                              <td data-label="创建者">
                                <span>{item.owner}</span>
                              </td>
                              <td data-label="AI 用量">
                                <div className="admin-workspace-usage">
                                  <span>
                                    {item.aiTokens.toLocaleString("zh-CN")} tokens ·{" "}
                                    {item.aiRequests} 次模型请求
                                  </span>
                                  <small className="admin-workspace-usage-detail">
                                    规划 {item.plannerTokens.toLocaleString("zh-CN")} · 对话{" "}
                                    {item.dialogueTokens.toLocaleString("zh-CN")} · 工作台{" "}
                                    {item.workbenchTokens.toLocaleString("zh-CN")}
                                    {item.legacyTokens > 0 &&
                                      ` · 旧记录 ${item.legacyTokens.toLocaleString("zh-CN")}`}
                                  </small>
                                  {(() => {
                                    const estimate = adminWorkspaceCostEstimates.get(item.id);
                                    if (
                                      !estimate ||
                                      item.flashInputTokens + item.flashOutputTokens === 0
                                    )
                                      return null;
                                    const cacheCoverage = getInputCacheCoverage(
                                      item.flashInputTokens,
                                      item.flashCacheMeasuredInputTokens,
                                    );
                                    const cacheHitRate =
                                      estimate.measuredInputTokens > 0
                                        ? (estimate.measuredHitTokens /
                                            estimate.measuredInputTokens) *
                                          100
                                        : null;
                                    return (
                                      <>
                                        <small className="admin-workspace-cost">
                                          Flash 当前价估值：{formatEstimatedUsd(estimate.lowerUsd)}{" "}
                                          – {formatEstimatedUsd(estimate.upperUsd)}
                                        </small>
                                        <small
                                          className="admin-workspace-cache"
                                          title={`${cacheCoverage.title} 命中率按供应商已统计输入 Token 加权计算，不是命中请求占比。`}
                                        >
                                          输入 Token 缓存命中率：
                                          {cacheHitRate === null
                                            ? "暂无样本"
                                            : `${cacheHitRate.toFixed(1)}%`}
                                          {` · ${cacheCoverage.label}（${cacheCoverage.measured.toLocaleString("zh-CN")}/${cacheCoverage.total.toLocaleString("zh-CN")}）`}
                                        </small>
                                        {estimate.measuredHitTokens > 0 && (
                                          <small className="admin-workspace-savings">
                                            已确认缓存节省：
                                            {formatEstimatedUsd(
                                              estimate.confirmedCacheSavingsUsd.lower,
                                            )}{" "}
                                            –{" "}
                                            {formatEstimatedUsd(
                                              estimate.confirmedCacheSavingsUsd.upper,
                                            )}
                                          </small>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </td>
                              <td data-label="更新时间">
                                <span>{shortDate(item.updated_at)}</span>
                              </td>
                              <td data-label="操作">
                                <button
                                  className="table-action danger"
                                  aria-label={`删除工作空间：${item.title}`}
                                  onClick={() =>
                                    setConfirmation({
                                      title: "删除这个工作空间？",
                                      description: `「${item.title}」及其执行记录将永久删除，无法恢复。`,
                                      confirmLabel: "删除工作空间",
                                      tone: "danger",
                                      onConfirm: () => adminRemove(item.id),
                                    })
                                  }
                                >
                                  删除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <p className="admin-loading">正在载入控制台…</p>
              )}
            </section>
          )}
        </main>
      </div>
      <AnimatePresence>
        {sharingOpen && workspace && activeWorkspaceAccess === "owner" && (
          <motion.div
            className="modal-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSharingOpen(false)}
          >
            <motion.section
              className="share-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="share-dialog-title"
              onClick={(event) => event.stopPropagation()}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
            >
              <div className="modal-top">
                <span className="step-label">WORKSPACE SHARING</span>
                <button
                  type="button"
                  onClick={() => setSharingOpen(false)}
                  aria-label="关闭共享设置"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="modal-icon">
                <Users size={24} />
              </div>
              <h2 id="share-dialog-title">邀请成员协作</h2>
              <p>
                成员需要登录后接受邀请。编辑者可以继续和 Agent
                协作；只读成员只能查看对话、进度和成果。
              </p>

              <div className="share-create-row">
                <label>
                  <span>成员权限</span>
                  <select
                    value={shareRole}
                    onChange={(event) => setShareRole(event.target.value as "editor" | "viewer")}
                  >
                    <option value="editor">可编辑与协作</option>
                    <option value="viewer">只读查看</option>
                  </select>
                </label>
                <label>
                  <span>有效期</span>
                  <select
                    value={shareExpiryDays}
                    onChange={(event) =>
                      setShareExpiryDays(Number(event.target.value) as 1 | 7 | 30)
                    }
                  >
                    <option value={1}>1 天</option>
                    <option value={7}>7 天</option>
                    <option value={30}>30 天</option>
                  </select>
                </label>
                <button
                  className="button-primary"
                  type="button"
                  onClick={() => void createShareLink()}
                  disabled={sharingSaving}
                >
                  {sharingSaving ? (
                    <LoaderCircle className="chat-spinner" size={16} />
                  ) : (
                    <Share2 size={16} />
                  )}
                  生成邀请链接
                </button>
              </div>

              {newShareUrl && (
                <div className="share-generated-link">
                  <label htmlFor="generated-share-url">新邀请链接（最多 10 人使用）</label>
                  <div>
                    <input
                      id="generated-share-url"
                      readOnly
                      value={newShareUrl}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <button
                      className="button-outline"
                      type="button"
                      onClick={() => void copyShareLink()}
                    >
                      <Copy size={15} />
                      复制
                    </button>
                  </div>
                  <small role="status">
                    {shareCopyNotice || "链接仅显示在这里；离开后请重新生成。"}
                  </small>
                </div>
              )}

              {sharingError && (
                <p className="share-error" role="alert">
                  {sharingError}
                </p>
              )}
              <div className="share-modal-columns">
                <section>
                  <h3>
                    已加入的成员 <span>{shareMembers.length}</span>
                  </h3>
                  {sharingLoading && <p className="share-empty">正在读取共享信息…</p>}
                  {!sharingLoading && shareMembers.length === 0 && (
                    <p className="share-empty">成员接受邀请后会显示在这里。</p>
                  )}
                  {shareMembers.map((member) => (
                    <div className="share-list-row" key={member.id}>
                      <span className="share-member-avatar">
                        {member.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="share-list-copy">
                        <strong>{member.name}</strong>
                        <small>{member.email}</small>
                      </span>
                      <span className="share-role-label">
                        {member.role === "editor" ? "可编辑" : "只读"}
                      </span>
                      <button
                        type="button"
                        className="share-remove-button"
                        disabled={sharingSaving}
                        onClick={() => void updateSharing({ memberId: member.id })}
                        aria-label={`移除成员 ${member.name}`}
                        title="移除成员"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </section>
                <section>
                  <h3>
                    邀请链接{" "}
                    <span>
                      {
                        shareLinks.filter(
                          (link) => !link.revokedAt && Date.parse(link.expiresAt) > Date.now(),
                        ).length
                      }
                      /10
                    </span>
                  </h3>
                  {shareLinks.filter((link) => !link.revokedAt).length === 0 && (
                    <p className="share-empty">暂时没有有效邀请链接。</p>
                  )}
                  {shareLinks
                    .filter((link) => !link.revokedAt)
                    .map((link) => (
                      <div className="share-list-row" key={link.id}>
                        <span className="share-link-icon">
                          <Share2 size={15} />
                        </span>
                        <span className="share-list-copy">
                          <strong>{link.role === "editor" ? "协作编辑" : "只读查看"}</strong>
                          <small>
                            已加入 {link.useCount}/{link.maxUses} 人 · 到期{" "}
                            {new Date(link.expiresAt).toLocaleDateString("zh-CN")}
                          </small>
                        </span>
                        <button
                          type="button"
                          className="share-remove-button"
                          disabled={sharingSaving}
                          onClick={() => void updateSharing({ linkId: link.id })}
                          aria-label="撤销邀请链接"
                          title="撤销邀请链接"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                </section>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {calendarAnchorOpen && (
          <motion.div
            className="modal-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCalendarAnchorOpen(false)}
          >
            <motion.div
              ref={calendarDialogRef}
              className="calendar-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="calendar-dialog-title"
              aria-describedby="calendar-dialog-description"
              tabIndex={-1}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-top">
                <span className="step-label">CALENDAR EXPORT</span>
                <button
                  type="button"
                  onClick={() => setCalendarAnchorOpen(false)}
                  aria-label="关闭日历导出"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="modal-icon">
                <CalendarDays size={25} />
              </div>
              <h2 id="calendar-dialog-title">给相对日程一个开始日期</h2>
              <p id="calendar-dialog-description">
                这份计划使用了“活动当天”或“第 N
                天”这样的相对日期。选择实际开始日期后，系统会据此生成日历文件；计划内容本身不会被修改。
              </p>
              <form onSubmit={submitCalendarExport} className="calendar-export-form" noValidate>
                <label htmlFor="calendar-anchor-date">活动或行程开始日期</label>
                <input
                  ref={calendarAnchorInputRef}
                  id="calendar-anchor-date"
                  aria-label="活动或行程开始日期"
                  type="date"
                  required
                  value={calendarAnchorDate}
                  onChange={(event) => {
                    setCalendarAnchorDate(event.target.value);
                    setCalendarDialogError("");
                  }}
                />
                <small>日历中的时区按中国标准时间（UTC+8）处理。</small>
                {calendarDialogError && (
                  <p className="calendar-export-error" role="alert">
                    {calendarDialogError}
                  </p>
                )}
                <footer>
                  <button
                    className="button-outline"
                    type="button"
                    onClick={() => setCalendarAnchorOpen(false)}
                  >
                    取消
                  </button>
                  <button className="button-primary" type="submit">
                    下载日历文件 <Download size={16} />
                  </button>
                </footer>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {artifact && (
          <motion.div
            className="modal-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeArtifact}
          >
            <motion.div
              className={`artifact-modal ${artifact.type === "code" ? "artifact-modal-code" : ""}`}
              ref={artifactDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="artifact-dialog-title"
              aria-describedby="artifact-dialog-description"
              tabIndex={-1}
              initial={{ opacity: 0, y: 25 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onKeyDown={handleArtifactDialogKeyDown}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-top">
                <span className="step-label">GENERATED ARTIFACT</span>
                <button onClick={closeArtifact} aria-label="关闭产物">
                  <X size={20} />
                </button>
              </div>
              <div className="modal-icon">
                <FileText size={26} />
              </div>
              <h2 id="artifact-dialog-title">{artifact.title}</h2>
              <p id="artifact-dialog-description">{artifact.description}</p>
              {editingArtifact ? (
                <textarea
                  className="artifact-editor"
                  aria-label="编辑方案内容"
                  value={artifactDraft}
                  onChange={(event) => {
                    setArtifactDraft(event.target.value);
                    setArtifactActionStatus(null);
                  }}
                  maxLength={12000}
                />
              ) : (
                <ArtifactPreview artifact={artifact} />
              )}
              {artifactError && (
                <p className="artifact-error" role="alert" aria-live="polite">
                  {artifactError}
                </p>
              )}
              {artifactActionStatus && (
                <p
                  className={`artifact-action-status ${artifactActionStatus.kind}`}
                  role="status"
                  aria-live="polite"
                >
                  {artifactActionStatus.message}
                </p>
              )}
              <footer>
                {(artifact.type === "document" || artifact.type === "pdf") &&
                  (editingArtifact ? (
                    <>
                      <button
                        className="button-outline"
                        onClick={() => {
                          setArtifactDraft(artifact.content);
                          setEditingArtifact(false);
                          setArtifactError("");
                          setArtifactActionStatus(null);
                        }}
                        disabled={savingArtifact}
                      >
                        取消编辑
                      </button>
                      <button
                        className="button-primary"
                        onClick={saveArtifact}
                        disabled={savingArtifact || !artifactDraft.trim()}
                      >
                        <Save size={16} /> {savingArtifact ? "保存中…" : "保存修改"}
                      </button>
                    </>
                  ) : (
                    <button
                      className="button-outline"
                      onClick={() => {
                        setEditingArtifact(true);
                        setArtifactError("");
                        setArtifactActionStatus(null);
                      }}
                    >
                      <Pencil size={16} /> 编辑方案
                    </button>
                  ))}
                <button className="button-outline" onClick={copyArtifact}>
                  <Copy size={16} /> {artifact.type === "code" ? "复制项目源码" : "复制内容"}
                </button>
                {(artifact.type === "document" || artifact.type === "pdf") && (
                  <button
                    className="button-outline"
                    onClick={() => void downloadArtifact("markdown")}
                  >
                    下载 Markdown
                  </button>
                )}
                <button className="button-primary" onClick={() => void downloadArtifact()}>
                  {artifact.type === "code"
                    ? "下载 ZIP 项目"
                    : artifact.type === "spreadsheet"
                      ? "下载 Excel (.xlsx)"
                      : artifact.type === "presentation"
                        ? "下载 PowerPoint (.pptx)"
                        : artifact.type === "pdf"
                          ? "下载 PDF (.pdf)"
                          : artifact.type === "document"
                            ? "下载 Word (.docx)"
                            : "下载 Markdown"}{" "}
                  <Download size={16} />
                </button>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmDialog
        request={confirmation}
        onClose={closeConfirmation}
        onActionError={(cause) =>
          setError(cause instanceof Error ? cause.message : "确认操作失败，请重试。")
        }
      />
    </div>
  );
}
