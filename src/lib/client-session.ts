"use client";

export const clientSession = { epoch: 0 };

let sessionValidation: { epoch: number; promise: Promise<void> } | null = null;

export function reconcileUnauthorizedSession(requestEpoch: number) {
  if (typeof window === "undefined" || requestEpoch !== clientSession.epoch) return;
  if (sessionValidation?.epoch === requestEpoch) return sessionValidation.promise;

  const promise = (async () => {
    // Let successful password or recovery requests install their replacement cookie
    // before deciding that a late 401 means this browser session has expired.
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    if (requestEpoch !== clientSession.epoch) return;
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json().catch(() => null)) as
        | { user?: unknown }
        | null;
      if (requestEpoch !== clientSession.epoch || data?.user) return;
      window.dispatchEvent(
        new CustomEvent("nexora:session-expired", { detail: { epoch: requestEpoch } }),
      );
    } catch {
      // A transient session-check network failure is not proof that the session expired.
    }
  })().finally(() => {
    if (sessionValidation?.promise === promise) sessionValidation = null;
  });
  sessionValidation = { epoch: requestEpoch, promise };
  return promise;
}
