import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveCoachPaymentPeriod,
  type CoachPaidPeriod,
  type CoachPaymentLink,
  type CoachPaymentPeriodView,
} from "./coach-payment-period";

const link: CoachPaymentLink = Object.freeze({ episodeId: "synthetic-link-1", state: "active" });
const period: CoachPaidPeriod = Object.freeze({
  id: "synthetic-period-1", linkEpisodeId: link.episodeId, start: "2026-09-01", end: "2026-09-30",
});
type Input = Parameters<typeof deriveCoachPaymentPeriod>[0];
const input = (overrides: Partial<Input> = {}): Input => ({
  link, period, today: "2026-09-27", recordedEventKeys: new Set(), ...overrides,
});
function available(view: CoachPaymentPeriodView) {
  assert.equal(view.kind, "available");
  if (view.kind !== "available") throw new Error("expected available payment read model");
  return view;
}

test("período ausente no equivale a pago confirmado, deuda ni invitación pendiente", () => {
  assert.deepEqual(deriveCoachPaymentPeriod(input({ period: null })), {
    kind: "available", status: "not-recorded", daysUntilEnd: null, dueEvents: [],
  });
});

test("estado comercial usa fecha final inclusiva y sólo fechas explícitas", () => {
  for (const [today, status, remaining] of [
    ["2026-09-01", "current", 29], ["2026-09-26", "current", 4],
    ["2026-09-27", "expiring", 3], ["2026-09-28", "expiring", 2],
    ["2026-09-29", "expiring", 1], ["2026-09-30", "expires-today", 0],
    ["2026-10-01", "pending-confirmation", -1], ["2026-12-31", "pending-confirmation", -92],
  ] as const) {
    const view = available(deriveCoachPaymentPeriod(input({ today })));
    assert.equal(view.status, status, today);
    assert.equal(view.daysUntilEnd, remaining, today);
  }
});

test("avisos exactos -3, 0 y +1 tienen ambos destinatarios sin inventar entregas", () => {
  const keys = new Set<string>();
  for (const [today, milestone] of [
    ["2026-09-27", "three-days-before"], ["2026-09-30", "expires-today"], ["2026-10-01", "one-day-after"],
  ] as const) {
    const events = deriveCoachPaymentPeriod(input({ today })).dueEvents;
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      eventKey: JSON.stringify(["coach-payment-period", link.episodeId, period.id, milestone]),
      milestone, dueOn: today, recipients: ["coach", "student"],
    });
    keys.add(events[0].eventKey);
  }
  assert.equal(keys.size, 3);
});

test("no inventa avisos intermedios ni reenvío tardío después de los hitos", () => {
  for (const today of ["2026-09-26", "2026-09-28", "2026-09-29", "2026-10-02", "2027-01-01"]) {
    assert.deepEqual(deriveCoachPaymentPeriod(input({ today })).dueEvents, [], today);
  }
});

test("repetir cálculo produce identidad estable; ledger informado suprime el evento lógico", () => {
  const first = deriveCoachPaymentPeriod(input());
  const again = deriveCoachPaymentPeriod(input());
  assert.deepEqual(again, first);
  const recordedEventKeys = new Set([first.dueEvents[0].eventKey]);
  const suppressed = available(deriveCoachPaymentPeriod(input({ recordedEventKeys })));
  assert.deepEqual(suppressed.dueEvents, []);
  assert.equal(suppressed.status, "expiring");
  assert.deepEqual([...recordedEventKeys], [first.dueEvents[0].eventKey]);
});

test("corregir fechas del mismo período no cambia la identidad del mismo hito", () => {
  const first = deriveCoachPaymentPeriod(input()).dueEvents[0];
  const corrected = input({ period: { ...period, end: "2026-10-02" }, today: "2026-09-29" });
  assert.equal(deriveCoachPaymentPeriod(corrected).dueEvents[0].eventKey, first.eventKey);
  assert.deepEqual(deriveCoachPaymentPeriod({ ...corrected, recordedEventKeys: new Set([first.eventKey]) }).dueEvents, []);
});

test("otro período confirmado o nuevo episodio de vínculo conserva eventos propios", () => {
  const originalKey = deriveCoachPaymentPeriod(input()).dueEvents[0].eventKey;
  const recordedEventKeys = new Set([originalKey]);
  const newPeriod = deriveCoachPaymentPeriod(input({ period: { ...period, id: "synthetic-period-2" }, recordedEventKeys }));
  const episodeId = "synthetic-link-2";
  const relink = deriveCoachPaymentPeriod(input({
    link: { episodeId, state: "active" }, period: { ...period, linkEpisodeId: episodeId }, recordedEventKeys,
  }));
  assert.equal(newPeriod.dueEvents.length, 1);
  assert.equal(relink.dueEvents.length, 1);
  assert.equal(new Set([originalKey, newPeriod.dueEvents[0].eventKey, relink.dueEvents[0].eventKey]).size, 3);
});

test("claves opacas con separadores no colisionan", () => {
  const keys = [["episode:a", "b"], ["episode", "a:b"], ["x\"],\"y", "z"], ["x", "y\"],\"z"]].map(([episodeId, id]) => (
    deriveCoachPaymentPeriod(input({ link: { episodeId, state: "active" }, period: { ...period, linkEpisodeId: episodeId, id } })).dueEvents[0].eventKey
  ));
  assert.equal(new Set(keys).size, keys.length);
});

test("vínculo null, invitación pendiente y baja no proyectan estados pagados ni generan avisos", () => {
  for (const value of [null, { ...link, state: "pending" }, { ...link, state: "inactive" }] as const) {
    for (const today of ["2026-09-27", "2026-09-30", "2026-10-01"]) {
      assert.deepEqual(deriveCoachPaymentPeriod(input({ link: value, today })), {
        kind: "not-applicable", reason: "link-not-active", dueEvents: [],
      });
    }
  }
});

test("período de otro vínculo falla cerrado, también tras volver a vincular", () => {
  assert.deepEqual(deriveCoachPaymentPeriod(input({ period: { ...period, linkEpisodeId: "other-link" } })), {
    kind: "unavailable", reason: "period-link-mismatch", dueEvents: [],
  });
});

test("período futuro no afirma vigencia todavía ni emite avisos antes de su inicio", () => {
  assert.deepEqual(deriveCoachPaymentPeriod(input({ today: "2026-08-31" })), {
    kind: "not-applicable", reason: "period-not-started", dueEvents: [],
  });
  const shortPeriod = { ...period, start: "2026-09-29" };
  assert.equal(deriveCoachPaymentPeriod(input({ period: shortPeriod })).kind, "not-applicable");
});

test("fechas inválidas o incompletas no se normalizan ni se convierten en sin período", () => {
  for (const date of ["", "2026-9-01", "2026-09-31", "2025-02-29", "1900-02-29", "0000-01-01", "10000-01-01", "2026-00-01", "2026-13-01", "2026-09-00", "2026-09-01T00:00:00Z", " 2026-09-01", "2026-09-01\n", "2026-09-01\r\n", "2026-09-01\u2028"]) {
    for (const field of ["start", "end"] as const) {
      assert.deepEqual(deriveCoachPaymentPeriod(input({ period: { ...period, [field]: date } })), {
        kind: "unavailable", reason: "invalid-period", dueEvents: [],
      }, `${field}: ${date}`);
    }
    assert.deepEqual(deriveCoachPaymentPeriod(input({ today: date })), {
      kind: "unavailable", reason: "invalid-today", dueEvents: [],
    }, date);
  }
  for (const end of [period.start, "2026-08-31"]) {
    assert.equal(deriveCoachPaymentPeriod(input({ period: { ...period, end } })).kind, "unavailable");
  }
});

test("identidad faltante impide crear clave de evento anónima o ambigua", () => {
  for (const id of ["", " ", " padded "]) {
    assert.deepEqual(deriveCoachPaymentPeriod(input({ period: { ...period, id } })), {
      kind: "unavailable", reason: "invalid-period", dueEvents: [],
    });
    assert.deepEqual(deriveCoachPaymentPeriod(input({ link: { ...link, episodeId: id } })), {
      kind: "unavailable", reason: "invalid-link", dueEvents: [],
    });
  }
});

test("aritmética civil respeta medianoche, DST, meses, años y bisiestos", () => {
  for (const [start, end, today, remaining] of [
    ["2026-09-01", "2026-09-08", "2026-09-05", 3],
    ["2026-09-01", "2026-09-08", "2026-09-06", 2],
    ["2026-12-01", "2027-01-02", "2026-12-30", 3],
    ["2024-02-01", "2024-03-01", "2024-02-27", 3],
    ["2025-02-01", "2025-03-01", "2025-02-26", 3],
    ["2000-02-01", "2000-03-01", "2000-02-29", 1],
    ["1900-02-01", "1900-03-01", "1900-02-28", 1],
    ["0001-01-01", "0001-01-04", "0001-01-01", 3],
    ["9999-12-01", "9999-12-31", "9999-12-28", 3],
  ] as const) {
    const view = available(deriveCoachPaymentPeriod(input({ period: { ...period, start, end }, today })));
    assert.equal(view.daysUntilEnd, remaining, `${today} → ${end}`);
  }
});

test("instantes adyacentes a medianoche Santiago cambian estado sólo al cambiar civil today", () => {
  const civil = (instant: string) => {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
    return ["year", "month", "day"].map((part) => parts.find(({ type }) => type === part)?.value).join("-");
  };
  const paid = { ...period, end: "2026-09-08" };
  const before = civil("2026-09-09T02:59:59.999Z");
  const after = civil("2026-09-09T03:00:00.000Z");
  assert.equal(before, "2026-09-08");
  assert.equal(after, "2026-09-09");
  assert.equal(available(deriveCoachPaymentPeriod(input({ period: paid, today: before }))).status, "expires-today");
  assert.equal(available(deriveCoachPaymentPeriod(input({ period: paid, today: after }))).status, "pending-confirmation");
});

test("crear/cambiar ciclo de entrenamiento no confirma, renueva ni modifica período pagado", () => {
  for (const cycle of [null, { id: "old", end: "2026-09-08" }, { id: "new", end: "2026-12-31" }]) {
    const value = { ...input({ period: null }), cycle };
    assert.equal(available(deriveCoachPaymentPeriod(value)).status, "not-recorded");
    const expired = { ...input({ today: "2026-10-01" }), cycle };
    assert.equal(available(deriveCoachPaymentPeriod(expired)).status, "pending-confirmation");
    assert.equal(expired.period?.end, "2026-09-30");
    assert.equal(expired.link?.state, "active");
  }
});

test("entrada, ledger y resultados no se mutan; no se copian campos ajenos al read model", () => {
  const value = Object.freeze(input({ recordedEventKeys: Object.freeze(new Set(["unrelated"])) }));
  const before = JSON.stringify({ ...value, recordedEventKeys: [...value.recordedEventKeys] });
  const result = deriveCoachPaymentPeriod(value);
  assert.equal(JSON.stringify({ ...value, recordedEventKeys: [...value.recordedEventKeys] }), before);
  for (const object of [result, result.dueEvents, result.dueEvents[0], result.dueEvents[0].recipients]) {
    assert.equal(Object.isFrozen(object), true);
  }
  assert.deepEqual(Object.keys(result).sort(), ["daysUntilEnd", "dueEvents", "kind", "status"]);
});

test("módulo puro no importa features ni usa reloj, storage, red, entrenamiento o entrega", () => {
  const source = readFileSync(new URL("./coach-payment-period.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s/m);
  assert.doesNotMatch(source, /\b(?:fetch|localStorage|sessionStorage)\b|Date\.UTC|Date\.parse|new Date\(|\.rpc\(|Math\.random|training_sessions|exercise_entries|setTimeout|setInterval/);
});
