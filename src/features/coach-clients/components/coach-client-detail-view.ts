import type { CoachOverlayFocusProps, CoachOverlayMessageView } from "@/ui/coach-overlays/coach-overlay-view";

export interface CoachClientCodeView {
  readonly code: string | null;
  readonly isBusy: boolean;
  readonly isCopied: boolean | null;
  readonly isResent: boolean | null;
  readonly canCopy: boolean;
  readonly canShare: boolean;
  /** Server eligibility: not a per-session UI flag or a locally calculated quota. */
  readonly canResend: boolean;
  readonly resendLabel: string;
  readonly deliveryLabel: string | null;
  readonly expiryLabel: string | null;
  readonly hint: string | null;
  readonly message: CoachOverlayMessageView | null;
}

interface CoachClientDetailBase {
  readonly id: string;
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  readonly canClose: boolean;
  readonly email: string;
  readonly statusDescription: string | null;
  readonly actionLabel: string;
  readonly canAct: boolean;
  readonly message: CoachOverlayMessageView | null;
}

interface CoachClientAuthorizedIdentity {
  /** Authorized current or historical projection, never an account lookup. */
  readonly name: string | null;
  readonly initials: string | null;
}

export type CoachClientDetailView =
  | (CoachClientDetailBase & {
      readonly state: "pending";
      readonly identity?: never;
      readonly name?: never;
      readonly initials?: never;
      readonly facts: { readonly requestedOnLabel: string | null; readonly waitingLabel: string | null };
      readonly code: CoachClientCodeView | null;
    })
  | (CoachClientDetailBase & {
      readonly state: "active";
      readonly identity: CoachClientAuthorizedIdentity;
      readonly facts: { readonly linkedOnLabel: string | null; readonly lastTrainingLabel: string | null; readonly sessionsLabel: string | null };
      /** An active relationship does not imply a cycle exists or a route is authorized. */
      readonly cycle: { readonly label: string | null; readonly canOpen: boolean } | null;
    })
  | (CoachClientDetailBase & {
      readonly state: "inactive";
      readonly identity: CoachClientAuthorizedIdentity;
      readonly facts: { readonly linkedOnLabel: string | null; readonly unlinkedOnLabel: string | null };
      readonly historyNote: string | null;
    });

interface CoachClientConfirmationBase {
  readonly id: string;
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  readonly canConfirm: boolean;
  readonly message: CoachOverlayMessageView | null;
}
export type CoachClientUnlinkConfirmationView =
  | (CoachClientConfirmationBase & { readonly state: "active"; readonly subjectLabel: string })
  | (CoachClientConfirmationBase & { readonly state: "pending"; readonly subjectLabel?: never });

export interface CoachClientDetailActions {
  readonly onCancelDetail?: () => void;
  readonly onOpenCycle?: (id: string) => void;
  readonly onCopyCode?: (id: string) => void;
  readonly onShareCode?: (id: string) => void;
  readonly onResend?: (id: string) => void;
  readonly onRelink?: (email: string) => void;
  readonly onOpenUnlink?: (id: string, state: "active" | "pending") => void;
  readonly onConfirmUnlink?: (id: string, state: "active" | "pending") => void;
  readonly onCancelUnlink?: () => void;
}

export interface CoachClientDetailSheetProps extends CoachOverlayFocusProps {
  readonly view: CoachClientDetailView;
  readonly confirmation: CoachClientUnlinkConfirmationView | null;
  readonly actions: CoachClientDetailActions;
}

export interface CoachClientUnlinkConfirmationProps extends CoachOverlayFocusProps {
  readonly view: CoachClientUnlinkConfirmationView;
  readonly onConfirm?: (id: string, state: "active" | "pending") => void;
  readonly onCancel?: () => void;
}
