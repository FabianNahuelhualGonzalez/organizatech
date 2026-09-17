import type { CoachPaidPeriod } from "../model/coach-payment-period";
import type {
  CoachRenewalBaseline,
  CoachRenewalCivilDateValidation,
  CoachRenewalDates,
  CoachRenewalDraft,
  CoachRenewalPeriodCommand,
  CoachRenewalPeriodTarget,
} from "../model/coach-renewal-draft";

/** Consumer-owned facts. The source validates canonical DTOs and authorization. */
export interface CoachPaidPeriodRead {
  readonly linkEpisodeId: string;
  readonly version: string;
  readonly period: CoachPaidPeriod | null;
}

export interface CoachPaidPeriodOperationReceipt {
  readonly requestId: string;
  readonly action: "confirm" | "correct";
  readonly period: CoachPaidPeriod;
  readonly version: string;
  readonly recordedAt: string;
}

export interface CoachPaidPeriodSourceOptions { readonly signal?: AbortSignal }
export interface CoachPaidPeriodConfirmRequest {
  readonly episodeId: string;
  readonly start: string;
  readonly end: string;
  readonly expectedVersion: string;
  readonly requestId: string;
}
export interface CoachPaidPeriodCorrectRequest extends CoachPaidPeriodConfirmRequest { readonly periodId: string }
export interface CoachPaidPeriodRecordedResult {
  readonly status: "recorded";
  readonly operation: CoachPaidPeriodOperationReceipt;
}

/** The adapter owns UUID/DTO validation, fixed Auth identity and total deadlines. */
export interface CoachPaidPeriodSource {
  readPeriod(episodeId: string, options?: CoachPaidPeriodSourceOptions): Promise<CoachPaidPeriodRead>;
  confirmPeriod(input: CoachPaidPeriodConfirmRequest, options?: CoachPaidPeriodSourceOptions): Promise<CoachPaidPeriodRecordedResult>;
  correctPeriod(input: CoachPaidPeriodCorrectRequest, options?: CoachPaidPeriodSourceOptions): Promise<CoachPaidPeriodRecordedResult>;
  readOwnOperation(requestId: string, options?: CoachPaidPeriodSourceOptions): Promise<CoachPaidPeriodOperationReceipt | null>;
}

export type CoachPaidPeriodControllerIssue = "invalid_binding" | "invalid_request_id" | "draft_changed"
  | "invalid_input" | "invalid_response" | "forbidden" | "not_found" | "inactive_relationship"
  | "request_conflict" | "version_conflict" | "conflict" | "operation_stale" | "aborted" | "timeout" | "unavailable";

/** Immutable sent intent. Resolved/rejected are terminal; every other phase blocks a new write. */
export interface CoachPaidPeriodAttempt {
  readonly requestId: string;
  readonly episodeId: string;
  readonly command: CoachRenewalPeriodCommand;
  readonly previousPeriodId: string | null;
  readonly phase: "in-flight" | "uncertain" | "recorded" | "resolved" | "rejected";
  readonly receipt: CoachPaidPeriodOperationReceipt | null;
  /** Only an explicit null operation read enables retry of this exact request. */
  readonly retryAllowed: boolean;
}

export interface CoachPaidPeriodControllerSnapshot {
  readonly confirmed: CoachPaidPeriodRead | null;
  readonly draft: CoachRenewalDraft | null;
  readonly pending: "load" | "save" | "reconcile" | "retry" | null;
  readonly attempt: CoachPaidPeriodAttempt | null;
  readonly issue: CoachPaidPeriodControllerIssue | null;
  readonly needsRefresh: boolean;
  readonly disposed: boolean;
}

export interface CoachPaidPeriodControllerInput {
  /** Explicit authorized mapping; neither id is inferred from the other. */
  readonly selection: { readonly renewalId: string; readonly episodeId: string };
  /** Bound to captured account + portal/generation + selection; false permanently invalidates this controller. */
  readonly isCurrent: () => boolean;
  readonly source: CoachPaidPeriodSource;
  readonly validation: CoachRenewalCivilDateValidation;
  /** Injected unique id for a new logical command only, never called by reconcile/retry. */
  readonly createRequestId: () => string;
}

export interface CoachPaidPeriodController {
  getSnapshot(): CoachPaidPeriodControllerSnapshot;
  subscribe(listener: (snapshot: CoachPaidPeriodControllerSnapshot) => void): () => void;
  load(): Promise<boolean>;
  open(baseline: CoachRenewalBaseline, target: CoachRenewalPeriodTarget): boolean;
  openDates(proposedDates: CoachRenewalDates): boolean;
  editDates(dates: CoachRenewalDates): boolean;
  acceptDates(): boolean;
  cancelDates(): boolean;
  selectState(state: "pending" | "declined"): boolean;
  /** Local cancellation is allowed during dispatch; it never discards attempt tracking. */
  cancelDetail(): boolean;
  canSave(): boolean;
  save(): Promise<boolean>;
  reconcile(): Promise<boolean>;
  /** Requires retryAllowed. Reuses the original request, not the currently edited draft. */
  retry(): Promise<boolean>;
  /** Clears selection data, aborts locally and invalidates late results; cannot roll back a write. */
  dispose(): void;
}
