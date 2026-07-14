import assert from "node:assert/strict";

import {
  canMutateQaCycle,
  canRunQaAction,
  getQaActionErrorMessage,
  releaseQaMutationLock,
  rememberCreatedQaCycle,
  tryAcquireQaMutationLock,
} from "./training-cycles-qa-policy";

assert.equal(canRunQaAction("checking", false), false, "El estado inicial no permite acciones");
assert.equal(canRunQaAction("unauthenticated", false), false, "Sin sesión no permite acciones");
assert.equal(canRunQaAction("authenticated", false), true, "Una sesión válida permite acciones");
assert.equal(canRunQaAction("authenticated", true), false, "Una mutación bloquea acciones adicionales");

const mutationLock = { current: false };
let mutationExecutions = 0;
assert.equal(runWithMutationLock(mutationLock, () => {
  mutationExecutions += 1;
}), true, "La primera mutación adquiere el lock");
assert.equal(mutationLock.current, true);
assert.equal(
  runWithMutationLock(mutationLock, () => {
    mutationExecutions += 1;
  }),
  false,
  "Una segunda mutación no ejecuta su operación con el lock ocupado",
);
assert.equal(mutationExecutions, 1, "Solo la primera mutación ejecuta su operación");
releaseQaMutationLock(mutationLock);
assert.equal(mutationLock.current, false, "El lock se libera después de completar la mutación");

assertLockReleasedAfter(() => undefined, "éxito");
assertLockReleasedAfter(() => {
  throw new Error("fallo controlado de prueba");
}, "error");

const emptyAllowlist = new Set<string>();
const sessionAllowlist = rememberCreatedQaCycle(emptyAllowlist, "cycle-created-here");
assert.equal(emptyAllowlist.size, 0, "La allowlist anterior no se muta");
assert.equal(sessionAllowlist.has("cycle-created-here"), true, "El ciclo creado queda autorizado");
assert.equal(
  canMutateQaCycle("authenticated", false, "cycle-created-here", sessionAllowlist),
  true,
  "El ciclo creado durante la sesión puede actualizarse",
);
assert.equal(
  canMutateQaCycle("authenticated", false, "preexisting-cycle", sessionAllowlist),
  false,
  "Un ciclo preexistente permanece en solo lectura",
);
assert.equal(
  canMutateQaCycle("authenticated", true, "cycle-created-here", sessionAllowlist),
  false,
  "Una mutación en curso bloquea otra actualización",
);

assert.equal(getQaActionErrorMessage("load"), "No fue posible cargar los ciclos de prueba.");
assert.equal(getQaActionErrorMessage("create"), "No fue posible crear el ciclo de prueba.");
assert.equal(getQaActionErrorMessage("update"), "No fue posible actualizar el ciclo de prueba.");

function runWithMutationLock(lock: { current: boolean }, operation: () => void): boolean {
  if (!tryAcquireQaMutationLock(lock)) return false;
  operation();
  return true;
}

function assertLockReleasedAfter(
  operation: () => void,
  outcome: string,
): void {
  const lock = { current: false };
  assert.equal(tryAcquireQaMutationLock(lock), true);

  try {
    operation();
  } catch {
    // El resultado de la operación no altera el contrato de liberación.
  } finally {
    releaseQaMutationLock(lock);
  }

  assert.equal(lock.current, false, `El lock se libera después de ${outcome}`);
}

console.log("training-cycles QA client policy tests passed");
