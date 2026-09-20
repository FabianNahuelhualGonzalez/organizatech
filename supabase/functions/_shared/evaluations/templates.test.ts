import assert from "node:assert/strict";
import test from "node:test";

import { renderEvaluationEmail } from "./templates.ts";

test("renderiza los cuatro correos aprobados sin contenido de respuestas", () => {
  const received = renderEvaluationEmail({
    eventKind: "evaluation_received", templateName: "Salud inicial", coachName: "Ada Lovelace",
    dueAt: "2026-09-22T03:00:00.000Z", actionUrl: "https://app.example.com/login?tipo=usuario",
  });
  assert.equal(received.subject, "Nueva evaluación de Ada Lovelace");
  assert.match(received.textContent, /Ada Lovelace te envió el formulario «Salud inicial»\./);
  assert.match(received.textContent, /Fecha límite: 22\/09\/2026\./);

  const sent = renderEvaluationEmail({
    eventKind: "evaluation_sent", templateName: "Salud inicial", studentNames: "Camila, Ignacio",
    actionUrl: "https://app.example.com/login?tipo=coach",
  });
  assert.equal(sent.subject, "Enviaste una evaluación");

  const completed = renderEvaluationEmail({
    eventKind: "evaluation_completed", templateName: "Salud inicial", studentName: "Camila",
    actionUrl: "https://app.example.com/login?tipo=coach",
  });
  assert.equal(completed.subject, "Camila respondió tu evaluación");

  const reminder = renderEvaluationEmail({
    eventKind: "evaluation_due_reminder", templateName: "Salud inicial", coachName: "Ada Lovelace",
    dueLabel: "22/09/2026", actionUrl: "https://app.example.com/login?tipo=usuario",
  });
  assert.equal(reminder.subject, "Recordatorio: «Salud inicial» está pendiente");
  assert.match(reminder.textContent, /Tienes hasta el 22\/09\/2026/);

  const reminderWithoutDueDate = renderEvaluationEmail({
    eventKind: "evaluation_due_reminder", templateName: "Salud inicial", coachName: "Ada Lovelace",
    dueLabel: null, actionUrl: "https://app.example.com/login?tipo=usuario",
  });
  assert.match(reminderWithoutDueDate.textContent, /Aún tienes pendiente responder/);
  assert.doesNotMatch([received, sent, completed, reminder].map((item) => item.textContent).join("\n"), /respuesta clínica|lesión real/i);
});
