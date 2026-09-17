import {
  CoachInvitationsError,
  type CoachInvitationAction,
  type CoachInvitationDetail,
  type CoachInvitationMutationResult,
  type CoachInvitationOperation,
  type CoachInvitationsErrorCode,
  type CoachRelationshipDetail,
} from "./coach-invitations-contract";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codePattern = /^(?:[ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]-){2}[ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]$/;
const encoder = new TextEncoder();
const sevenDaysMicros = BigInt(604_800_000_000);
const reject = (code: CoachInvitationsErrorCode = "invalid_response"): never => { throw new CoachInvitationsError(code); };
const trimSpaces = (value: string) => value.replace(/^ +| +$/g, "");

export function exactRecord(value: unknown, keys: readonly string[], code: CoachInvitationsErrorCode = "invalid_response"): Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return reject(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return reject(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Reflect.ownKeys(value);
    if (actualKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(descriptors, key)
      || !("value" in descriptors[key]) || !descriptors[key].enumerable)) return reject(code);
    // Read data descriptors, never invoke getters from form or transport objects.
    return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
  } catch {
    return reject(code);
  }
}

export function uuid(value: unknown, code: CoachInvitationsErrorCode = "invalid_response"): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) return reject(code);
  return value.toLowerCase();
}

function text(value: unknown): value is string {
  // JSON/PostgreSQL text cannot contain NUL or isolated UTF-16 surrogates.
  return typeof value === "string" && !/\u0000|[\uD800-\uDFFF]/u.test(value);
}
function emailShape(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value); }
export function normalizeRecipientEmail(value: unknown): string {
  if (!text(value) || encoder.encode(value).length > 320) return reject("invalid_input");
  const normalized = trimSpaces(value).toLowerCase();
  if (encoder.encode(normalized).length < 3 || encoder.encode(normalized).length > 254 || !emailShape(normalized)) {
    return reject("invalid_input");
  }
  return normalized;
}
function recipientEmail(value: unknown): string {
  if (!text(value) || value !== trimSpaces(value).toLowerCase() || !emailShape(value)
    || encoder.encode(value).length < 3 || encoder.encode(value).length > 254) return reject();
  return value;
}
function generation(value: unknown, minimum = 1): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > 2_147_483_647) return reject();
  return value;
}

/** Preserve PostgreSQL microseconds. Date.parse alone loses precision and normalizes invalid dates. */
export function timestampMicros(value: unknown): bigint {
  if (typeof value !== "string") return reject();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return reject();
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHours = Number(match[10] ?? 0);
  const offsetMinutes = Number(match[11] ?? 0);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59
    || second > 59 || offsetHours > 15 || offsetMinutes > 59) return reject();
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return reject();
  const offset = (offsetHours * 60 + offsetMinutes) * (match[9] === "-" ? -1 : 1);
  return BigInt(date.getTime()) * BigInt(1_000)
    + BigInt((match[7] ?? "").padEnd(6, "0")) - BigInt(offset) * BigInt(60_000_000);
}

export interface OperationExpectation {
  readonly requestId: string;
  readonly action?: CoachInvitationAction;
  readonly invitationId?: string;
  readonly episodeId?: string;
}
export function mapCoachInvitationOperation(value: unknown, expected: OperationExpectation): CoachInvitationOperation {
  const row = exactRecord(value, ["requestId", "action", "state", "invitationId", "episodeId", "generation", "reservedAt"]);
  const requestId = uuid(row.requestId);
  if (requestId !== expected.requestId || (expected.action && row.action !== expected.action)) return reject();
  timestampMicros(row.reservedAt);
  const base = { requestId, reservedAt: row.reservedAt as string };
  if (row.action === "revoke") {
    const episodeId = uuid(row.episodeId);
    if (row.state !== "completed" || row.invitationId !== null || row.generation !== null
      || (expected.episodeId && episodeId !== expected.episodeId) || expected.invitationId) return reject();
    return Object.freeze({ ...base, action: "revoke", state: "completed", episodeId, invitationId: null, generation: null });
  }
  if (row.action !== "create" && row.action !== "resend" && row.action !== "regenerate" && row.action !== "cancel") return reject();
  const invitationId = uuid(row.invitationId);
  const currentGeneration = generation(row.generation, row.action === "regenerate" ? 2 : 1);
  if (row.episodeId !== null || (expected.invitationId && invitationId !== expected.invitationId) || expected.episodeId) return reject();
  if (row.action === "cancel") {
    if (row.state !== "completed") return reject();
    return Object.freeze({ ...base, action: "cancel", state: "completed", invitationId, episodeId: null, generation: currentGeneration });
  }
  if (row.state !== "reserved" && row.state !== "cancelled") return reject();
  return Object.freeze({ ...base, action: row.action, state: row.state, invitationId, episodeId: null, generation: currentGeneration });
}

export function mapCoachInvitationMutation(value: unknown, expected: OperationExpectation & { readonly action: CoachInvitationAction }): CoachInvitationMutationResult {
  // The discriminant must itself be an own data field, not a getter.
  if (!value || typeof value !== "object") return reject();
  let status: unknown;
  try { status = Object.getOwnPropertyDescriptor(value, "status")?.value; }
  catch { return reject(); }
  if (status === "rate_limited") {
    const row = exactRecord(value, ["status", "serverNow", "retryAt"]);
    if (expected.action === "cancel" || expected.action === "revoke"
      || timestampMicros(row.retryAt) <= timestampMicros(row.serverNow)) return reject();
    return Object.freeze({ status, serverNow: row.serverNow as string, retryAt: row.retryAt as string });
  }
  if (status !== "recorded") return reject();
  const row = exactRecord(value, ["status", "serverNow", "operation"]);
  const operation = mapCoachInvitationOperation(row.operation, expected);
  if (timestampMicros(operation.reservedAt) > timestampMicros(row.serverNow)) return reject();
  return Object.freeze({ status, serverNow: row.serverNow as string, operation });
}

export function mapCoachInvitationDetail(value: unknown, expectedId: string): CoachInvitationDetail {
  const row = exactRecord(value, ["id", "recipientEmail", "state", "generation", "createdAt", "issuedAt", "expiresAt", "cancelledAt", "code"]);
  const id = uuid(row.id);
  const created = timestampMicros(row.createdAt);
  const issued = timestampMicros(row.issuedAt);
  if (id !== expectedId || issued < created || timestampMicros(row.expiresAt) - issued !== sevenDaysMicros) return reject();
  const base = { id, recipientEmail: recipientEmail(row.recipientEmail), generation: generation(row.generation),
    createdAt: row.createdAt as string, issuedAt: row.issuedAt as string, expiresAt: row.expiresAt as string };
  // No serverNow on this read: never judge expiry against an untrusted client clock.
  if (row.state === "pending") {
    if (typeof row.code !== "string" || !codePattern.test(row.code) || row.cancelledAt !== null) return reject();
    return Object.freeze({ ...base, state: "pending", code: row.code, cancelledAt: null });
  }
  if (row.code !== null) return reject();
  if (row.state === "cancelled") {
    if (timestampMicros(row.cancelledAt) < created) return reject();
    return Object.freeze({ ...base, state: "cancelled", code: null, cancelledAt: row.cancelledAt as string });
  }
  if ((row.state !== "expired" && row.state !== "accepted") || row.cancelledAt !== null) return reject();
  return Object.freeze({ ...base, state: row.state, code: null, cancelledAt: null });
}

export function mapCoachRelationshipDetail(value: unknown, expectedId: string): CoachRelationshipDetail {
  const row = exactRecord(value, ["id", "studentName", "studentEmail", "linkedAt", "endedAt"]);
  const id = uuid(row.id);
  const linked = timestampMicros(row.linkedAt);
  if (id !== expectedId || !text(row.studentName) || !text(row.studentEmail)) return reject();
  const nameLength = Array.from(trimSpaces(row.studentName)).length;
  const emailBytes = encoder.encode(row.studentEmail).length;
  if (nameLength < 1 || nameLength > 201 || emailBytes < 3 || emailBytes > 254
    || (row.endedAt !== null && timestampMicros(row.endedAt) < linked)) return reject();
  // Snapshots are not a fresh global profile/email lookup or a new identity proof.
  return Object.freeze({ id, studentName: row.studentName, studentEmail: row.studentEmail,
    linkedAt: row.linkedAt as string, endedAt: row.endedAt as string | null });
}
