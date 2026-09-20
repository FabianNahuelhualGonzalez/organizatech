import assert from "node:assert/strict";
import test from "node:test";

import {
  coachEvaluationStatusCopy,
  formatEvaluationDate,
  formatEvaluationDateInput,
  questionsForSave,
  summarizeCoachEvaluationAssignments,
  validateEvaluationForSubmit,
  type EvaluationSnapshot,
} from "./evaluation-types";

const snapshot: EvaluationSnapshot = {
  templateOriginId: "00000000-0000-4000-8000-000000000001",
  name: "Salud inicial",
  sensitive: true,
  questions: [
    { id: "q1", text: "Lesiones", required: true, mode: "text" },
    {
      id: "q2", text: "Medicamentos", required: true, mode: "table", preset: "medications",
      columns: [{ id: "c1", label: "Medicamento" }],
    },
  ],
};

test("el borrador de plantilla descarta preguntas incompletas y conserva la allowlist", () => {
  const result = questionsForSave([
    { id: "q0", text: " ", required: false, mode: "text" },
    { id: "q1", text: " Lesiones ", required: true, mode: "text", guidance: "no permitido" },
    { id: "q2", text: "Tabla", required: false, mode: "table", columns: [{ id: "c", label: " " }] },
  ]);
  assert.deepEqual(result, [{ id: "q1", text: "Lesiones", required: true, mode: "text" }]);
});

test("enviar valida obligatorias y consentimiento, guardar borrador no usa esta validación", () => {
  assert.deepEqual([...validateEvaluationForSubmit(snapshot, {}, false)].sort(), ["consent", "q1", "q2"]);
  assert.equal(validateEvaluationForSubmit(snapshot, {
    q1: "Sin lesiones",
    q2: { rows: [{ id: "r1", values: { c1: "Ninguno" } }] },
  }, true).size, 0);
});

test("la fecha para editar conserva el día civil de Santiago", () => {
  assert.equal(formatEvaluationDate("2026-09-23T02:59:59.999Z"), "22/09/2026");
  assert.equal(formatEvaluationDateInput("2026-09-23T02:59:59.999Z"), "2026-09-22");
});

test("el estado del formulario no se reemplaza por la metadata de recordatorios", () => {
  assert.equal(coachEvaluationStatusCopy("pending"), "Formulario pendiente de responder.");
  assert.equal(coachEvaluationStatusCopy("draft"), "Formulario pendiente de responder.");
  assert.equal(coachEvaluationStatusCopy("completed"), "Formulario respondido — OK.");
  assert.equal(coachEvaluationStatusCopy("expired"), "Formulario vencido.");
});

test("el resumen del envío cuenta formularios y recordatorios por separado", () => {
  assert.deepEqual(summarizeCoachEvaluationAssignments([
    { status: "pending", reminderCount: 2, canRemind: true },
    { status: "draft", reminderCount: 1, canRemind: true },
    { status: "completed", reminderCount: 3, canRemind: false },
    { status: "expired", reminderCount: 0, canRemind: false },
  ]), { sent: 4, pending: 2, responded: 1, reminders: 6, remindable: 2 });
});
