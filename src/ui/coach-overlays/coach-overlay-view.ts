import type { RefObject } from "react";

export interface CoachOverlayFocusProps {
  /** Background sibling, never an ancestor of the dialog. No body/global ref. */
  readonly backgroundRef: RefObject<HTMLElement | null>;
  /**
   * The engine captures this node on open; later ref updates do not retarget restoration.
   * After list mutations, the controller must resolve the current row by identity or
   * an approved stable fallback after closing the overlay.
   */
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
}

export interface CoachOverlayMessageView {
  readonly tone: "polite" | "error";
  /** Existing mapped copy. Presentation never translates server errors. */
  readonly label: string;
}
