import type { CoachCommercialFrequency } from "../model/coach-commercial-portfolio";

export const COACH_COMMERCIAL_INITIAL_VERSION = "00000000-0000-0000-0000-000000000000";
export type CoachCommercialAction = "start" | "renew" | "correct_future" | "confirm_payment" | "not_continuing";
interface BaseCommand {
  readonly episodeId: string;
  readonly requestId: string;
  readonly expectedVersion: string;
}
interface Terms {
  readonly amountClp: number;
  readonly frequency: CoachCommercialFrequency;
  readonly startsOn: string;
  readonly agreementEndsOn: string | null;
}
export type CoachCommercialCommand =
  | (BaseCommand & Terms & { readonly action: "start" | "renew" })
  | (BaseCommand & Terms & { readonly action: "correct_future"; readonly periodId: string })
  | (BaseCommand & { readonly action: "confirm_payment"; readonly periodId: string })
  | (BaseCommand & { readonly action: "not_continuing" });

export interface CoachCommercialReceipt {
  readonly status: "recorded";
  readonly action: CoachCommercialAction;
  readonly requestId: string;
  readonly episodeId: string;
  readonly periodId: string | null;
  readonly version: string;
  readonly recordedAt: string;
}

export type CoachCommercialErrorCode = "invalid_input" | "invalid_response" | "forbidden"
  | "not_found" | "inactive_relationship" | "request_conflict" | "version_conflict"
  | "conflict" | "operation_stale" | "aborted" | "timeout" | "unavailable" | "migration_pending";
export class CoachCommercialError extends Error {
  readonly code: CoachCommercialErrorCode;
  constructor(code: CoachCommercialErrorCode) {
    super(`coach-commercial-${code}`);
    this.name = "CoachCommercialError";
    this.code = code;
  }
}
