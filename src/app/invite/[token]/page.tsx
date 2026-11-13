"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check, LoaderCircle, LockKeyhole, Users } from "lucide-react";

export default function WorkspaceInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<{ workspaceId: string; workspaceTitle: string; role: "owner" | "editor" | "viewer" } | null>(null);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);

  async function acceptInvite() {
    if (busy || accepted) return;
    setBusy(true);
    setError("");
    setNeedsLogin(false);
    try {
      const response = await fetch("/api/workspace-invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ token: params.token }),
      });
      const result = await response.json();
      if (!response.ok) {
        setNeedsLogin(response.status === 401);
        throw new Error(typeof result.error === "string" ? result.error : "无法接受邀请，请稍后再试。");
      }
      setAccepted(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法连接服务，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="invite-page">
      <section className="invite-card">
        <span className="invite-brand-mark" aria-hidden="true">N</span>
        <p className="step-label">VHFXNEX · WORKSPACE INVITE</p>
        {accepted ? (
          <>
            <div className="invite-state-icon accepted"><Check size={25} /></div>
            <h1>已加入工作区</h1>
            <p><strong>{accepted.workspaceTitle}</strong> 已添加到你的目标列表。</p>
            <p className="invite-role-note">当前权限：{accepted.role === "editor" ? "可编辑与协作" : accepted.role === "viewer" ? "只读查看" : "所有者"}</p>
            <button className="button-primary invite-action" type="button" onClick={() => router.push("/")}>
              前往工作区 <ArrowRight size={17} />
            </button>
          </>
        ) : (
          <>
            <div className="invite-state-icon"><Users size={25} /></div>
            <h1>加入一个协作工作区</h1>
            <p>登录后接受邀请，工作区会出现在“我的目标”中。邀请链接可能过期或被所有者撤销。</p>
            <div className="invite-secure-note"><LockKeyhole size={15} /> 邀请只对登录账户生效，不会公开工作区内容。</div>
            {error && <p className="invite-error" role="alert">{error}</p>}
            {needsLogin && <a className="invite-login-link" href="/" target="_blank" rel="noreferrer">在新标签页登录或注册，完成后返回此页重试</a>}
            <button className="button-primary invite-action" type="button" onClick={() => void acceptInvite()} disabled={busy}>
              {busy ? <LoaderCircle size={17} className="chat-spinner" /> : <Users size={17} />}
              {busy ? "正在接受邀请…" : "接受邀请"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
