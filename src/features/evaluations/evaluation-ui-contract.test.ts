import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coach = readFileSync("src/features/evaluations/components/coach-evaluations.tsx", "utf8");
const student = readFileSync("src/features/evaluations/components/student-evaluations.tsx", "utf8");
const model = readFileSync("src/features/evaluations/model/evaluation-types.ts", "utf8");
const root = readFileSync("src/components/organizatech-app.tsx", "utf8");

test("Coach cubre biblioteca, constructor, envío, snapshot y revisión aprobados", () => {
  for (const copy of ["Agregar", "Ocultar", "Evaluaciones enviadas", "Agregar más preguntas", "información sensible", "Extender fecha", "Recordar", "Ver respuesta"]) {
    assert.match(coach, new RegExp(copy));
  }
  assert.match(coach, /EVALUATION_TABLE_PRESETS/);
  assert.match(coach, /listOwnEvaluationStudents/);
});

test("Alumno cubre tabs, borrador, vencimiento, consentimiento exacto y tablas apiladas", () => {
  for (const copy of ["Pendientes", "Vencidas", "Completadas", "Guardar borrador", "El plazo para responder venció", "+ Agregar fila", "Evaluación enviada"]) {
    assert.ok(student.includes(copy), `Falta el texto aprobado: ${copy}`);
  }
  assert.match(model, /Confirmo que la información entregada \(salud, lesiones, medicación o alimentación\) es correcta y autorizo a mi coach vinculado a acceder a ella para ajustar mi plan\./);
  assert.doesNotMatch(student, /overflow-x|<table/);
});

test("el root sólo conecta pantalla y entradas; la lógica vive en la feature", () => {
  assert.match(root, /<StudentEvaluations /);
  assert.match(root, /<StudentEvaluationsEntry[\s\S]*location="home"/);
  assert.match(root, /<StudentEvaluationsEntry[\s\S]*location="profile"/);
  assert.doesNotMatch(root, /saveOwnEvaluationDraft|sendOwnEvaluationTemplate|EvaluationAnswers/);
});
