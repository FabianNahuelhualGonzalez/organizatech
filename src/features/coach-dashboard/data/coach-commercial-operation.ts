import { CoachCommercialError, type CoachCommercialCommand,
  type CoachCommercialReceipt } from "./coach-commercial-contract";
import { mapCoachCommercialCommand } from "./coach-commercial-validation";

/** Keep exactly the validated scalar allowlist across timeout and retry. */
export function snapshotCoachCommercialCommand(command: CoachCommercialCommand): CoachCommercialCommand {
  return Object.freeze(mapCoachCommercialCommand(command).command);
}

/** A rejected RPC transaction cannot have recorded this command. Transport and
 * response failures remain uncertain until the original request is reconciled. */
export function isDefinitiveCoachCommercialRejection(error: unknown, retrying = false): boolean {
  // A retry's CAS rejection cannot settle an earlier uncertain dispatch.
  if (retrying) return false;
  if (!(error instanceof CoachCommercialError)) return false;
  return ["invalid_input", "forbidden", "not_found", "inactive_relationship",
    "request_conflict", "version_conflict", "conflict", "migration_pending"].includes(error.code);
}

/** Reconciliation must belong to the exact command retained after a timeout. */
export function matchesCoachCommercialOperation(command: CoachCommercialCommand,
  receipt: CoachCommercialReceipt): boolean {
  return receipt.status === "recorded" && receipt.action === command.action
    && receipt.requestId === command.requestId && receipt.episodeId === command.episodeId
    && receipt.version !== command.expectedVersion
    && (command.action === "confirm_payment" || command.action === "correct_future"
      ? receipt.periodId === command.periodId
      : command.action === "not_continuing" ? receipt.periodId === null : receipt.periodId !== null);
}
