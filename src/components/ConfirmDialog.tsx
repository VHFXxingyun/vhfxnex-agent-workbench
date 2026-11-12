"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

export type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger" | "access";
  onConfirm: () => void | Promise<void>;
};

export default function ConfirmDialog({
  request,
  onClose,
  onActionError,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
  onActionError: (error: unknown) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmingRef = useRef(false);

  useEffect(() => {
    if (!request) return;
    confirmingRef.current = false;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [request, onClose]);

  if (!request) return null;
  const Icon = request.tone === "danger" ? AlertTriangle : ShieldCheck;

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`confirm-card confirm-${request.tone}`}
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        tabIndex={-1}
      >
        <div className="confirm-icon">
          <Icon size={21} />
        </div>
        <span className="confirm-eyebrow">
          {request.tone === "danger" ? "IRREVERSIBLE ACTION" : "ACCESS CHANGE"}
        </span>
        <h2 id="confirm-title">{request.title}</h2>
        <p id="confirm-description">{request.description}</p>
        <div className="confirm-actions">
          <button className="confirm-cancel" ref={cancelRef} onClick={onClose}>
            先不操作
          </button>
          <button
            className="confirm-submit"
            onClick={() => {
              if (confirmingRef.current) return;
              confirmingRef.current = true;
              const action = request.onConfirm;
              onClose();
              void Promise.resolve()
                .then(action)
                .catch((error: unknown) => onActionError(error));
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
