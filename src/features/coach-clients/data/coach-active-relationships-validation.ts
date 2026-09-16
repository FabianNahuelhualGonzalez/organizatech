import { CoachInvitationsError } from "./coach-invitations-contract";
import { exactRecord, mapCoachRelationshipDetail, timestampMicros, uuid } from "./coach-invitations-validation";
import type { CoachActiveRelationshipRow, CoachActiveRelationshipsCursor, CoachActiveRelationshipsPage,
  CoachActiveRelationshipsParameters, CoachActiveRelationshipsQuery } from "./coach-active-relationships-contract";

const encoder = new TextEncoder();
const fail = (): never => { throw new CoachInvitationsError("invalid_response"); };
const minimumTime = timestampMicros("0001-01-01T00:00:00Z");
const maximumTime = timestampMicros("9999-12-31T23:59:59.999999Z");

function finiteTime(value: unknown): bigint {
  const result = timestampMicros(value);
  if (result < minimumTime || result > maximumTime) return fail();
  return result;
}
function cursor(value: unknown): CoachActiveRelationshipsCursor {
  const row = exactRecord(value, ["linkedAt", "id"]);
  finiteTime(row.linkedAt);
  return Object.freeze({ linkedAt: row.linkedAt as string, id: uuid(row.id) });
}
function compare(left: CoachActiveRelationshipsCursor, right: CoachActiveRelationshipsCursor): number {
  const delta = finiteTime(left.linkedAt) - finiteTime(right.linkedAt);
  return delta < BigInt(0) ? -1 : delta > BigInt(0) ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function snapshotCoachActiveRelationshipsQuery(value: CoachActiveRelationshipsQuery): CoachActiveRelationshipsQuery {
  try {
    const row = exactRecord(value, ["query", "limit", "cursor"], "invalid_input");
    if (typeof row.query !== "string" || /\u0000|[\uD800-\uDFFF]/u.test(row.query)
      || encoder.encode(row.query).length > 254 || !Number.isInteger(row.limit)
      || (row.limit as number) < 1 || (row.limit as number) > 50) throw new Error();
    // SQL owns literal Unicode matching; retain the original bounded query.
    return Object.freeze({ query: row.query, limit: row.limit as number,
      cursor: row.cursor === null ? null : cursor(row.cursor) });
  } catch { throw new CoachInvitationsError("invalid_input"); }
}

export function activeRelationshipsParameters(query: CoachActiveRelationshipsQuery): CoachActiveRelationshipsParameters {
  const snapshot = snapshotCoachActiveRelationshipsQuery(query);
  return Object.freeze({ p_query: snapshot.query, p_limit: snapshot.limit,
    p_cursor_linked_at: snapshot.cursor?.linkedAt ?? null, p_cursor_id: snapshot.cursor?.id ?? null });
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail();
  return value === 0 ? 0 : value;
}
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

/** Read only the active episode's consented identity snapshots, never activity. */
export function mapCoachActiveRelationshipsPage(value: unknown, query: CoachActiveRelationshipsQuery): CoachActiveRelationshipsPage {
  try {
    const row = exactRecord(value, ["serverNow", "totalActive", "matchingCount", "items", "nextCursor"]);
    finiteTime(row.serverNow);
    const totalActive = count(row.totalActive), matchingCount = count(row.matchingCount);
    if (matchingCount > totalActive) return fail();
    const rawItems = arrayItems(row.items, query.limit);
    if (rawItems.length > matchingCount) return fail();
    const ids = new Set<string>();
    let previous = query.cursor;
    const items = Object.freeze(rawItems.map((raw): CoachActiveRelationshipRow => {
      const item = exactRecord(raw, ["id", "studentName", "studentEmail", "linkedAt"]);
      const id = uuid(item.id);
      // Use the same SQL snapshot constraints as the existing relationship read.
      // This is not a new profile lookup or recipient-email normalization rule.
      const detail = mapCoachRelationshipDetail({ ...item, endedAt: null }, id);
      const position = cursor({ id, linkedAt: detail.linkedAt });
      if (ids.has(id) || (previous !== null && compare(position, previous) >= 0)) return fail();
      previous = position;
      ids.add(id);
      return Object.freeze({ id, studentName: detail.studentName, studentEmail: detail.studentEmail, linkedAt: detail.linkedAt });
    }));
    const nextCursor = row.nextCursor === null ? null : cursor(row.nextCursor);
    if (nextCursor !== null && (items.length !== query.limit || matchingCount <= items.length
      || compare(nextCursor, items[items.length - 1]) !== 0)) return fail();
    // Later pages may be empty following a revocation. Never compare accumulated
    // prior pages to this page's fresh matchingCount or treat a cursor as authority.
    if (query.cursor === null && (items.length !== Math.min(query.limit, matchingCount)
      || (nextCursor !== null) !== (matchingCount > query.limit))) return fail();
    return Object.freeze({ serverNow: row.serverNow as string, totalActive, matchingCount, items, nextCursor });
  } catch { return fail(); }
}
