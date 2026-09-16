import assert from "node:assert/strict";
import test from "node:test";

import type { CoachClient } from "./coach-client";
import {
  checkCoachInvitationEmail,
  formatCoachInvitationCode,
  normalizeCoachInvitationCode,
  normalizeCoachInvitationEmail,
} from "./coach-client-invitation";

const clients: readonly CoachClient[] = Object.freeze([
  Object.freeze({
    id: "former", state: "inactive", email: "shared@example.test", displayName: "Anterior",
  }),
  Object.freeze({
    id: "pending", state: "pending", email: "invited@example.test", displayName: null, invitationCode: null,
  }),
  Object.freeze({
    id: "active", state: "active", email: "shared@example.test", displayName: "Actual", cycle: null,
  }),
]);

test("normaliza sólo mayúsculas y bordes del correo, sin reescribir puntos o alias", () => {
  assert.equal(normalizeCoachInvitationEmail("  Student.Name+Coach@Example.Test \n"), "student.name+coach@example.test");
  assert.equal(normalizeCoachInvitationEmail("stu dent@example.test"), "stu dent@example.test");
});

test("no muestra un error de formato al empezar a escribir sin arroba", () => {
  assert.deepEqual(checkCoachInvitationEmail(" ", clients), { kind: "empty", email: "" });
  assert.deepEqual(checkCoachInvitationEmail("nu", clients), { kind: "invalid", email: "nu", showError: false });
  assert.deepEqual(checkCoachInvitationEmail("nuevo@correo", clients), {
    kind: "invalid", email: "nuevo@correo", showError: true,
  });
});

test("rechaza correos incompletos o múltiples arrobas sin emitir solicitudes", () => {
  for (const email of ["@example.test", "user@", "a@@example.test", "a b@example.test", "a@example.c"]) {
    const result = checkCoachInvitationEmail(email, []);
    assert.equal(result.kind, "invalid", email);
    if (result.kind === "invalid") assert.equal(result.showError, true);
  }
});

test("detecta un activo aunque antes exista una baja del mismo correo", () => {
  assert.deepEqual(checkCoachInvitationEmail(" SHARED@EXAMPLE.TEST ", clients), {
    kind: "already-active", email: "shared@example.test", clientId: "active",
  });
});

test("detecta pendientes sin descubrir nombres ni devolver el código", () => {
  assert.deepEqual(checkCoachInvitationEmail("INVITED@example.test", clients), {
    kind: "already-pending", email: "invited@example.test", clientId: "pending",
  });
  assert.deepEqual(checkCoachInvitationEmail("unknown@example.test", clients), {
    kind: "valid", email: "unknown@example.test",
  });
});

test("una baja permite volver a invitar; no oculta una invitación posterior", () => {
  const inactive: CoachClient = { id: "old", state: "inactive", displayName: null, email: "invited@example.test" };
  assert.deepEqual(checkCoachInvitationEmail("invited@example.test", [inactive]), {
    kind: "valid", email: "invited@example.test",
  });
  assert.deepEqual(checkCoachInvitationEmail("invited@example.test", [inactive, clients[1]]), {
    kind: "already-pending", email: "invited@example.test", clientId: "pending",
  });
});

test("validación no muta la cartera y la prioridad activo/pending no depende del orden", () => {
  const pendingSame: CoachClient = {
    id: "same-pending", state: "pending", displayName: null, email: "shared@example.test", invitationCode: null,
  };
  const snapshot = JSON.stringify(clients);
  for (const portfolio of [[pendingSame, ...clients], [...clients, pendingSame]]) {
    assert.equal(checkCoachInvitationEmail("shared@example.test", portfolio).kind, "already-active");
  }
  assert.equal(JSON.stringify(clients), snapshot);
});

test("normaliza códigos compactos o con guiones y conserva guiones al presentar/copiar", () => {
  for (const value of ["AB2CD3EF4", "ab2-cd3-ef4", "  AB2-CD3-EF4\n", "AB2CD3-EF4"]) {
    assert.equal(normalizeCoachInvitationCode(value), "AB2CD3EF4");
    assert.equal(formatCoachInvitationCode(value), "AB2-CD3-EF4");
  }
});

test("todo el alfabeto autorizado mantiene el formato dos letras y un dígito", () => {
  for (const letter of "ABCDEFGHJKLMNPQRSTUVWXYZ") {
    for (const digit of "23456789") {
      const group = `${letter}${letter}${digit}`;
      assert.equal(formatCoachInvitationCode(`${group}${group}${group}`), `${group}-${group}-${group}`);
    }
  }
});

test("no acepta I/O/0/1 ni sus variantes en minúscula, ni adivina caracteres", () => {
  for (const value of ["AI2-CD3-EF4", "AO2-CD3-EF4", "AB0-CD3-EF4", "AB1-CD3-EF4", "ai2-cd3-ef4", "ao2-cd3-ef4"]) {
    assert.equal(normalizeCoachInvitationCode(value), null, value);
    assert.equal(formatCoachInvitationCode(value), null, value);
  }
});

test("rechaza longitudes, orden, separadores y confusables fuera del contrato", () => {
  for (const value of ["", "AB2", "AB2-CD3-EF45", "A2B-CD3-EF4", "AB2--CD3-EF4", "AB2 CD3 EF4", "AB2_CD3_EF4", "AB2–CD3–EF4", "ſS2-CD3-EF4", "ß2-CD3-EF4", "ＡB2-CD3-EF4"]) {
    assert.equal(normalizeCoachInvitationCode(value), null, value);
  }
});
