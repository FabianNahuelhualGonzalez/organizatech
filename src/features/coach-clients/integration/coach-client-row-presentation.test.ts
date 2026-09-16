import assert from "node:assert/strict";
import test from "node:test";

import type { ActiveCoachClient, CoachClient, InactiveCoachClient, PendingCoachClient } from "../model/coach-client";
import type { CoachClientRowView } from "../components/coach-clients-view";
import { projectCoachClientRow } from "./coach-client-row-presentation";

const active: ActiveCoachClient = Object.freeze({
  id: "active", state: "active", email: "shared@example.test", displayName: "  Ángela Pérez  ",
  cycle: Object.freeze({ id: "cycle", description: null, completedSessions: 2, plannedSessions: 8 }),
});
const pending: PendingCoachClient = Object.freeze({
  id: "pending", state: "pending", email: "invited@example.test", displayName: null, invitationCode: "PRIVATE_CODE",
});
const inactive: InactiveCoachClient = Object.freeze({
  id: "inactive", state: "inactive", email: "historic@example.test", displayName: "Identidad histórica",
});

function projectUntyped(value: unknown, metaLabel: unknown = null) {
  return projectCoachClientRow(value as CoachClient, metaLabel as string | null);
}

function withCounts(completedSessions: unknown, plannedSessions: unknown) {
  return { ...active, cycle: { id: "cycle", description: null, completedSessions, plannedSessions } };
}

test("active projects the exact allowlist and explicit caller label", () => {
  // Integration proof against the existing canonical UI union, not a copy.
  const row: CoachClientRowView | null = projectCoachClientRow(active, "2/8 sesiones");
  assert.deepEqual(row, {
    id: "active", email: "shared@example.test", state: "active", metaLabel: "2/8 sesiones",
    name: "Ángela Pérez", initials: "ÁP", progressRatio: 0.25,
  });
  assert.equal(row?.state, "active");
  assert.equal(Object.isFrozen(row), true);
});

test("pending strips extra identity, activity, ownership and code without reading them", () => {
  const input = { ...pending };
  for (const field of ["displayName", "name", "initials", "cycle", "completedSessions", "progressRatio", "invitationCode", "owner_id"]) {
    Object.defineProperty(input, field, { get() { throw new Error(`Forbidden read: ${field}`); } });
  }
  const row = projectCoachClientRow(input, "Etiqueta autorizada de invitación");
  assert.deepEqual(row, {
    id: "pending", email: "invited@example.test", state: "pending", metaLabel: "Etiqueta autorizada de invitación",
  });
  assert.equal(Object.isFrozen(row), true);
});

test("pending extra plain PII never enters serialized output", () => {
  const row = projectUntyped({
    ...pending, displayName: "PRIVATE_NAME", name: "PRIVATE_NAME", initials: "PRIVATE_INITIALS",
    cycle: { id: "PRIVATE_CYCLE" }, progressRatio: 0.9, user_id: "PRIVATE_OWNER", lastActivity: "PRIVATE_ACTIVITY",
  });
  assert.deepEqual(Object.keys(row ?? {}).sort(), ["email", "id", "metaLabel", "state"]);
  assert.doesNotMatch(JSON.stringify(row), /PRIVATE/);
});

test("inactive retains only historical identity and never reads attached activity", () => {
  const input = { ...inactive, user_id: "PRIVATE_OWNER", invitationCode: "PRIVATE_CODE" };
  for (const field of ["cycle", "lastActivity", "completedSessions", "progressRatio"]) {
    Object.defineProperty(input, field, { get() { throw new Error(`Forbidden read: ${field}`); } });
  }
  const row = projectCoachClientRow(input, "Etiqueta histórica autorizada");
  assert.deepEqual(row, {
    id: "inactive", email: "historic@example.test", state: "inactive", metaLabel: "Etiqueta histórica autorizada",
    name: "Identidad histórica", initials: "Ih",
  });
  assert.equal(Object.isFrozen(row), true);
});

test("active extra identity and cycle fields are not forwarded", () => {
  const row = projectUntyped({
    ...active, name: "PRIVATE_OTHER_NAME", initials: "PRIVATE_INITIALS", owner_id: "PRIVATE_OWNER",
    invitationCode: "PRIVATE_CODE", cycle: { ...active.cycle, description: "PRIVATE_CYCLE_DESCRIPTION" },
  });
  assert.deepEqual(Object.keys(row ?? {}).sort(), ["email", "id", "initials", "metaLabel", "name", "progressRatio", "state"]);
  assert.doesNotMatch(JSON.stringify(row), /PRIVATE/);
});

test("unknown or blank authorized name stays null, never inferred from email", () => {
  for (const source of [active, inactive]) {
    for (const displayName of [null, "", " \t\n "]) {
      const row = projectCoachClientRow({ ...source, displayName }, null);
      assert.ok(row && row.state !== "pending");
      assert.equal(row.name, null);
      assert.equal(row.initials, null);
      assert.equal(row.email, source.email);
    }
  }
});

test("authorized initials follow the handoff: first character of at most two words, preserving case", () => {
  for (const source of [active, inactive]) {
    for (const [displayName, expected] of [
      ["Ángela Pérez", "ÁP"], ["李 明", "李明"], ["Camila", "C"], ["Persona de prueba", "Pd"],
      ["ana pérez", "ap"], ["María-José O'Neill", "MO"],
    ]) {
      const row = projectCoachClientRow({ ...source, displayName }, null);
      assert.ok(row && row.state !== "pending");
      assert.equal(row.name, displayName);
      assert.equal(row.initials, expected);
    }
  }
});

test("initials ignore repeated whitespace and do not split Unicode surrogate pairs", () => {
  for (const source of [active, inactive]) {
    for (const [displayName, expected] of [
      ["  Ángela   Pérez  ", "ÁP"], ["ana\t\npérez", "ap"], ["李\u3000明", "李明"],
      ["𠮷野 太郎", "𠮷太"], ["𝒜na pérez", "𝒜p"], ["😀 😀", "😀😀"],
    ]) {
      const row = projectCoachClientRow({ ...source, displayName }, null);
      assert.ok(row && row.state !== "pending");
      assert.equal(row.name, displayName.trim());
      assert.equal(row.initials, expected);
    }
  }
});

test("active without cycle stays active with unavailable progress", () => {
  const row = projectCoachClientRow({ ...active, cycle: null }, null);
  assert.ok(row && row.state === "active");
  assert.equal(row.progressRatio, null);
  assert.equal(row.metaLabel, null);
});

test("null counts and zero denominator are valid but do not invent progress", () => {
  for (const [completed, planned] of [[null, null], [null, 8], [0, null], [3, null], [null, 0], [0, 0], [3, 0]]) {
    const row = projectUntyped(withCounts(completed, planned));
    assert.ok(row && row.state === "active");
    assert.equal(row.progressRatio, null);
  }
});

test("explicit zero, fractional progress and safe integer boundaries remain distinct", () => {
  for (const [completed, planned, expected] of [
    [0, 8, 0], [-0, 8, 0], [1, 3, 1 / 3], [8, 8, 1],
    [1, Number.MAX_SAFE_INTEGER, 1 / Number.MAX_SAFE_INTEGER],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1],
  ]) {
    const row = projectUntyped(withCounts(completed, planned));
    assert.ok(row && row.state === "active");
    assert.equal(row.progressRatio, expected);
  }
});

test("extra completed sessions clamp drawing geometry, not the source fraction", () => {
  for (const [completed, planned] of [[10, 8], [Number.MAX_SAFE_INTEGER, 1]]) {
    const input = withCounts(completed, planned);
    const before = structuredClone(input);
    const row = projectUntyped(input);
    assert.ok(row && row.state === "active");
    assert.equal(row.progressRatio, 1);
    assert.deepEqual(input, before);
    assert.ok(completed / planned > 1);
  }
});

test("malformed counts reject the entire row even when the other count is unknown", () => {
  const invalidCounts = [undefined, NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "2", true, {}, [], BigInt(2)];
  for (const invalid of invalidCounts) {
    for (const valid of [null, 0, 8]) {
      assert.equal(projectUntyped(withCounts(invalid, valid)), null);
      assert.equal(projectUntyped(withCounts(valid, invalid)), null);
    }
  }
});

test("invalid active cycle contract rejects the row instead of a partial view", () => {
  for (const cycle of [undefined, [], "cycle", {},
    { ...active.cycle, id: " " }, { ...active.cycle, id: null },
    { ...active.cycle, description: undefined }, { ...active.cycle, description: 3 },
  ]) {
    assert.equal(projectUntyped({ ...active, cycle }), null);
  }
});

test("invalid base fields and discriminant reject the row for every state", () => {
  for (const input of [null, undefined, [], "client", 3, {}, { ...active, state: "unknown" }]) {
    assert.equal(projectUntyped(input), null);
  }
  for (const source of [active, pending, inactive]) {
    for (const invalid of [null, undefined, 0, "", " \t ", {}, []]) {
      assert.equal(projectUntyped({ ...source, id: invalid }), null);
      assert.equal(projectUntyped({ ...source, email: invalid }), null);
    }
  }
});

test("invalid visible identity rejects active and inactive rows", () => {
  for (const source of [active, inactive]) {
    for (const displayName of [undefined, false, 3, {}, []]) {
      assert.equal(projectUntyped({ ...source, displayName }), null);
    }
  }
});

test("metaLabel is explicit, copied unchanged and never computed from counts", () => {
  for (const metaLabel of [null, "", "  Etiqueta autorizada  "]) {
    assert.equal(projectCoachClientRow(active, metaLabel)?.metaLabel, metaLabel);
  }
  for (const source of [active, pending, inactive]) {
    for (const invalid of [undefined, false, 3, {}, []]) {
      assert.equal(projectCoachClientRow(source, invalid as string | null), null);
    }
  }
});

test("projection is deterministic, freezes only fresh output and never mutates input", () => {
  for (const source of [active, pending, inactive]) {
    const input = structuredClone(source);
    const before = structuredClone(input);
    const row = projectCoachClientRow(input, null);
    assert.ok(row);
    assert.notEqual(row, input);
    assert.equal(Object.isFrozen(row), true);
    assert.equal(Object.isFrozen(input), false);
    assert.equal(Reflect.set(row, "email", "modified@example.test"), false);
    assert.equal(Reflect.set(row, "owner_id", "owner"), false);
    assert.deepEqual(input, before);
    assert.deepEqual(projectCoachClientRow(input, null), row);
  }
  assert.deepEqual(projectCoachClientRow(active, null), projectCoachClientRow(structuredClone(active), null));
});
