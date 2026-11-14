"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Download,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { clientSession, reconcileUnauthorizedSession } from "@/lib/client-session";
import { accountDataLimits } from "@/lib/limits";

type AccountUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  createdAt: string;
  recoveryCodeConfigured: boolean;
};

export default function AccountView({
  user,
  onUserUpdated,
  onWorkspacesImported,
}: {
  user: AccountUser;
  onUserUpdated: (user: AccountUser) => void;
  onWorkspacesImported: () => void | Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(user.name);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryCopied, setRecoveryCopied] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  async function exportAccountData() {
    setExportMessage("");
    setExportError("");
    const requestEpoch = clientSession.epoch;
    setExportBusy(true);
    try {
      const response = await fetch("/api/account/export", { cache: "no-store" });
      const data = await response.json();
      if (requestEpoch !== clientSession.epoch) return;
      if (!response.ok) {
        if (response.status === 401) void reconcileUnauthorizedSession(requestEpoch);
        throw new Error(data.error || "账户备份生成失败。");
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `vhfxnex-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage("账户资料、工作空间和知识库已导出。请妥善保管备份文件。");
    } catch (cause) {
      if (requestEpoch === clientSession.epoch) {
        setExportError(cause instanceof Error ? cause.message : "账户备份生成失败。");
      }
    } finally {
      if (requestEpoch === clientSession.epoch) setExportBusy(false);
    }
  }

  async function importAccountData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportMessage("");
    setImportError("");
    if (file.size > accountDataLimits.backupBytes) {
      setImportError(`备份文件不能超过 ${accountDataLimits.backupBytes / 1_000_000} MB。`);
      return;
    }

    const requestEpoch = clientSession.epoch;
    setImportBusy(true);
    try {
      const backupText = await file.text();
      const backup = JSON.parse(backupText) as {
        format?: unknown;
        formatVersion?: unknown;
        workspaces?: unknown;
        knowledge?: unknown;
      };
      if (
        backup?.format !== "nexora-account-backup" ||
        backup.formatVersion !== 1 ||
        !Array.isArray(backup.workspaces) ||
        !Array.isArray(backup.knowledge)
      ) {
        throw new Error("这不是受支持的 VHFXNEX 账户备份文件。");
      }

      const response = await fetch("/api/account/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: backupText,
      });
      const data = await response.json();
      if (requestEpoch !== clientSession.epoch) return;
      if (!response.ok) {
        if (response.status === 401) void reconcileUnauthorizedSession(requestEpoch);
        throw new Error(data.error || "账户备份导入失败。");
      }

      await onWorkspacesImported();
      setImportMessage(
        `已导入 ${data.imported.workspaces} 个工作空间和 ${data.imported.knowledge} 篇知识资料；旧数据保留在当前账户。`,
      );
    } catch (cause) {
      if (requestEpoch === clientSession.epoch) {
        setImportError(cause instanceof Error ? cause.message : "账户备份导入失败。");
      }
    } finally {
      if (requestEpoch === clientSession.epoch) setImportBusy(false);
    }
  }

  async function generateRecoveryCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecoveryError("");
    setRecoveryCode("");
    setRecoveryCopied(false);
    const requestEpoch = clientSession.epoch;
    setRecoveryBusy(true);
    try {
      const response = await fetch("/api/auth/recovery-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: recoveryPassword }),
      });
      const data = await response.json();
      if (requestEpoch !== clientSession.epoch) return;
      if (!response.ok) {
        if (response.status === 401) void reconcileUnauthorizedSession(requestEpoch);
        throw new Error(data.error || "恢复码生成失败。");
      }
      setRecoveryCode(data.recoveryCode);
      setRecoveryPassword("");
      onUserUpdated({ ...user, recoveryCodeConfigured: true });
    } catch (cause) {
      if (requestEpoch === clientSession.epoch) {
        setRecoveryError(cause instanceof Error ? cause.message : "恢复码生成失败。");
      }
    } finally {
      if (requestEpoch === clientSession.epoch) setRecoveryBusy(false);
    }
  }

  async function copyRecoveryCode() {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setRecoveryCopied(true);
    } catch {
      setRecoveryError("复制失败，请使用下载文件保存恢复码。");
    }
  }

  function downloadRecoveryCode() {
    const blob = new Blob([`VHFXNEX 账户恢复码\n\n邮箱：${user.email}\n恢复码：${recoveryCode}\n`], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vhfxnex-account-recovery.txt";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function updateName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError("");
    setProfileSuccess("");
    const requestEpoch = clientSession.epoch;
    setProfileBusy(true);
    try {
      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: displayName }),
      });
      const data = await response.json();
      if (requestEpoch !== clientSession.epoch) return;
      if (!response.ok) {
        if (response.status === 401) void reconcileUnauthorizedSession(requestEpoch);
        throw new Error(data.error || "资料更新失败，请稍后重试。");
      }
      onUserUpdated(data.user);
      setDisplayName(data.user.name);
      setProfileSuccess("显示名称已更新。");
    } catch (cause) {
      if (requestEpoch === clientSession.epoch) {
        setProfileError(cause instanceof Error ? cause.message : "资料更新失败，请稍后重试。");
      }
    } finally {
      if (requestEpoch === clientSession.epoch) setProfileBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      setError("新密码长度需为 8～128 位。");
      return;
    }

    const requestEpoch = clientSession.epoch;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (requestEpoch !== clientSession.epoch) return;
      if (!response.ok) {
        if (response.status === 401) void reconcileUnauthorizedSession(requestEpoch);
        throw new Error(data.error || "密码更新失败，请稍后重试。");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("密码已更新，当前设备保持登录，其他设备需要重新登录。");
    } catch (cause) {
      if (requestEpoch === clientSession.epoch) {
        setError(cause instanceof Error ? cause.message : "密码更新失败，请稍后重试。");
      }
    } finally {
      if (requestEpoch === clientSession.epoch) setBusy(false);
    }
  }

  const createdAt = new Date(user.createdAt);
  const createdLabel = Number.isNaN(createdAt.getTime())
    ? "—"
    : createdAt.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

  return (
    <section className="listing account-view">
      <div className="listing-head">
        <p className="eyebrow">
          <span className="pulse" /> YOUR ACCOUNT
        </p>
        <h1>你的空间，由你掌控。</h1>
        <p>查看账户资料，管理登录凭据与设备会话。</p>
      </div>

      <div className="account-grid">
        <section className="account-card account-identity" aria-labelledby="account-identity-title">
          <div className="account-card-heading">
            <span className="account-card-icon">
              <ShieldCheck size={19} />
            </span>
            <div>
              <p className="step-label">ACCOUNT IDENTITY</p>
              <h2 id="account-identity-title">账户资料</h2>
            </div>
          </div>
          <div className="account-identity-main">
            <span className="account-avatar">{user.name.slice(0, 1)}</span>
            <div>
              <h3>{user.name}</h3>
              <p>{user.email}</p>
            </div>
            <span className="account-role">{user.role === "admin" ? "管理员" : "个人空间"}</span>
          </div>
          <form className="account-profile-form" onSubmit={updateName}>
            <label>
              显示名称
              <input
                type="text"
                autoComplete="name"
                minLength={2}
                maxLength={48}
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="输入 2～48 个字符"
              />
            </label>
            {profileError && (
              <p className="account-message account-message-error" role="alert" aria-live="polite">
                {profileError}
              </p>
            )}
            {profileSuccess && (
              <p
                className="account-message account-message-success"
                role="status"
                aria-live="polite"
              >
                {profileSuccess}
              </p>
            )}
            <button
              className="button-outline account-profile-submit"
              type="submit"
              disabled={profileBusy}
            >
              {profileBusy ? "正在保存…" : "保存显示名称"}
            </button>
          </form>
          <div className="account-meta">
            <span>
              <CalendarDays size={16} /> 加入时间
            </span>
            <strong>{createdLabel}</strong>
          </div>
          <p className="account-note">
            邮箱用于账户识别，目前不能在此修改。需要更换邮箱时，请联系空间管理员。
          </p>
        </section>

        <section className="account-card" aria-labelledby="account-password-title">
          <div className="account-card-heading">
            <span className="account-card-icon">
              <KeyRound size={19} />
            </span>
            <div>
              <p className="step-label">PASSWORD & SESSIONS</p>
              <h2 id="account-password-title">更新登录密码</h2>
            </div>
          </div>
          <p className="account-card-intro">
            验证当前密码后设置新密码。更新后，其他设备上的登录会话将失效。
          </p>
          <form className="account-password-form" onSubmit={changePassword}>
            <label>
              当前密码
              <input
                type="password"
                autoComplete="current-password"
                minLength={8}
                maxLength={128}
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="输入当前密码"
              />
            </label>
            <label>
              新密码
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="至少 8 位字符"
              />
            </label>
            <label>
              确认新密码
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再次输入新密码"
              />
            </label>
            {error && (
              <p className="account-message account-message-error" role="alert" aria-live="polite">
                {error}
              </p>
            )}
            {success && (
              <p
                className="account-message account-message-success"
                role="status"
                aria-live="polite"
              >
                <LockKeyhole size={15} /> {success}
              </p>
            )}
            <button className="button-primary account-submit" type="submit" disabled={busy}>
              {busy ? "正在安全更新…" : "更新密码"} <ArrowRight size={16} />
            </button>
          </form>
        </section>

        <section
          className="account-card account-recovery-card"
          aria-labelledby="account-recovery-title"
        >
          <div className="account-card-heading">
            <span className="account-card-icon">
              <ShieldCheck size={19} />
            </span>
            <div>
              <p className="step-label">ACCOUNT RECOVERY</p>
              <h2 id="account-recovery-title">账户恢复码</h2>
            </div>
          </div>
          <p className="account-card-intro">
            生成一组一次性恢复码并保存到安全位置。它可以在忘记密码时重设密码；新码会立即替换旧码。
          </p>
          <p
            className={`account-recovery-status ${user.recoveryCodeConfigured ? "is-ready" : "is-missing"}`}
          >
            <span />
            {user.recoveryCodeConfigured ? "已设置恢复码" : "尚未设置恢复码 · 建议现在生成并保存"}
          </p>
          <form className="account-recovery-form" onSubmit={generateRecoveryCode}>
            <label>
              验证当前密码
              <input
                type="password"
                autoComplete="current-password"
                minLength={8}
                maxLength={128}
                required
                value={recoveryPassword}
                onChange={(event) => setRecoveryPassword(event.target.value)}
                placeholder="输入当前密码以生成或更换恢复码"
              />
            </label>
            <button className="button-outline" type="submit" disabled={recoveryBusy}>
              {recoveryBusy ? "正在生成…" : recoveryCode ? "更换恢复码" : "生成恢复码"}
            </button>
          </form>
          {recoveryError && (
            <p className="account-message account-message-error" role="alert" aria-live="polite">
              {recoveryError}
            </p>
          )}
          {recoveryCode && (
            <div className="account-recovery-result" role="status" aria-live="polite">
              <p>仅显示这一次。请保存后再离开本页。</p>
              <code>{recoveryCode}</code>
              <div>
                <button className="button-outline" type="button" onClick={copyRecoveryCode}>
                  {recoveryCopied ? <Check size={15} /> : <LockKeyhole size={15} />}
                  {recoveryCopied ? "已复制" : "复制恢复码"}
                </button>
                <button className="button-outline" type="button" onClick={downloadRecoveryCode}>
                  <Download size={15} /> 下载文件
                </button>
              </div>
            </div>
          )}
        </section>

        <section
          className="account-card account-export-card"
          aria-labelledby="account-export-title"
        >
          <div className="account-card-heading">
            <span className="account-card-icon">
              <Download size={19} />
            </span>
            <div>
              <p className="step-label">YOUR DATA</p>
              <h2 id="account-export-title">下载账户备份</h2>
            </div>
          </div>
          <p className="account-card-intro">
            导出账户资料、工作空间和知识库内容为 JSON
            文件。备份不含密码、会话或恢复码；导入只合并工作空间与知识资料，不改变当前账户登录信息。
          </p>
          <button
            className="button-outline account-export-button"
            type="button"
            onClick={exportAccountData}
            disabled={exportBusy}
          >
            <Download size={16} /> {exportBusy ? "正在准备备份…" : "下载账户备份"}
          </button>
          <div className="account-import-actions">
            <input
              ref={importInputRef}
              className="sr-only"
              type="file"
              accept=".json,application/json"
              aria-label="选择账户备份文件"
              onChange={importAccountData}
              tabIndex={-1}
            />
            <button
              className="button-outline account-import-button"
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importBusy}
            >
              <Upload size={16} /> {importBusy ? "正在导入并校验…" : "选择备份并导入"}
            </button>
            <span>仅导入工作空间和知识资料；重复导入会生成副本。</span>
          </div>
          {exportMessage && (
            <p className="account-message account-message-success" role="status" aria-live="polite">
              {exportMessage}
            </p>
          )}
          {exportError && (
            <p className="account-message account-message-error" role="alert" aria-live="polite">
              {exportError}
            </p>
          )}
          {importMessage && (
            <p className="account-message account-message-success" role="status" aria-live="polite">
              {importMessage}
            </p>
          )}
          {importError && (
            <p className="account-message account-message-error" role="alert" aria-live="polite">
              {importError}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
