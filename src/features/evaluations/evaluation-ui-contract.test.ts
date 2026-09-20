import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coach = readFileSync("src/features/evaluations/components/coach-evaluations.tsx", "utf8");
const student = readFileSync("src/features/evaluations/components/student-evaluations.tsx", "utf8");
const model = readFileSync("src/features/evaluations/model/evaluation-types.ts", "utf8");

test("Coach cubre biblioteca, constructor, envío, snapshot y revisión aprobados", () => {
  for (const copy of ["+ Agregar", "Evaluaciones enviadas", "Agregar más preguntas", "Esta evaluación solicita datos sensibles.", "Al marcarla, el alumno deberá aceptar responder preguntas sobre salud, lesiones, medicación o alimentación.", "Extender fecha", "Recordar", "Ver respuesta"]) {
    assert.ok(coach.includes(copy), `Falta el texto aprobado: ${copy}`);
  }
  assert.doesNotMatch(coach, /Ocultar|ocultar/);
  assert.match(coach, /aria-label=\{`Eliminar \$\{template\.name\}`\}/);
  assert.match(coach, /Confirmar eliminación/);
  assert.match(coach, /deleteOwnEvaluationTemplate/);
  assert.match(coach, /EVALUATION_TABLE_PRESETS/);
  assert.match(coach, /listOwnEvaluationStudents/);
  assert.match(coach, /La evaluación fue creada, pero el correo está pendiente de reintento/);
  assert.match(coach, /El recordatorio fue creado, pero el correo está pendiente de reintento/);
});

test("envío móvil mantiene controles equivalentes sin overflow horizontal", () => {
  const css = readFileSync("src/features/evaluations/components/evaluations.module.css", "utf8");
  for (const className of ["sendForm", "sendControl", "dateField"]) {
    assert.match(coach, new RegExp(`styles\\.${className}`));
    assert.match(css, new RegExp(`\\.${className}`));
  }
  assert.match(css, /\.sendControl \{[\s\S]*width: 100%;[\s\S]*min-width: 0;[\s\S]*max-width: 100%/);
  assert.match(css, /\.dateField \{[\s\S]*inline-size: 100%;[\s\S]*min-inline-size: 0;[\s\S]*max-inline-size: 100%;[\s\S]*overflow: hidden/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*min-inline-size: 0;[\s\S]*max-inline-size: 100%/);
  assert.match(css, /\.pillButton \{[\s\S]*white-space: nowrap/);
});

test("resultado de alumno separa nombre completo y correo en dos líneas", () => {
  assert.match(coach, /styles\.listButton[\s\S]*<strong>\{student\.name\}<\/strong><span>\{student\.email\}<\/span>/);
  assert.match(readFileSync("src/features/evaluations/components/evaluations.module.css", "utf8"), /\.listButton strong,[\s\S]*\.listButton span \{[\s\S]*display: block/);
});

test("Alumno cubre tabs, borrador, vencimiento, consentimiento exacto y tablas apiladas", () => {
  for (const copy of ["Pendientes", "Vencidas", "Completadas", "Guardar borrador", "El plazo para responder venció", "+ Agregar fila", "Evaluación enviada"]) {
    assert.ok(student.includes(copy), `Falta el texto aprobado: ${copy}`);
  }
  assert.match(model, /Confirmo que la información entregada \(salud, lesiones, medicación o alimentación\) es correcta y autorizo a mi coach vinculado a acceder a ella para ajustar mi plan\./);
  assert.doesNotMatch(student, /overflow-x|<table/);
  assert.match(student, /La evaluación fue enviada, pero el correo al coach está pendiente de reintento/);
});
