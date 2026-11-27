import assert from "node:assert/strict";
import test from "node:test";

import { renderTrainingCycleLifecycleEmail } from "./templates";

test("coach cycle activation email uses the existing student notification", () => {
  const rendered = renderTrainingCycleLifecycleEmail({ eventKind: "coach_updated",
    scheduledOn: "2026-11-27", title: "Tu coach actualizó tu rutina",
    body: "Tu coach creó un nuevo ciclo de entrenamiento. Revisa la rutina antes de entrenar.",
    appUrl: "https://qa.organizatech.cl" });
  assert.match(rendered.subject, /Tu coach actualizó tu rutina/);
  assert.match(rendered.htmlContent, /RUTINA · ACTUALIZACIÓN DEL COACH/);
});

test("renderiza lifecycle seguro con identidad visual y campana separada", () => {
  const rendered = renderTrainingCycleLifecycleEmail({
    eventKind: "expires_t1",
    scheduledOn: "2026-09-07",
    title: "Mañana termina <tu ciclo>",
    body: "Extiende & confirma el plan.",
    appUrl: "https://qa.organizatech.cl/login?ignored=true",
  });

  assert.equal(rendered.subject, "Mañana termina <tu ciclo>");
  assert.match(rendered.htmlContent, /background:#07101A/);
  assert.match(rendered.htmlContent, /Mañana termina &lt;tu ciclo&gt;/);
  assert.match(rendered.htmlContent, /Extiende &amp; confirma el plan/);
  assert.doesNotMatch(rendered.htmlContent, /<tu ciclo>/);
  assert.match(rendered.textContent, /CICLO · T-1/);
  assert.match(rendered.textContent, /campana de Organizatech/);
});

test("rechaza evento, URL, fecha y contenido no allowlisted", () => {
  const base = {
    eventKind: "expires_t3" as const,
    scheduledOn: "2026-09-07",
    title: "Quedan 3 días",
    body: "Puedes extender el ciclo.",
    appUrl: "https://qa.organizatech.cl",
  };

  assert.throws(() => renderTrainingCycleLifecycleEmail({
    ...base,
    appUrl: "http://qa.organizatech.cl",
  }));
  assert.throws(() => renderTrainingCycleLifecycleEmail({
    ...base,
    scheduledOn: "07-09-2026",
  }));
  assert.throws(() => renderTrainingCycleLifecycleEmail({
    ...base,
    title: "texto\u0000inválido",
  }));
});
