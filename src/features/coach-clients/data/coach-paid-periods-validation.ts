import { exactRecord, timestampMicros, uuid } from "./coach-invitations-validation";
import {
  COACH_PAID_PERIOD_INITIAL_VERSION, CoachPaidPeriodsError,
  type CoachPaidPeriod, type CoachPaidPeriodAction, type CoachPaidPeriodReadResult,
  type CoachPaidPeriodReceipt, type CoachPaidPeriodWriteResult,
} from "./coach-paid-periods-contract";

type ValidationFailure = "invalid_input" | "invalid_response";
const reject = (code: ValidationFailure = "invalid_response"): never => { throw new CoachPaidPeriodsError(code); };

/** Reuse the descriptor-safe allowlist parser; expose only this feature's errors. */
export function paidRecord(value: unknown, keys: readonly string[], code: ValidationFailure = "invalid_response") {
  try { return exactRecord(value, keys); } catch { return reject(code); }
}
export function paidUuid(value: unknown, code: ValidationFailure = "invalid_response"): string {
  try { return uuid(value); } catch { return reject(code); }
}
export function paidCivilDate(value: unknown, code: ValidationFailure = "invalid_response"): string {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return reject(code);
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12) return reject(code);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (day < 1 || day > days) return reject(code);
  return value;
}
export function paidDates(startValue: unknown, endValue: unknown, code: ValidationFailure = "invalid_response") {
  const start = paidCivilDate(startValue, code), end = paidCivilDate(endValue, code);
  if (end <= start) return reject(code);
  return Object.freeze({ start, end });
}

function mapPeriod(value: unknown, expectedEpisode?: string, expectedPeriod?: string): CoachPaidPeriod {
  const row = paidRecord(value, ["id", "linkEpisodeId", "start", "end"]);
  const id = paidUuid(row.id), linkEpisodeId = paidUuid(row.linkEpisodeId);
  if ((expectedEpisode !== undefined && linkEpisodeId !== expectedEpisode)
    || (expectedPeriod !== undefined && id !== expectedPeriod)) return reject();
  return Object.freeze({ id, linkEpisodeId, ...paidDates(row.start, row.end) });
}

export function mapCoachPaidPeriodRead(value: unknown, expectedEpisode: string): CoachPaidPeriodReadResult {
  const row = paidRecord(value, ["linkEpisodeId", "version", "period"]);
  const linkEpisodeId = paidUuid(row.linkEpisodeId), version = paidUuid(row.version);
  if (linkEpisodeId !== expectedEpisode) return reject();
  if (row.period === null) {
    if (version !== COACH_PAID_PERIOD_INITIAL_VERSION) return reject();
    return Object.freeze({ linkEpisodeId, version, period: null });
  }
  if (version === COACH_PAID_PERIOD_INITIAL_VERSION) return reject();
  return Object.freeze({ linkEpisodeId, version, period: mapPeriod(row.period, expectedEpisode) });
}

interface ReceiptExpectation {
  readonly requestId: string;
  readonly action?: CoachPaidPeriodAction;
  readonly episodeId?: string;
  readonly periodId?: string;
  readonly expectedVersion?: string;
  readonly start?: string;
  readonly end?: string;
}
export function mapCoachPaidPeriodReceipt(value: unknown, expected: ReceiptExpectation): CoachPaidPeriodReceipt {
  const row = paidRecord(value, ["requestId", "action", "period", "version", "recordedAt"]);
  const requestId = paidUuid(row.requestId), version = paidUuid(row.version);
  if (requestId !== expected.requestId || (row.action !== "confirm" && row.action !== "correct")
    || (expected.action !== undefined && row.action !== expected.action)
    || version === COACH_PAID_PERIOD_INITIAL_VERSION || version === expected.expectedVersion) return reject();
  const period = mapPeriod(row.period, expected.episodeId, expected.periodId);
  if ((expected.start !== undefined && period.start !== expected.start)
    || (expected.end !== undefined && period.end !== expected.end)) return reject();
  try { timestampMicros(row.recordedAt); } catch { return reject(); }
  return Object.freeze({ requestId, action: row.action, period, version, recordedAt: row.recordedAt as string });
}

export function mapCoachPaidPeriodWrite<A extends CoachPaidPeriodAction>(
  value: unknown, expected: ReceiptExpectation & { readonly action: A },
): CoachPaidPeriodWriteResult<A> {
  const row = paidRecord(value, ["status", "operation"]);
  if (row.status !== "recorded") return reject();
  const operation = mapCoachPaidPeriodReceipt(row.operation, expected);
  // The runtime mapper verifies the action before narrowing its literal type.
  return Object.freeze({ status: "recorded", operation: operation as CoachPaidPeriodReceipt<A> });
}

/** Supabase adds these transport metadata fields; the SQL DTO itself remains exact. */
export function paidRpcEnvelope(value: unknown): { readonly data: unknown; readonly error: unknown } {
  try {
    if (!value || typeof value !== "object") return reject();
    const keys = Reflect.ownKeys(value);
    const allowed = ["data", "error", "count", "status", "statusText", "success"];
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))
      || !keys.includes("data") || !keys.includes("error")) return reject();
    const row = paidRecord(value, keys as string[]);
    // Current SDK adds success; older supplied ports may omit it. Never trust a
    // contradictory flag or use it in place of the error, HTTP and DTO checks.
    if (Object.hasOwn(row, "success") && (typeof row.success !== "boolean"
      || row.success !== (row.error === null))) return reject();
    if (Object.hasOwn(row, "count") && row.count !== null
      && (typeof row.count !== "number" || !Number.isSafeInteger(row.count) || row.count < 0)) return reject();
    if (Object.hasOwn(row, "status") && (typeof row.status !== "number" || !Number.isInteger(row.status)
      || (row.status !== 0 && (row.status < 100 || row.status > 599))
      || (row.error === null ? row.status < 200 || row.status >= 300 : row.status !== 0 && row.status < 400))) return reject();
    if (Object.hasOwn(row, "statusText") && (typeof row.statusText !== "string" || row.statusText.length > 200)) return reject();
    if (row.error !== null && (!row.error || typeof row.error !== "object" || Array.isArray(row.error) || row.data !== null)) return reject();
    return { data: row.data, error: row.error };
  } catch { return reject(); }
}
