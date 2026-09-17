"use client";

import { Check, Copy } from "lucide-react";
import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachClientCodeView } from "./coach-client-detail-view";
import styles from "./coach-client-code-button.module.css";

export function CoachClientCodeButton({ code, isCopied, isBusy, canCopy, onCopy, size = "detail" }:
  Pick<CoachClientCodeView, "code" | "isCopied" | "isBusy" | "canCopy"> & {
    readonly onCopy?: () => void;
    readonly size?: "detail" | "receipt";
  }) {
  const hasCode = Boolean(code?.trim());
  const available = !isBusy && hasCode && canCopy && Boolean(onCopy);
  const copied = hasCode && isCopied === true;
  return <>
    <button className={styles.code} type="button" aria-label="Copiar código" data-copied={copied}
      disabled={!available} onClick={available ? onCopy : undefined}>
      <span className={styles.value} data-size={size} data-known={code !== null}>{code ?? "—"}</span>
      <span className={styles.icon}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</span>
    </button>
    {copied ? <StatusMessage className={styles.confirmed}>Copiado</StatusMessage> : null}
  </>;
}
