import type { CoachOverlayFocusProps, CoachOverlayMessageView } from "@/ui/coach-overlays/coach-overlay-view";

export interface CoachClientInstructionView {
  readonly id: string;
  /** Approved copy; do not promise an unimplemented student/profile destination. */
  readonly label: string;
}
export type CoachClientInstructionSteps = readonly [CoachClientInstructionView, CoachClientInstructionView, CoachClientInstructionView];

export interface CoachClientInviteDraftView {
  readonly emailRaw: string;
  readonly validation: {
    readonly tone: "neutral" | "ok" | "err";
    /** Already mapped safely: pending duplicates may identify only the email. */
    readonly errorLabel: string | null;
  };
  readonly canSubmit: boolean;
  readonly action: "submit" | "reconcile" | "retry" | null;
  /** Controlled operation copy: submit, explicit reconciliation or same-intent retry. */
  readonly submitLabel: string;
  readonly busyLabel: string;
  readonly hint: string;
  readonly steps: CoachClientInstructionSteps;
}

export interface CoachClientInvitationReceiptView {
  readonly source: "server";
  /** Acceptance by the provider is not delivery to the recipient's inbox. */
  readonly delivery: "provider-accepted" | "delivered";
  readonly id: string;
  readonly email: string;
  readonly code: string;
  readonly headingLabel: string;
  readonly descriptionLabel: string;
  readonly deliveryLabel: string;
  readonly copyHint: string;
  readonly footerHint: string;
  readonly steps: CoachClientInstructionSteps;
  readonly isCopied: boolean | null;
  readonly canCopy: boolean;
  readonly canShare: boolean;
  readonly canOpenPending: boolean;
}

interface CoachAddClientBase {
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  readonly draft: CoachClientInviteDraftView;
  readonly message: CoachOverlayMessageView | null;
}

export type CoachAddClientView =
  | (CoachAddClientBase & { readonly step: "email"; readonly receipt?: never })
  | (CoachAddClientBase & { readonly step: "receipt"; readonly receipt: CoachClientInvitationReceiptView });

export interface CoachAddClientActions {
  readonly onEmailChange?: (raw: string) => void;
  /** Controller validates, submits, owns single-flight and later provides the receipt. */
  readonly onSubmit?: () => void;
  readonly onCancel?: () => void;
  readonly onCopyCode?: (invitationId: string) => void;
  readonly onShareCode?: (invitationId: string) => void;
  readonly onOpenPendingClients?: (tab: "pending") => void;
}

export interface CoachAddClientSheetProps extends CoachOverlayFocusProps {
  readonly view: CoachAddClientView;
  readonly actions: CoachAddClientActions;
}

/** Presentation guard, not authorization. A reserved/queued request is not a receipt. */
export function isCoachInvitationReceiptReady(receipt: CoachClientInvitationReceiptView | null | undefined): receipt is CoachClientInvitationReceiptView {
  return receipt?.source === "server" && (receipt.delivery === "provider-accepted" || receipt.delivery === "delivered")
    && [receipt.id, receipt.email, receipt.code].every((value) => typeof value === "string" && value.trim().length > 0);
}
