import assert from "node:assert/strict";

import { buildWeeklyProgressChart } from "@/lib/progress/weekly-progress-chart";

{
  const chart = buildWeeklyProgressChart({
    weekDays: ["Lunes", "Miercoles", "Viernes"],
    currentDay: "Miercoles",
    value: 2.5,
  });

  assert.deepEqual(chart.labels, ["L", "X", "V"]);
  assert.equal(chart.points.length, 3);
  assert.equal(chart.values.length, 3);
  assert.equal(chart.activeIndex, 1);
  assert.equal(chart.values[1], 2.5);
}

{
  const chart = buildWeeklyProgressChart({
    weekDays: ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"],
    currentDay: "Viernes",
    value: 8,
  });

  assert.deepEqual(chart.labels, ["L", "M", "X", "J", "V"]);
  assert.equal(chart.points.length, 5);
  assert.equal(chart.activeIndex, 4);
  assert.equal(chart.values[4], 4, "el valor semanal se acota al rango visual");
}

{
  const chart = buildWeeklyProgressChart({
    weekDays: ["Martes", "Jueves", "Sabado"],
    currentDay: "Domingo",
    value: -9,
  });

  assert.deepEqual(chart.labels, ["M", "J", "S"]);
  assert.equal(chart.activeIndex, 2, "si hoy no esta configurado, se destaca el ultimo dia del plan");
  assert.equal(chart.values[2], -4);
}

{
  const chart = buildWeeklyProgressChart({
    weekDays: [],
    currentDay: "Lunes",
    value: 1,
  });

  assert.deepEqual(chart.labels, ["L", "M", "X", "J", "V", "S", "D"]);
}

console.log("weekly-progress-chart tests passed");
