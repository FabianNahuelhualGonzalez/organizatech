import assert from "node:assert/strict";
import { sortTrainingDaysByWeekOrder } from "./training-day-order";

assert.deepEqual(
  sortTrainingDaysByWeekOrder(["Lunes", "Miércoles", "Martes"]),
  ["Lunes", "Martes", "Miércoles"],
  "volver a seleccionar Martes lo devuelve a su posicion semanal",
);

assert.deepEqual(
  sortTrainingDaysByWeekOrder(["Viernes", "Lunes", "Martes"]),
  ["Lunes", "Martes", "Viernes"],
  "una seleccion arbitraria se ordena por semana",
);

assert.deepEqual(
  sortTrainingDaysByWeekOrder(["Jueves", "Lunes", "Miércoles", "Martes"]),
  ["Lunes", "Martes", "Miércoles", "Jueves"],
  "datos persistidos desordenados se normalizan al cargar",
);

assert.deepEqual(
  sortTrainingDaysByWeekOrder(["Domingo", "Viernes", "Sábado"]),
  ["Viernes", "Sábado", "Domingo"],
  "el fin de semana queda despues de Viernes",
);

const selectedDays = ["sunday", "monday", "friday", "tuesday"];
const sortedDays = sortTrainingDaysByWeekOrder(selectedDays);
assert.deepEqual(
  sortedDays,
  ["monday", "tuesday", "friday", "sunday"],
  "los codigos cycle-scoped usan el mismo orden canonico",
);
assert.deepEqual(
  new Set(sortedDays),
  new Set(selectedDays),
  "ordenar no elimina ningun dia seleccionado",
);

console.log("Pruebas de orden semanal de dias OK");
