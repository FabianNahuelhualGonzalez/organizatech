import assert from "node:assert/strict";
import test from "node:test";

import {
  COACH_LINK_ENTRY_STORAGE_KEY,
  captureCoachLinkEntry,
  captureCoachLinkNotificationDestination,
  clearCoachLinkEntry,
  isCompleteCoachLinkCode,
  normalizeCoachLinkCode,
  persistCoachLinkEntry,
  resolveCoachLinkPostAuthDecision,
} from "./coach-linking";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

test("normaliza escritura y pegado al formato 3-3-3 sin superar nueve caracteres", () => {
  assert.deepEqual(normalizeCoachLinkCode(" ab2.cd3 ef4ZZ "), {
    clean: "AB2CD3EF4",
    display: "AB2-CD3-EF4",
  });
  assert.deepEqual(normalizeCoachLinkCode("ab2-c"), { clean: "AB2C", display: "AB2-C" });
});

test("captura sólo los dos destinos aprobados de campana/correo", () => {
  const episodeId = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(captureCoachLinkNotificationDestination("profile-coaching", null), {
    kind: "student-coaching",
  });
  assert.deepEqual(captureCoachLinkNotificationDestination(null, episodeId), {
    kind: "coach-student", episodeId,
  });
  assert.equal(captureCoachLinkNotificationDestination("profile-coaching", episodeId), null);
  assert.equal(captureCoachLinkNotificationDestination(null, "not-a-uuid"), null);
});

test("valida el alfabeto productivo y rechaza I/O/0/1 o posiciones incorrectas", () => {
  assert.equal(isCompleteCoachLinkCode("AB2-CD3-EF4"), true);
  for (const code of ["AI2-CD3-EF4", "AO2-CD3-EF4", "AB0-CD3-EF4", "AB1-CD3-EF4", "A22-CD3-EF4"]) {
    assert.equal(isCompleteCoachLinkCode(code), false, code);
  }
});

test("el gate conserva sólo códigos válidos, recupera durante ocho días y limpia al finalizar", () => {
  const storage = memoryStorage();
  const now = Date.UTC(2026, 8, 17);
  assert.deepEqual(captureCoachLinkEntry("ab2-cd3-ef4", storage, now), {
    code: "AB2CD3EF4",
    resumeConfirmation: false,
    requestId: null,
  });
  assert.deepEqual(captureCoachLinkEntry(null, storage, now + 60_000), {
    code: "AB2CD3EF4",
    resumeConfirmation: false,
    requestId: null,
  });
  assert.equal(captureCoachLinkEntry(null, storage, now + 9 * 24 * 60 * 60 * 1000), null);
  assert.equal(storage.values.has(COACH_LINK_ENTRY_STORAGE_KEY), false);

  captureCoachLinkEntry("AB2CD3EF4", storage, now);
  clearCoachLinkEntry(storage);
  assert.equal(storage.values.has(COACH_LINK_ENTRY_STORAGE_KEY), false);
});

test("una sesión expirada conserva confirmación y requestId para revalidación segura", () => {
  const storage = memoryStorage();
  const now = Date.UTC(2026, 8, 17);
  const requestId = "00000000-0000-4000-8000-000000000001";
  assert.equal(persistCoachLinkEntry(storage, "AB2-CD3-EF4", requestId, now), true);
  assert.deepEqual(captureCoachLinkEntry(null, storage, now + 60_000), {
    code: "AB2CD3EF4",
    resumeConfirmation: true,
    requestId,
  });
});

test("destino Ver mi coach espera vínculo de la misma identidad y falla cerrado", () => {
  assert.equal(resolveCoachLinkPostAuthDecision({
    destinationOwnerUserId: "user-a",
    authenticatedUserId: "user-a",
    activeState: "loading",
    activeStateIdentityKey: null,
  }), "pending");
  assert.equal(resolveCoachLinkPostAuthDecision({
    destinationOwnerUserId: "user-a",
    authenticatedUserId: "user-a",
    activeState: "linked",
    activeStateIdentityKey: "user-a",
  }), "profile");
  for (const input of [
    { authenticatedUserId: "user-b", activeState: "linked" as const, activeStateIdentityKey: "user-b" },
    { authenticatedUserId: "user-a", activeState: "linked" as const, activeStateIdentityKey: "user-b" },
    { authenticatedUserId: "user-a", activeState: "none" as const, activeStateIdentityKey: "user-a" },
  ]) {
    assert.equal(resolveCoachLinkPostAuthDecision({
      destinationOwnerUserId: "user-a",
      ...input,
    }), "dashboard");
  }
});
