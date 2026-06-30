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

{
  const chart = buildWeeklyProgressChart({
    currentSeries: [
      { label: "L", value: -65, comparable: true },
      { label: "M", value: -40.25, comparable: true },
      { label: "X", value: -40.25, comparable: true },
      { label: "J", value: null, comparable: false },
      { label: "V", value: null, comparable: false },
    ],
    previousSeries: [
      { label: "L", value: -70, comparable: true },
      { label: "M", value: -42, comparable: true },
      { label: "X", value: -17, comparable: true },
      { label: "J", value: -2, comparable: true },
      { label: "V", value: 0, comparable: true },
    ],
  });

  assert.deepEqual(chart.labels, ["L", "M", "X", "J", "V"]);
  assert.equal(chart.currentPoints.length, 5);
  assert.equal(chart.previousPoints.length, 5);
  assert.equal(chart.activeIndex, 2, "destaca el ultimo punto real de la semana actual");
  assert.equal(chart.currentPoints[3].y, null, "los dias futuros no tienen punto real");
  assert.equal(chart.previousPoints[4].value, 0, "la semana anterior permanece completa");
  assert.equal(chart.points.length, 3, "la linea actual no se extiende hacia valores futuros null");
  assert.deepEqual(chart.axisLabels, ["+70%", "+35%", "0%", "-35%", "-70%"]);
}

{
  const chart = buildWeeklyProgressChart({
    currentSeries: [{ label: "L", value: null, comparable: false }],
    previousSeries: [{ label: "L", value: 0, comparable: true }],
  });

  assert.deepEqual(chart.labels, ["L"]);
  assert.equal(chart.activeIndex, 0);
  assert.equal(chart.currentPoints[0].x, 240);
  assert.equal(chart.currentPoints[0].y, null);
  assert.equal(chart.previousPoints[0].y !== null, true, "un solo punto anterior sigue siendo visible");
}

console.log("weekly-progress-chart tests passed");
