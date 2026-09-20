"use client";

import type { ReactNode } from "react";
import { useOverlayFocusManagement } from "@/ui/overlays/use-overlay-focus-management";
import type { CoachOverlayFocusProps } from "./coach-overlay-view";
import { useCoachOverlayBackground } from "./use-coach-overlay-background";
import styles from "./coach-overlay.module.css";

const ignoreClose = () => {};

/** Local visual variants share the existing keyboard/focus engine. */
export function CoachOverlay({ isOpen, isBusy, isObscured = false, titleId, variant, onCancel,
  backgroundRef, restoreFocusRef, children, footer }: CoachOverlayFocusProps & {
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  readonly isObscured?: boolean;
  readonly titleId: string;
  readonly variant: "fee" | "chat" | "detail" | "dates" | "client-add" | "client-detail" | "client-confirm";
  readonly onCancel?: () => void;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}) {
  // Register inert cleanup before the shared hook restores the opener's focus.
  useCoachOverlayBackground(isOpen, backgroundRef);
  const canClose = !isBusy && !isObscured && Boolean(onCancel);
  const dialogRef = useOverlayFocusManagement<HTMLDivElement>({
    isActive: isOpen, onClose: onCancel ?? ignoreClose, canClose, restoreFocusRef,
  });
  if (!isOpen) return null;
  return (
    <div className={styles.layer} data-variant={variant}>
      <button className={styles.scrim} type="button" aria-label={variant === "dates" || variant === "client-confirm" ? "Cancelar" : "Cerrar"}
        tabIndex={-1} disabled={!canClose} onClick={canClose ? onCancel : undefined} />
      <div className={styles.sheet} data-variant={variant} ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={isBusy}>
        {variant !== "dates" && variant !== "client-confirm" ? <div className={styles.grip} aria-hidden="true"><span /></div> : null}
        {children}
        <div className={styles.footer}>{footer}</div>
      </div>
    </div>
  );
}
