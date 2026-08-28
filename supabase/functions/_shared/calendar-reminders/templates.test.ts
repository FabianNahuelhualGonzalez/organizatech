import assert from "node:assert/strict";
import test from "node:test";

import { renderCalendarReminderEmail } from "./templates";

test("renderiza HTML y texto seguros con identidad visual Organizatech", () => {
  const rendered = renderCalendarReminderEmail({
    title: "Control <final>",
    description: "Revisar & confirmar \"avance\"",
    occurrenceOn: "2026-09-07",
    reminderTime: "09:30:00",
    appUrl: "https://qa.organizatech.cl/login?ignored=true",
  });

  assert.equal(rendered.subject, "Recordatorio: Control <final>");
  assert.match(rendered.htmlContent, /background:#07101A/);
  assert.match(rendered.htmlContent, /Control &lt;final&gt;/);
  assert.match(rendered.htmlContent, /Revisar &amp; confirmar &quot;avance&quot;/);
  assert.doesNotMatch(rendered.htmlContent, /<final>/);
  assert.match(rendered.textContent, /2026-09-07 · 09:30 · America\/Santiago/);
  assert.match(rendered.textContent, /https:\/\/qa\.organizatech\.cl\//);
});

test("rechaza URLs, fechas, horas y contenido no allowlisted", () => {
  const base = {
    title: "Recordatorio",
    description: "Detalle",
    occurrenceOn: "2026-09-07",
    reminderTime: "09:30",
    appUrl: "https://qa.organizatech.cl",
  };
  for (const candidate of [
    { ...base, appUrl: "http://qa.organizatech.cl" },
    { ...base, appUrl: "https://user:pass@qa.organizatech.cl" },
    { ...base, occurrenceOn: "07-09-2026" },
    { ...base, reminderTime: "25:00" },
    { ...base, title: "mal\u0000texto" },
  ]) assert.throws(() => renderCalendarReminderEmail(candidate));
});
