import assert from "node:assert/strict";
import {
  canFinishTrainingCycle,
  isProtectedTrainingCycle,
} from "./training-cycle-protection";

assert.equal(
  isProtectedTrainingCycle({
    cycleNumber: 1,
    planSnapshot: { source: "cycle-scoped" },
  }),
  true,
  "Ciclo 1 permanece protegido incluso si su snapshot parece cycle-scoped",
);

assert.equal(
  isProtectedTrainingCycle({
    cycleNumber: 2,
    planSnapshot: { source: "ui-main-production" },
  }),
  true,
  "un ciclo legacy permanece protegido",
);

assert.equal(
  isProtectedTrainingCycle({
    cycleNumber: 2,
    planSnapshot: { source: "cycle-scoped" },
  }),
  false,
  "un ciclo cycle-scoped posterior puede gestionarse",
);

assert.equal(
  isProtectedTrainingCycle({
    cycleNumber: 7,
    planSnapshot: { source: "cycle-scoped-qa" },
  }),
  false,
  "el marcador QA cycle-scoped mantiene compatibilidad",
);

const protectedCycle = {
  cycleNumber: 1,
  planSnapshot: { source: "ui-main-production" },
};

assert.equal(
  canFinishTrainingCycle(protectedCycle, "completed"),
  false,
  "un ciclo protegido no se completa sin confirmacion explicita",
);

assert.equal(
  canFinishTrainingCycle(protectedCycle, "completed", true),
  true,
  "un ciclo protegido se puede completar tras confirmacion explicita",
);

assert.equal(
  canFinishTrainingCycle(protectedCycle, "cancelled", true),
  false,
  "la confirmacion de nuevo ciclo no habilita cancelar el ciclo protegido",
);

console.log("Pruebas de proteccion de ciclos OK");
