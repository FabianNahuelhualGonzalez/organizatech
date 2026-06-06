import assert from "node:assert/strict";
import { getCycleScopedPlannedDate } from "./cycle-scoped-planned-date";

assert.equal(
  getCycleScopedPlannedDate({
    cyclePlannedStartDate: "2026-06-04",
    cyclePlannedEndDate: "2026-06-10",
    weekIndex: 1,
    dayCode: "tuesday",
  }),
  "2026-06-09",
  "calcula el martes de Ciclo 6 dentro de su rango real",
);

assert.equal(
  getCycleScopedPlannedDate({
    cyclePlannedStartDate: "2026-06-04",
    cyclePlannedEndDate: "2026-06-24",
    weekIndex: 2,
    dayCode: "tuesday",
  }),
  "2026-06-16",
  "calcula semanas posteriores desde el inicio del ciclo",
);

assert.throws(
  () => getCycleScopedPlannedDate({
    cyclePlannedStartDate: "2026-06-04",
    cyclePlannedEndDate: "2026-06-08",
    weekIndex: 1,
    dayCode: "tuesday",
  }),
  /fuera del rango del ciclo/,
  "rechaza dias que quedan fuera de un rango parcial",
);

assert.throws(
  () => getCycleScopedPlannedDate({
    cyclePlannedStartDate: "2026-06-04",
    cyclePlannedEndDate: "2026-06-10",
    weekIndex: 0,
    dayCode: "tuesday",
  }),
  /mayor o igual a 1/,
  "rechaza indices de semana invalidos",
);

console.log("Pruebas de fecha planificada cycle-scoped OK");
