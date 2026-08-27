import assert from "node:assert/strict";
import test from "node:test";

import {
  renderEmailTemplate,
  renderNeutralAuthEmail,
  type OrganizatechEmailTemplateKind,
} from "./templates";

const ACTION_URL = "https://organizatech.cl/login?flow=email-onboarding";

const templateCases: ReadonlyArray<{
  kind: OrganizatechEmailTemplateKind;
  expected: readonly string[];
}> = [
  {
    kind: "confirmation_user",
    expected: ["Sólo falta un paso", "Usuario", "Confirmar mi cuenta"],
  },
  {
    kind: "confirmation_coach",
    expected: ["Sólo falta un paso", "Coach", "Confirmar mi cuenta"],
  },
  {
    kind: "welcome_user",
    expected: ["organización", "hábitos", "planificación", "seguimiento"],
  },
  {
    kind: "welcome_coach",
    expected: ["seguimiento de tus alumnos", "planifica", "historial", "trabajo operativo"],
  },
];

for (const candidate of templateCases) {
  test(`render ${candidate.kind} entrega HTML y texto con copy propio`, () => {
    const rendered = renderEmailTemplate({
      kind: candidate.kind,
      firstName: "Alex",
      lastName: "Ejemplo",
      actionUrl: ACTION_URL,
    });

    assert.ok(rendered.subject.length > 0);
    assert.match(rendered.htmlContent, /^<!doctype html>/i);
    assert.match(rendered.htmlContent, /<table\b[^>]*role="presentation"/i);
    assert.match(rendered.htmlContent, /width="100%"/i);
    assert.match(rendered.htmlContent, /max-width:600px/i);
    assert.match(rendered.htmlContent, /@media only screen and \(max-width: 620px\)/i);
    assert.match(rendered.htmlContent, /#07101A/i);
    assert.match(rendered.htmlContent, /#3C7AFF/i);
    assert.match(rendered.htmlContent, /Roboto Mono/i);
    assert.match(rendered.textContent, /ORGANIZATECH/);
    assert.match(rendered.textContent, /https:\/\/organizatech\.cl\/login/);
    for (const expected of candidate.expected) {
      assert.ok(
        rendered.htmlContent.includes(expected) || rendered.textContent.includes(expected),
        `${candidate.kind} debe incluir ${expected}`,
      );
    }
  });
}

test("cada correo conserva un CTA único, visible y accesible", () => {
  for (const candidate of templateCases) {
    const { htmlContent } = renderEmailTemplate({
      kind: candidate.kind,
      actionUrl: ACTION_URL,
    });
    assert.equal(htmlContent.match(/<a\b/gi)?.length, 1, `${candidate.kind}: un anchor`);
    assert.equal(htmlContent.match(/href=/gi)?.length, 1, `${candidate.kind}: un href`);
    assert.match(htmlContent, /<a\b[^>]*aria-label="[^"]+"[^>]*role="button"/i);
    assert.match(htmlContent, /display:(?:inline-)?block/i);
  }
});

test("nombre, apellido y URL quedan escapados en el HTML", () => {
  const rendered = renderEmailTemplate({
    kind: "confirmation_user",
    firstName: 'Ana <img src=x onerror="alert(1)">',
    lastName: "O'Hara & Compañía",
    actionUrl: 'https://organizatech.cl/confirm?next=<inicio>&label="cuenta"',
  });

  assert.doesNotMatch(rendered.htmlContent, /<img\b/i);
  assert.doesNotMatch(rendered.htmlContent, /onerror="/i);
  assert.doesNotMatch(rendered.htmlContent, /O'Hara & Compañía/);
  assert.match(rendered.htmlContent, /Ana &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(rendered.htmlContent, /O&#39;Hara &amp; Compañía/);
  assert.match(rendered.htmlContent, /next=%3Cinicio%3E&amp;label=%22cuenta%22/);
});

test("rechaza URLs no HTTPS, credenciales embebidas y esquemas ejecutables", () => {
  for (const actionUrl of [
    "javascript:alert(1)",
    "http://organizatech.cl/login",
    "https://attacker:secret@organizatech.cl/login",
    "not-a-url",
  ]) {
    assert.throws(
      () => renderEmailTemplate({ kind: "welcome_user", actionUrl }),
      /URL de acción del correo/,
    );
  }
});

test("HTML no incorpora tracking ni recursos remotos", () => {
  for (const candidate of templateCases) {
    const { htmlContent } = renderEmailTemplate({
      kind: candidate.kind,
      actionUrl: ACTION_URL,
    });
    assert.doesNotMatch(htmlContent, /<(?:img|script|iframe|object|embed|form|link)\b/i);
    assert.doesNotMatch(htmlContent, /\bsrc\s*=/i);
    assert.doesNotMatch(htmlContent, /@import|url\s*\(|tracking[_-]?pixel|utm_[a-z]+/i);
    assert.equal((htmlContent.match(/https:\/\//g) ?? []).length, 1, "sólo la URL del CTA");
  }
});

test("fallback Auth cubre todas las acciones sin asignar portal", () => {
  const actions = [
    "signup",
    "recovery",
    "magiclink",
    "invite",
    "email_change",
    "email",
    "password_changed_notification",
    "email_changed_notification",
    "phone_changed_notification",
    "identity_linked_notification",
    "identity_unlinked_notification",
    "mfa_factor_enrolled_notification",
    "mfa_factor_unenrolled_notification",
  ] as const;

  for (const action of actions) {
    const rendered = renderNeutralAuthEmail({
      action,
      firstName: "Alex",
      actionUrl: ACTION_URL,
    });
    assert.ok(rendered.subject.length > 0);
    assert.equal(rendered.htmlContent.match(/<a\b/gi)?.length, 1);
    assert.doesNotMatch(rendered.subject, /Usuario|Coach/i);
    assert.doesNotMatch(rendered.htmlContent, /BIENVENIDA · (?:USUARIO|COACH)/i);
  }
});

test("fallback de reauthentication muestra el nonce y no inventa un link", () => {
  const rendered = renderNeutralAuthEmail({
    action: "reauthentication",
    firstName: "Alex",
    actionUrl: ACTION_URL,
    verificationCode: "87654321",
  });

  assert.match(rendered.htmlContent, /aria-label="Código de verificación"/);
  assert.match(rendered.htmlContent, />87654321</);
  assert.match(rendered.textContent, /Código de verificación: 87654321/);
  assert.doesNotMatch(rendered.htmlContent, /<a\b|href=/i);
  assert.doesNotMatch(rendered.textContent, /https:\/\//i);
  assert.throws(() => renderNeutralAuthEmail({
    action: "reauthentication",
    actionUrl: ACTION_URL,
    verificationCode: "not-a-nonce",
  }), /código de verificación/i);
});
