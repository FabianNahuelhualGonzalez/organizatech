import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { TrainingDayCode } from "@/lib/progress/types";
import { getCycleScopedPlannedDate } from "@/lib/training/cycle-scoped-planned-date";
import {
  calculateCoachAverageTenureDays,
  calculateCoachCycleProgress,
  type CoachCycleMetricPlan,
  type CoachTenureEpisode,
} from "./coach-cycle-metrics";

const weekdays: readonly TrainingDayCode[] = Object.freeze([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);
const plan: CoachCycleMetricPlan = Object.freeze({
  startsOn: "2026-09-07", endsOn: "2026-09-20", selectedDays: Object.freeze(["monday", "wednesday", "friday"] as const),
});
function progress(overrides: Partial<CoachCycleMetricPlan> = {}, completedSessions: number | null = 2) {
  return calculateCoachCycleProgress({ plan: { ...plan, ...overrides }, completedSessions });
}
function ended(startedOn: string | null, endedOn: string | null): CoachTenureEpisode {
  return Object.freeze({ state: "ended", startedOn, endedOn });
}

test("cumplimiento es realizadas explícitas / total planeado del ciclo completo", () => {
  assert.deepEqual(progress(), { completedSessions: 2, plannedSessions: 6, progressRatio: 1 / 3 });
  assert.deepEqual(progress({}, 0), { completedSessions: 0, plannedSessions: 6, progressRatio: 0 });
  assert.deepEqual(progress({}, 6), { completedSessions: 6, plannedSessions: 6, progressRatio: 1 });
});

test("sesiones extra conservan fracción >1 sin clamp, pérdida de datos o error inventado", () => {
  assert.deepEqual(progress({}, 9), { completedSessions: 9, plannedSessions: 6, progressRatio: 1.5 });
  assert.deepEqual(progress({ startsOn: "2026-09-07", endsOn: "2026-09-07", selectedDays: ["monday"] }, Number.MAX_SAFE_INTEGER), {
    completedSessions: Number.MAX_SAFE_INTEGER, plannedSessions: 1, progressRatio: Number.MAX_SAFE_INTEGER,
  });
});

test("conteo null/incorrecto conserva plan conocido, sin inventar cero", () => {
  for (const count of [null, -1, 0.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "2" as never]) {
    assert.deepEqual(progress({}, count), { completedSessions: null, plannedSessions: 6, progressRatio: null });
  }
  assert.deepEqual(progress({}, -0), { completedSessions: 0, plannedSessions: 6, progressRatio: 0 });
});

test("ausencia de ciclo o datos de plan incompletos no inventan denominador", () => {
  assert.deepEqual(calculateCoachCycleProgress({ plan: null, completedSessions: null }), {
    completedSessions: null, plannedSessions: null, progressRatio: null,
  });
  for (const override of [{ startsOn: null }, { endsOn: null }, { selectedDays: null }]) {
    assert.deepEqual(progress(override), { completedSessions: 2, plannedSessions: null, progressRatio: null });
  }
});

test("rango inclusivo cuenta exactamente inicio/fin y no semanas redondeadas", () => {
  assert.equal(progress({ startsOn: "2026-09-07", endsOn: "2026-09-07", selectedDays: ["monday"] }).plannedSessions, 1);
  assert.equal(progress({ startsOn: "2026-09-08", endsOn: "2026-09-08", selectedDays: ["monday"] }).plannedSessions, 0);
  assert.equal(progress({ startsOn: "2026-09-01", endsOn: "2026-09-30", selectedDays: ["monday"] }).plannedSessions, 4);
  assert.equal(progress({ startsOn: "2026-09-01", endsOn: "2026-09-30", selectedDays: ["tuesday"] }).plannedSessions, 5);
  assert.equal(progress({ startsOn: "2026-09-01", endsOn: "2026-09-30", selectedDays: weekdays }).plannedSessions, 30);
});

test("plan vacío conocido o sin ocurrencias tiene cero sesiones y razón indefinida, no NaN", () => {
  assert.deepEqual(progress({ selectedDays: [] }, 0), { completedSessions: 0, plannedSessions: 0, progressRatio: null });
  assert.deepEqual(progress({ selectedDays: [] }, 4), { completedSessions: 4, plannedSessions: 0, progressRatio: null });
  assert.deepEqual(progress({ startsOn: "2026-09-08", endsOn: "2026-09-08", selectedDays: ["monday"] }, 0), {
    completedSessions: 0, plannedSessions: 0, progressRatio: null,
  });
});

test("días duplicados, desconocidos, aliases y arreglos malformados invalidan plan sin dedup silenciosa", () => {
  for (const selectedDays of [
    ["monday", "monday"], ["tuesday", "wednesday", "tuesday"], [...weekdays, "monday"],
    ["Lunes"], ["Monday"], [" monday"], ["mon"], ["__proto__"], [null], [0], new Array(1), "monday", {},
  ]) {
    assert.deepEqual(progress({ selectedDays: selectedDays as readonly TrainingDayCode[] }), {
      completedSessions: 2, plannedSessions: null, progressRatio: null,
    });
  }
  assert.deepEqual(progress({ selectedDays: ["friday", "monday", "wednesday"] }), progress());
});

test("fechas no civiles, no canónicas, fuera de rango e invertidas se rechazan sin normalización", () => {
  for (const date of [
    "", "2026-9-07", "2026-09-31", "2025-02-29", "1900-02-29", "0000-01-01", "10000-01-01",
    "2026-00-01", "2026-13-01", "2026-09-00", "2026-09-07T00:00:00Z", " 2026-09-07", "2026-09-07\n", "2026-09-07\r\n", "2026-09-07\u2028",
  ]) {
    assert.equal(progress({ startsOn: date }).plannedSessions, null, date);
    assert.equal(progress({ endsOn: date }).plannedSessions, null, date);
  }
  assert.equal(progress({ endsOn: "2026-09-06" }).plannedSessions, null);
});

test("cálculo coincide con helper canónico cycle-scoped en rangos parciales, cambio de año y DST", () => {
  for (const [startsOn, endsOn] of [
    ["2026-09-01", "2026-10-20"], ["2026-12-27", "2027-01-07"], ["2024-02-27", "2024-03-10"],
    ["2026-04-01", "2026-04-10"], ["2026-09-06", "2026-09-06"],
  ]) {
    for (const selectedDays of [weekdays, ["monday", "thursday"] as const, ["sunday"] as const]) {
      let expected = 0;
      for (let weekIndex = 1; weekIndex <= 8; weekIndex += 1) {
        for (const dayCode of selectedDays) {
          try {
            getCycleScopedPlannedDate({ cyclePlannedStartDate: startsOn, cyclePlannedEndDate: endsOn, weekIndex, dayCode });
            expected += 1;
          } catch {
            // The canonical helper rejects only dates/weeks beyond these valid ranges.
          }
        }
      }
      assert.equal(progress({ startsOn, endsOn, selectedDays }).plannedSessions, expected, `${startsOn} → ${endsOn}: ${selectedDays}`);
    }
  }
});

test("bisiestos gregorianos y extremos 0001–9999 usan días civiles exactos sin iterar cada fecha", () => {
  for (const [startsOn, endsOn, expected] of [
    ["0001-01-01", "0001-01-07", 7], ["0099-12-31", "0100-01-01", 2],
    ["1900-02-28", "1900-03-01", 2], ["2000-02-28", "2000-03-01", 3],
    ["2024-02-28", "2024-03-01", 3], ["2025-02-28", "2025-03-01", 2],
    ["9999-12-25", "9999-12-31", 7], ["0001-01-01", "9999-12-31", 3_652_059],
  ] as const) assert.equal(progress({ startsOn, endsOn, selectedDays: weekdays }).plannedSessions, expected);
  assert.equal(progress({ startsOn: "0001-01-01", endsOn: "0001-01-01", selectedDays: ["monday"] }).plannedSessions, 1);
});

test("mover ejecución a otro día no resta sesiones ni genera faltas", () => {
  const baseline = { plan, completedSessions: 2 };
  for (const actualExecutionDates of [["2026-09-07", "2026-09-09"], ["2026-09-08", "2026-09-10"], ["2026-09-12", "2026-09-13"]]) {
    assert.deepEqual(calculateCoachCycleProgress({ ...baseline, actualExecutionDates } as typeof baseline), calculateCoachCycleProgress(baseline));
  }
});

test("ciclo futuro no inventa realizadas, faltas o predicción; cero exige dato explícito", () => {
  const futurePlan = { startsOn: "2090-01-01", endsOn: "2090-01-07", selectedDays: weekdays };
  assert.deepEqual(calculateCoachCycleProgress({ plan: futurePlan, completedSessions: null }), {
    completedSessions: null, plannedSessions: 7, progressRatio: null,
  });
  assert.deepEqual(calculateCoachCycleProgress({ plan: futurePlan, completedSessions: 0 }), {
    completedSessions: 0, plannedSessions: 7, progressRatio: 0,
  });
  assert.deepEqual(Object.keys(calculateCoachCycleProgress({ plan: futurePlan, completedSessions: 0 })).sort(), [
    "completedSessions", "plannedSessions", "progressRatio",
  ]);
});

test("permanencia es media de días civiles end-start sólo de episodios finalizados", () => {
  assert.equal(calculateCoachAverageTenureDays([
    ended("2026-09-01", "2026-09-11"), ended("2026-09-01", "2026-09-22"),
  ]), 15.5);
  assert.equal(calculateCoachAverageTenureDays([ended("2026-09-01", "2026-09-01")]), 0);
});

test("episodios activos se excluyen completamente, sin usar hoy ni simular su cierre", () => {
  assert.equal(calculateCoachAverageTenureDays([
    ended("2026-09-01", "2026-09-11"),
    { state: "active", startedOn: "2000-01-01", endedOn: null },
    { state: "active", startedOn: null, endedOn: null },
    { state: "active", startedOn: "not-a-date", endedOn: null },
  ]), 10);
});

test("sin episodios finalizados o fuente ausente permanece null, no cero", () => {
  assert.equal(calculateCoachAverageTenureDays(null), null);
  assert.equal(calculateCoachAverageTenureDays([]), null);
  assert.equal(calculateCoachAverageTenureDays([{ state: "active", startedOn: "2026-01-01", endedOn: null }]), null);
});

test("finalizado incompleto o inválido vuelve desconocida toda la media sin excluirlo silenciosamente", () => {
  for (const invalid of [
    ended(null, "2026-09-01"), ended("2026-09-01", null), ended("2026-09-02", "2026-09-01"),
    ended("2026-02-30", "2026-09-01"), ended("2026-01-01", "2026-09-31"),
    ended("2026-09-01T00:00:00Z", "2026-09-02"), ended("0000-01-01", "0001-01-01"),
  ]) assert.equal(calculateCoachAverageTenureDays([ended("2026-08-01", "2026-09-01"), invalid]), null);
  for (const episodes of [[null], [{}], [{ state: "unknown" }], new Array(1), "ended"]) {
    assert.equal(calculateCoachAverageTenureDays(episodes as readonly CoachTenureEpisode[]), null);
  }
});

test("permanencia civil no confunde DST, bisiestos o cambio de año con bloques de 24 horas", () => {
  for (const [start, end, expected] of [
    ["2026-09-05", "2026-09-07", 2], ["2026-04-04", "2026-04-06", 2],
    ["2026-12-31", "2027-01-01", 1], ["2024-02-28", "2024-03-01", 2],
    ["2025-02-28", "2025-03-01", 1], ["1900-02-28", "1900-03-01", 1],
    ["2000-02-28", "2000-03-01", 2], ["0001-01-01", "9999-12-31", 3_652_058],
  ] as const) assert.equal(calculateCoachAverageTenureDays([ended(start, end)]), expected);
});

test("modelo y media son deterministas, no mutan fuentes congeladas ni alteran entrenamiento", () => {
  const episodes = Object.freeze([ended("2026-09-01", "2026-09-10"), ended("2026-09-10", "2026-09-11")]);
  const originalPlan = JSON.stringify(plan);
  const originalEpisodes = JSON.stringify(episodes);
  const result = calculateCoachCycleProgress(Object.freeze({ plan, completedSessions: 2 }));
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(calculateCoachCycleProgress({ plan, completedSessions: 2 }), result);
  assert.equal(calculateCoachAverageTenureDays(episodes), 5);
  assert.equal(calculateCoachAverageTenureDays(episodes), 5);
  assert.equal(JSON.stringify(plan), originalPlan);
  assert.equal(JSON.stringify(episodes), originalEpisodes);
});

test("módulo no agrega I/O, reloj, persistencia, cálculos monetarios o dependencias runtime de features", () => {
  const source = readFileSync(new URL("./coach-cycle-metrics.ts", import.meta.url), "utf8");
  assert.match(source, /^import type \{ TrainingDayCode \} from "@\/lib\/progress\/types";/);
  assert.doesNotMatch(source, /^import (?!type\b)/m);
  assert.doesNotMatch(source, /\b(?:fetch|localStorage|sessionStorage)\b|Date\.UTC|Date\.parse|Date\.now|new Date\(|\.rpc\(|training_sessions|exercise_entries|setTimeout|setInterval|feeClp|confirmedPayments/);
});
