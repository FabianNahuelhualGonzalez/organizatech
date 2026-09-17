import { CoachInvitationsError } from "./coach-invitations-contract";
import { exactRecord, normalizeRecipientEmail, timestampMicros, uuid } from "./coach-invitations-validation";
import type { CoachPendingInvitationRow, CoachPendingInvitationsCursor, CoachPendingInvitationsPage,
  CoachPendingInvitationsParameters, CoachPendingInvitationsQuery } from "./coach-pending-invitations-contract";

const encoder = new TextEncoder();
const fail = (): never => { throw new CoachInvitationsError("invalid_response"); };

function cursor(value: unknown): CoachPendingInvitationsCursor {
  const row = exactRecord(value, ["createdAt", "id"]);
  timestampMicros(row.createdAt);
  return Object.freeze({ createdAt: row.createdAt as string, id: uuid(row.id) });
}

/** Negative means left precedes right in ascending timestamp/UUID order. */
function compare(left: CoachPendingInvitationsCursor, right: CoachPendingInvitationsCursor): number {
  const delta = timestampMicros(left.createdAt) - timestampMicros(right.createdAt);
  return delta < BigInt(0) ? -1 : delta > BigInt(0) ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function snapshotCoachPendingInvitationsQuery(value: CoachPendingInvitationsQuery): CoachPendingInvitationsQuery {
  try {
    const row = exactRecord(value, ["query", "limit", "cursor"], "invalid_input");
    if (typeof row.query !== "string" || /\u0000|[\uD800-\uDFFF]/u.test(row.query)
      || encoder.encode(row.query).length > 254 || !Number.isInteger(row.limit)
      || (row.limit as number) < 1 || (row.limit as number) > 50) throw new Error();
    // Preserve the bounded original query for SQL's identical normalization.
    return Object.freeze({ query: row.query, limit: row.limit as number,
      cursor: row.cursor === null ? null : cursor(row.cursor) });
  } catch { throw new CoachInvitationsError("invalid_input"); }
}

export function pendingInvitationsParameters(query: CoachPendingInvitationsQuery): CoachPendingInvitationsParameters {
  const snapshot = snapshotCoachPendingInvitationsQuery(query);
  return Object.freeze({ p_query: snapshot.query, p_limit: snapshot.limit,
    p_cursor_created_at: snapshot.cursor?.createdAt ?? null, p_cursor_id: snapshot.cursor?.id ?? null });
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail();
  return value === 0 ? 0 : value;
}

/** Consume JSON data only; getters, sparse arrays and oversized pages are invalid. */
function arrayItems(value: unknown, limit: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isInteger(length) || length < 0 || length > limit) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length + 1) return fail();
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[index];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return fail();
    return descriptor.value;
  });
}

/** Strict minimal DTO: extra code, name, ownership or account fields are rejected. */
export function mapCoachPendingInvitationsPage(value: unknown, query: CoachPendingInvitationsQuery): CoachPendingInvitationsPage {
  try {
    const row = exactRecord(value, ["serverNow", "totalPending", "matchingCount", "items", "nextCursor"]);
    const now = timestampMicros(row.serverNow);
    const totalPending = count(row.totalPending);
    const matchingCount = count(row.matchingCount);
    if (matchingCount > totalPending) return fail();
    const rawItems = arrayItems(row.items, query.limit);
    if (rawItems.length > matchingCount) return fail();
    const ids = new Set<string>();
    let previous = query.cursor;
    const items = Object.freeze(rawItems.map((raw): CoachPendingInvitationRow => {
      const item = exactRecord(raw, ["id", "recipientEmail", "createdAt", "issuedAt", "expiresAt", "state"]);
      const id = uuid(item.id);
      const email = normalizeRecipientEmail(item.recipientEmail);
      const position = cursor({ id, createdAt: item.createdAt });
      const issued = timestampMicros(item.issuedAt);
      const expires = timestampMicros(item.expiresAt);
      const state = expires <= now ? "expired" : "pending";
      // SQL owns Unicode matching; JS contextual lowercase is not PostgreSQL's
      // simple lowercase. Refiltering here could reject legitimate server rows.
      if (email !== item.recipientEmail || ids.has(id)
        || issued < timestampMicros(position.createdAt) || issued > now
        || expires - issued !== BigInt(604_800_000_000)
        || item.state !== state
        || (previous !== null && compare(position, previous) >= 0)) return fail();
      previous = position;
      ids.add(id);
      return Object.freeze({ id, recipientEmail: email, createdAt: position.createdAt,
        issuedAt: item.issuedAt as string, expiresAt: item.expiresAt as string, state });
    }));
    const nextCursor = row.nextCursor === null ? null : cursor(row.nextCursor);
    if (nextCursor !== null && (items.length !== query.limit || matchingCount <= items.length
      || compare(nextCursor, items[items.length - 1]) !== 0)) return fail();
    // On the first page we can verify omission/truncation without guessing totals
    // from later pages. A later page may be empty after a concurrent cancellation.
    if (query.cursor === null && (items.length !== Math.min(query.limit, matchingCount)
      || (nextCursor !== null) !== (matchingCount > query.limit))) return fail();
    return Object.freeze({ serverNow: row.serverNow as string, totalPending, matchingCount, items, nextCursor });
  } catch { return fail(); }
}
