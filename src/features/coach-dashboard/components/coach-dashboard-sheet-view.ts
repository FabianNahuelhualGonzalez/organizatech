import type { CoachMetricView } from "./coach-dashboard-view";
import type { CoachOverlayFocusProps as CoachSheetFocusProps, CoachOverlayMessageView as CoachSheetMessageView } from "@/ui/coach-overlays/coach-overlay-view";
export type { CoachOverlayFocusProps as CoachSheetFocusProps, CoachOverlayMessageView as CoachSheetMessageView } from "@/ui/coach-overlays/coach-overlay-view";

export type CoachFeePreset = "25000" | "35000" | "50000";
export interface CoachFeePreviewRowView {
  readonly label: string;
  readonly amount: CoachMetricView;
}

export interface CoachFeeSheetView {
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  readonly feeRaw: string | null;
  readonly selectedPreset: CoachFeePreset | null;
  readonly canSave: boolean;
  /** Field validation only; a server/network failure does not invalidate input. */
  readonly isInvalid: boolean;
  readonly preview: readonly [CoachFeePreviewRowView, CoachFeePreviewRowView, CoachFeePreviewRowView];
  readonly message: CoachSheetMessageView | null;
}

export interface CoachFeeSheetProps extends CoachSheetFocusProps {
  readonly view: CoachFeeSheetView;
  readonly onRawChange?: (raw: string) => void;
  readonly onPreset?: (preset: CoachFeePreset) => void;
  /** Dispatches to the controller, which owns validation, single-flight and persistence. */
  readonly onSave?: () => void;
  readonly onCancel?: () => void;
}

export interface CoachChatComingSoonView {
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  /** true only after actual persisted confirmation; null is not yet known. */
  readonly isRegistered: boolean | null;
  readonly message: CoachSheetMessageView | null;
}

export interface CoachChatComingSoonProps extends CoachSheetFocusProps {
  readonly view: CoachChatComingSoonView;
  readonly onRegister?: () => void;
  readonly onCancel?: () => void;
}
