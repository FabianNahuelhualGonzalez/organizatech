import { timestampMicros } from "@/features/coach-clients/data/coach-invitations-validation";
import { paidCivilDate, paidRecord, paidUuid } from "@/features/coach-clients/data/coach-paid-periods-validation";
import { COACH_COMMERCIAL_FREQUENCIES, type CoachCommercialItem, type CoachCommercialMonth,
  type CoachCommercialPeriod, type CoachCommercialPortfolio } from "../model/coach-commercial-portfolio";
import { CoachCommercialError, type CoachCommercialCommand, type CoachCommercialReceipt } from "./coach-commercial-contract";

const bad = (code: "invalid_input" | "invalid_response" = "invalid_response"): never => {
  throw new CoachCommercialError(code);
};
const record = (value: unknown, keys: readonly string[], code: "invalid_input" | "invalid_response" = "invalid_response") => {
  try { return paidRecord(value, keys, code); } catch { return bad(code); }
};
const uuid = (value: unknown, code: "invalid_input" | "invalid_response" = "invalid_response") => {
  try { return paidUuid(value, code); } catch { return bad(code); }
};
const date = (value: unknown, code: "invalid_input" | "invalid_response" = "invalid_response") => {
  try { return paidCivilDate(value, code); } catch { return bad(code); }
};
const timestamp = (value: unknown): string => {
  try { timestampMicros(value); return value as string; } catch { return bad(); }
};
const natural = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : bad();
const amount = (value: unknown, code: "invalid_input" | "invalid_response" = "invalid_response"): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)
    || value < 1 || value > 1_000_000_000_000) return bad(code);
  return value;
};
const frequency = (value: unknown, code: "invalid_input" | "invalid_response" = "invalid_response") =>
  COACH_COMMERCIAL_FREQUENCIES.includes(value as never)
    ? value as typeof COACH_COMMERCIAL_FREQUENCIES[number] : bad(code);
const optionalDate = (value: unknown) => value === null ? null : date(value);
const optionalTimestamp = (value: unknown) => value === null ? null : timestamp(value);

export function mapCoachCommercialCommand(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad("invalid_input");
  let keysFound: string[];
  try { keysFound = Reflect.ownKeys(value).filter((key): key is string => typeof key === "string"); }
  catch { return bad("invalid_input"); }
  const base = record(value, keysFound, "invalid_input");
  const action = base.action;
  const hasTerms = action === "start" || action === "renew" || action === "correct_future";
  const hasPeriod = action === "correct_future" || action === "confirm_payment";
  const keys = ["action", "episodeId", "requestId", "expectedVersion",
    ...(hasPeriod ? ["periodId"] : []),
    ...(hasTerms ? ["amountClp", "frequency", "startsOn", "agreementEndsOn"] : [])];
  const row = record(value, keys, "invalid_input");
  if (!hasTerms && !hasPeriod && action !== "not_continuing") return bad("invalid_input");
  const common = { action, episodeId: uuid(row.episodeId, "invalid_input"),
    requestId: uuid(row.requestId, "invalid_input"),
    expectedVersion: uuid(row.expectedVersion, "invalid_input") };
  const periodId = hasPeriod ? uuid(row.periodId, "invalid_input") : null;
  const terms = hasTerms ? {
    amountClp: amount(row.amountClp, "invalid_input"), frequency: frequency(row.frequency, "invalid_input"),
    startsOn: date(row.startsOn, "invalid_input"),
    agreementEndsOn: row.agreementEndsOn === null ? null : date(row.agreementEndsOn, "invalid_input"),
  } : null;
  if (terms?.agreementEndsOn && terms.agreementEndsOn < terms.startsOn) return bad("invalid_input");
  return Object.freeze({
    command: { ...common, ...(periodId ? { periodId } : {}), ...(terms ?? {}) } as CoachCommercialCommand,
    args: Object.freeze({
      p_action: action as string, p_episode_id: common.episodeId, p_request_id: common.requestId,
      p_expected_version: common.expectedVersion, p_period_id: periodId,
      p_amount_clp: terms?.amountClp ?? null, p_frequency: terms?.frequency ?? null,
      p_starts_on: terms?.startsOn ?? null, p_agreement_ends_on: terms?.agreementEndsOn ?? null,
    }),
  });
}

export function mapCoachCommercialReceipt(value: unknown, expected?: {
  readonly action?: string; readonly episodeId?: string; readonly requestId?: string;
}): CoachCommercialReceipt {
  const row = record(value, ["status", "action", "requestId", "episodeId", "periodId", "version", "recordedAt"]);
  if (row.status !== "recorded" || !["start", "renew", "correct_future", "confirm_payment", "not_continuing"].includes(row.action as string)) return bad();
  const episodeId = uuid(row.episodeId), requestId = uuid(row.requestId), version = uuid(row.version);
  if ((expected?.action && expected.action !== row.action) || (expected?.episodeId && expected.episodeId !== episodeId)
    || (expected?.requestId && expected.requestId !== requestId)
    || (row.action === "not_continuing") !== (row.periodId === null)) return bad();
  return Object.freeze({ status: "recorded", action: row.action as CoachCommercialReceipt["action"],
    requestId, episodeId, periodId: row.periodId === null ? null : uuid(row.periodId), version,
    recordedAt: timestamp(row.recordedAt) });
}

function mapPeriod(value: unknown): CoachCommercialPeriod {
  const row = record(value, ["id", "episodeId", "startsOn", "endsBefore", "amountClp", "frequency", "paidAt"]);
  const startsOn = date(row.startsOn), endsBefore = date(row.endsBefore);
  if (endsBefore <= startsOn) return bad();
  return Object.freeze({ id: uuid(row.id), episodeId: uuid(row.episodeId), startsOn, endsBefore,
    amountClp: amount(row.amountClp), frequency: frequency(row.frequency), paidAt: optionalTimestamp(row.paidAt) });
}
function mapItem(value: unknown): CoachCommercialItem {
  const hasCount = value !== null && typeof value === "object" && Object.hasOwn(value, "periodCount");
  const row = record(value, ["episodeId", "studentName", "linkedAt", "unlinkedAt", "agreementStart",
    "agreementEnd", "status", "version", "latestPeriod", ...(hasCount ? ["periodCount"] : [])]);
  if (typeof row.studentName !== "string" || !row.studentName.trim() || row.studentName.length > 201
    || !["needs_agreement", "active", "pending_renewal", "not_continuing"].includes(row.status as string)) return bad();
  const status = row.status as CoachCommercialItem["status"];
  const latestPeriod = row.latestPeriod === null ? null : mapPeriod(row.latestPeriod);
  const episodeId = uuid(row.episodeId);
  if ((status === "needs_agreement") !== (latestPeriod === null)
    || (status === "needs_agreement") !== (row.version === null)
    || (latestPeriod !== null && latestPeriod.episodeId !== episodeId)) return bad();
  return Object.freeze({ episodeId, studentName: row.studentName, linkedAt: timestamp(row.linkedAt),
    unlinkedAt: optionalTimestamp(row.unlinkedAt), agreementStart: optionalDate(row.agreementStart),
    agreementEnd: optionalDate(row.agreementEnd), status,
    version: row.version === null ? null : uuid(row.version), latestPeriod,
    ...(hasCount ? { periodCount: natural(row.periodCount) } : {}) });
}
function mapMonth(value: unknown): CoachCommercialMonth {
  const row = record(value, ["month", "estimatedClp", "confirmedPaymentsClp", "periodCount", "students", "joined", "left"]);
  if (typeof row.month !== "string" || !/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(row.month)) return bad();
  return Object.freeze({ month: row.month, estimatedClp: natural(row.estimatedClp),
    confirmedPaymentsClp: natural(row.confirmedPaymentsClp), periodCount: natural(row.periodCount),
    students: natural(row.students), joined: natural(row.joined), left: natural(row.left) });
}
export function mapCoachCommercialPortfolio(value: unknown): CoachCommercialPortfolio {
  const row = record(value, ["serverToday", "currentMonth", "activeCount", "unlinkedCount", "items", "periods", "months"]);
  const serverToday = date(row.serverToday);
  if (row.currentMonth !== serverToday.slice(0, 7) || !Array.isArray(row.items)
    || !Array.isArray(row.periods) || !Array.isArray(row.months)) return bad();
  const items = row.items.map(mapItem), periods = row.periods.map(mapPeriod), months = row.months.map(mapMonth);
  const periodsById = new Map(periods.map((period) => [period.id, period]));
  const latestByEpisode = new Map<string, CoachCommercialPeriod>();
  for (const period of periods) {
    const prior = latestByEpisode.get(period.episodeId);
    if (!prior || period.startsOn > prior.startsOn) latestByEpisode.set(period.episodeId, period);
  }
  if (new Set(items.map((item) => item.episodeId)).size !== items.length
    || new Set(periods.map((period) => period.id)).size !== periods.length
    || new Set(months.map((month) => month.month)).size !== months.length
    || items.filter((item) => item.unlinkedAt === null).length !== row.activeCount
    || items.filter((item) => item.unlinkedAt !== null).length !== row.unlinkedCount
    || periods.some((period) => !items.some((item) => item.episodeId === period.episodeId))
    || items.some((item) => {
      const actual = latestByEpisode.get(item.episodeId) ?? null;
      const claimed = item.latestPeriod;
      return (actual === null) !== (claimed === null)
        || (claimed !== null && (periodsById.get(claimed.id)?.episodeId !== item.episodeId
          || actual?.id !== claimed.id || actual.amountClp !== claimed.amountClp
          || actual.frequency !== claimed.frequency || actual.startsOn !== claimed.startsOn
          || actual.endsBefore !== claimed.endsBefore || actual.paidAt !== claimed.paidAt));
    })) return bad();
  return Object.freeze({ serverToday, currentMonth: row.currentMonth,
    activeCount: natural(row.activeCount), unlinkedCount: natural(row.unlinkedCount),
    items: Object.freeze(items), periods: Object.freeze(periods), months: Object.freeze(months) });
}

const cursor = (value: unknown): string | null => value === null ? null
  : typeof value === "string" && value.length <= 100 ? value : bad();

export function mapCoachCommercialPage(value: unknown, kind: "items" | "student"): { rows: readonly CoachCommercialItem[]; nextCursor: string | null };
export function mapCoachCommercialPage(value: unknown, kind: "periods"): { rows: readonly CoachCommercialPeriod[]; nextCursor: string | null };
export function mapCoachCommercialPage(value: unknown, kind: "months"): { rows: readonly CoachCommercialMonth[]; nextCursor: string | null };
export function mapCoachCommercialPage(value: unknown, kind: "items" | "student" | "periods" | "months"):
  { rows: readonly (CoachCommercialItem | CoachCommercialPeriod | CoachCommercialMonth)[]; nextCursor: string | null };
export function mapCoachCommercialPage(value: unknown, kind: "items" | "student" | "periods" | "months"):
  { rows: readonly (CoachCommercialItem | CoachCommercialPeriod | CoachCommercialMonth)[]; nextCursor: string | null } {
  const row = record(value, ["rows", "nextCursor"]);
  if (!Array.isArray(row.rows) || row.rows.length > 50) return bad();
  const rows = kind === "periods" ? row.rows.map(mapPeriod)
    : kind === "months" ? row.rows.map(mapMonth) : row.rows.map(mapItem);
  const nextCursor = cursor(row.nextCursor);
  if (kind === "student" && (rows.length !== 1 || nextCursor !== null)) return bad();
  if (nextCursor !== null && rows.length === 0) return bad();
  return Object.freeze({ rows: Object.freeze(rows), nextCursor });
}

export function mapCoachCommercialOverview(value: unknown): CoachCommercialPortfolio {
  const row = record(value, ["serverToday", "currentMonth", "items", "itemCursor", "months", "monthCursor", "stats"]);
  const serverToday = date(row.serverToday);
  if (row.currentMonth !== serverToday.slice(0, 7) || !Array.isArray(row.items) || row.items.length > 30
    || !Array.isArray(row.months) || row.months.length > 12) return bad();
  const stats = record(row.stats, ["activeCount", "unlinkedCount", "alertCount", "pendingCount",
    "renewedCount", "declinedCount", "pendingAmount", "monthlyRiskCount", "monthlyRiskAmount",
    "maxStudents", "currentBreakdown", "years"]);
  if (!Array.isArray(stats.currentBreakdown) || !Array.isArray(stats.years)) return bad();
  const breakdown = stats.currentBreakdown.map((entry) => {
    const part = record(entry, ["frequency", "amountClp", "students", "periods", "estimatedClp"]);
    return Object.freeze({ frequency: frequency(part.frequency), amountClp: amount(part.amountClp),
      students: natural(part.students), periods: natural(part.periods), estimatedClp: natural(part.estimatedClp) });
  });
  const years = stats.years.map((entry) => {
    const part = record(entry, ["year", "estimatedClp", "confirmedPaymentsClp"]);
    if (typeof part.year !== "number" || !Number.isInteger(part.year) || part.year < 1 || part.year > 9999) return bad();
    return Object.freeze({ year: part.year, estimatedClp: natural(part.estimatedClp),
      confirmedPaymentsClp: natural(part.confirmedPaymentsClp) });
  });
  return Object.freeze({ serverToday, currentMonth: row.currentMonth as string,
    activeCount: natural(stats.activeCount), unlinkedCount: natural(stats.unlinkedCount),
    items: Object.freeze(row.items.map(mapItem)), periods: Object.freeze([]),
    months: Object.freeze(row.months.map(mapMonth)),
    itemCursor: cursor(row.itemCursor), monthCursor: cursor(row.monthCursor),
    stats: Object.freeze({ alertCount: natural(stats.alertCount), pendingCount: natural(stats.pendingCount),
      renewedCount: natural(stats.renewedCount), declinedCount: natural(stats.declinedCount),
      pendingAmount: natural(stats.pendingAmount), monthlyRiskCount: natural(stats.monthlyRiskCount),
      monthlyRiskAmount: natural(stats.monthlyRiskAmount), maxStudents: natural(stats.maxStudents),
      currentBreakdown: Object.freeze(breakdown), years: Object.freeze(years) }),
  });
}
