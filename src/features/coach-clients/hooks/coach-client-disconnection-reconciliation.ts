import type { CoachClientDisconnectionIssue, CoachClientDisconnectionRead,
  CoachClientDisconnectionReceipt, CoachClientDisconnectionSelection } from "./coach-client-disconnection-contract";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function disconnectionOpaqueId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Read only required properties once; hostile accessors/Proxies never escape. */
export function copyDisconnectionSelection(value: unknown): CoachClientDisconnectionSelection | null {
  try {
    if (!record(value)) return null;
    const { kind, id } = value;
    return (kind === "invitation" || kind === "relationship") && disconnectionOpaqueId(id)
      ? Object.freeze({ kind, id }) : null;
  } catch { return null; }
}

export function copyDisconnectionRead(value: unknown, selection: CoachClientDisconnectionSelection): CoachClientDisconnectionRead | null {
  try {
    if (!record(value)) return null;
    const { kind, id } = value;
    if ((kind !== "invitation" && kind !== "relationship") || kind !== selection.kind || id !== selection.id) return null;
    if (kind === "invitation") {
      const state = value.state;
      return state === "pending" || state === "expired" || state === "cancelled" || state === "accepted"
        ? Object.freeze({ kind, id, state }) : null;
    }
    const endedAt = value.endedAt;
    return endedAt === null || disconnectionOpaqueId(endedAt) ? Object.freeze({ kind, id, endedAt }) : null;
  } catch { return null; }
}

export function copyDisconnectionReceipt(value: unknown, selection: CoachClientDisconnectionSelection,
  requestId: string): CoachClientDisconnectionReceipt | null {
  try {
    if (!record(value)) return null;
    const { kind, id, requestId: receivedId, completed } = value;
    return kind === selection.kind && id === selection.id && receivedId === requestId && completed === true
      ? Object.freeze({ kind: selection.kind, id: selection.id, requestId, completed: true }) : null;
  } catch { return null; }
}

const ISSUES: readonly CoachClientDisconnectionIssue[] = ["invalid_input", "invalid_response", "forbidden", "not_found",
  "state_conflict", "request_conflict", "operation_stale", "aborted", "timeout", "unavailable"];

export function disconnectionIssue(error: unknown): CoachClientDisconnectionIssue {
  try {
    const code = record(error) ? error.code : null;
    return ISSUES.includes(code as CoachClientDisconnectionIssue) ? code as CoachClientDisconnectionIssue : "unavailable";
  } catch { return "unavailable"; }
}

export function isDisconnectable(read: CoachClientDisconnectionRead): boolean {
  return read.kind === "invitation" ? read.state === "pending" || read.state === "expired" : read.endedAt === null;
}

export function isDisconnected(read: CoachClientDisconnectionRead): boolean {
  return read.kind === "invitation" ? read.state === "cancelled" : read.endedAt !== null;
}
