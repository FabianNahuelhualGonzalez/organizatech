import assert from "node:assert/strict";
import test from "node:test";

import { renderCoachInvitationEmail, renderCoachLinkEmail } from "./templates";

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

test("invitación a alumno sin cuenta incluye código, vencimiento y CTA de registro sin código en URL", () => {
  const rendered = renderCoachInvitationEmail({ audience: "student", recipientFirstName: null,
    coachName: "Coach Marcos Díaz", invitedEmail: "sofia@example.com",
    invitationCode: "AB2-CD3-EF4", expiresAt: "2026-09-24T12:00:00.000Z",
    recipientHasAccount: false,
    actionUrl: "https://app.organizatech.cl/login?mode=registro&tipo=usuario&coachLinkDestination=profile-coaching" });
  for (const copy of ["Coach Marcos Díaz te invitó", "Crea tu cuenta con exactamente este correo",
    "Perfil > Coaching", "Código de vinculación: AB2-CD3-EF4", "Crear mi cuenta",
    "El vínculo no se activa automáticamente"]) assert.ok(rendered.textContent.includes(copy), copy);
  assert.doesNotMatch(rendered.htmlContent, /coachCode|AB2-CD3-EF4[^<]*href=/);
});

test("invitación a cuenta existente y copia coach conservan correo, código e instrucciones", () => {
  const student = renderCoachInvitationEmail({ audience: "student", recipientFirstName: "Sofía",
    coachName: "Coach Marcos Díaz", invitedEmail: "sofia@example.com",
    invitationCode: "AB2-CD3-EF4", expiresAt: "2026-09-24T12:00:00.000Z",
    recipientHasAccount: true,
    actionUrl: "https://app.organizatech.cl/login?tipo=usuario&coachLinkDestination=profile-coaching" });
  assert.match(student.textContent, /Inicia sesión con este mismo correo/);
  assert.match(student.textContent, /Ingresar a Organizatech/);

  const coach = renderCoachInvitationEmail({ audience: "coach", recipientFirstName: "Marcos",
    coachName: "Coach Marcos Díaz", invitedEmail: "sofia@example.com",
    invitationCode: "AB2-CD3-EF4", expiresAt: "2026-09-24T12:00:00.000Z",
    recipientHasAccount: false, actionUrl: "https://app.organizatech.cl/login?tipo=coach" });
  assert.equal(coach.subject, "Código de vinculación creado para sofia@example.com");
  for (const copy of ["dirigido exclusivamente a sofia@example.com", "Código de vinculación: AB2-CD3-EF4",
    "Perfil > Coaching", "Abrir Panel Coach"]) assert.ok(coach.textContent.includes(copy), copy);
});
