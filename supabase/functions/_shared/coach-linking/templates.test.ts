import assert from "node:assert/strict";
import test from "node:test";

import { renderCoachLinkEmail } from "./templates";

test("correo alumno conserva asunto, cuerpo, CTA y destino aprobados", () => {
  const rendered = renderCoachLinkEmail({ audience: "student", recipientFirstName: "Sofía",
    coachName: "Coach Marcos Díaz", studentName: "Sofía Reyes",
    actionUrl: "https://app.organizatech.cl/login?tipo=usuario&coachLinkDestination=profile-coaching" });
  assert.equal(rendered.subject, "Te vinculaste con Coach Marcos Díaz");
  for (const copy of ["Vinculación confirmada", "Hola Sofía,",
    "Te vinculaste con Coach Marcos Díaz en Organizatech.",
    "A partir de ahora puede ver tus entrenamientos y crear o editar tus rutinas.",
    "Puedes desvincularte cuando quieras desde tu perfil; tu historial se conserva.",
    "Ver mi coach", "Este correo se envió porque tu cuenta se vinculó con un coach en Organizatech."]) {
    assert.ok(rendered.textContent.includes(copy), copy);
  }
});

test("correo coach conserva asunto, cuerpo, CTA y escapa nombres", () => {
  const rendered = renderCoachLinkEmail({ audience: "coach", recipientFirstName: "Marcos",
    coachName: "Coach Marcos Díaz", studentName: "Sofía <Reyes>",
    actionUrl: "https://app.organizatech.cl/login?tipo=coach&coachLinkEpisode=00000000-0000-4000-8000-000000000001" });
  assert.equal(rendered.subject, "Nuevo alumno vinculado: Sofía <Reyes>");
  for (const copy of ["Nuevo alumno vinculado", "Hola Marcos,",
    "Sofía <Reyes> se vinculó a tu cuenta usando tu código de invitación.",
    "Ya puedes ver sus entrenamientos y crear o editar sus rutinas desde tu dashboard.",
    "Ver alumno", "Este correo se envió porque un alumno usó tu código de vinculación en Organizatech."]) {
    assert.ok(rendered.textContent.includes(copy), copy);
  }
  assert.doesNotMatch(rendered.htmlContent, /Sofía <Reyes>/);
  assert.match(rendered.htmlContent, /Sofía &lt;Reyes&gt;/);
});
