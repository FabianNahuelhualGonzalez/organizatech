import assert from "node:assert/strict";

import { createPublicRepositoryError } from "@/lib/errors/public-error";
import { CycleScopedTrainingRepositoryError } from "@/lib/training/cycle-scoped-training-repository";
import { translateTrainingCycleRepositoryError } from "@/lib/training/training-cycle-error";
import { PROTECTED_ACTIVE_CYCLE_MESSAGE } from "@/lib/training/training-cycle-protection";
import { TrainingCycleRepositoryError } from "@/lib/training/training-cycles-repository";

// P2-H.2B: translateTrainingCycleRepositoryError se movio aqui desde organizatech-app.tsx.
// Paridad literal por cada codigo de ambas clases, textos y puntuacion exactos.

// CycleScopedTrainingRepositoryError
assert.equal(
  translateTrainingCycleRepositoryError(new CycleScopedTrainingRepositoryError("session_required", "x")),
  "Debes iniciar sesion para gestionar el plan del ciclo.",
);
assert.equal(
  translateTrainingCycleRepositoryError(new CycleScopedTrainingRepositoryError("session_expired", "x")),
  "Tu sesion expiro. Inicia sesion nuevamente.",
);
assert.equal(
  translateTrainingCycleRepositoryError(
    new CycleScopedTrainingRepositoryError("invalid_plan", "No pudimos validar el plan de entrenamiento. Revisa los datos e intenta nuevamente."),
  ),
  "No pudimos validar el plan de entrenamiento. Revisa los datos e intenta nuevamente.",
  "invalid_plan usa getPublicErrorMessage: como la clase extiende PublicError, retorna error.message",
);
assert.equal(
  translateTrainingCycleRepositoryError(new CycleScopedTrainingRepositoryError("invalid_plan", "Mensaje distinto construido en el repositorio.")),
  "Mensaje distinto construido en el repositorio.",
  "getPublicErrorMessage siempre prioriza error.message sobre el fallback cuando la instancia es PublicError",
);
assert.equal(
  translateTrainingCycleRepositoryError(new CycleScopedTrainingRepositoryError("active_cycle_exists", "x")),
  "Ya existe un ciclo activo para tu cuenta.",
);
assert.equal(
  translateTrainingCycleRepositoryError(new CycleScopedTrainingRepositoryError("permission_denied", "x")),
  "No tienes permisos para gestionar este plan de ciclo.",
);
assert.equal(
  translateTrainingCycleRepositoryError(new CycleScopedTrainingRepositoryError("unexpected", "x")),
  "No pudimos completar la accion sobre el plan del ciclo.",
);

// TrainingCycleRepositoryError (legacy)
assert.equal(
  translateTrainingCycleRepositoryError(new TrainingCycleRepositoryError("session_required", "x")),
  "Debes iniciar sesión para gestionar ciclos.",
);
assert.equal(
  translateTrainingCycleRepositoryError(new TrainingCycleRepositoryError("session_expired", "x")),
  "Tu sesión expiró. Inicia sesión nuevamente.",
);
assert.equal(
  translateTrainingCycleRepositoryError(new TrainingCycleRepositoryError("active_cycle_exists", "x")),
  "Ya existe un ciclo activo para tu cuenta.",
);
assert.equal(
  translateTrainingCycleRepositoryError(new TrainingCycleRepositoryError("active_cycle_missing", "x")),
  "No existe un ciclo activo para finalizar.",
);
assert.equal(
  translateTrainingCycleRepositoryError(new TrainingCycleRepositoryError("protected_cycle", "x")),
  PROTECTED_ACTIVE_CYCLE_MESSAGE,
  "protected_cycle retorna la constante compartida, no un literal propio",
);
assert.equal(
  translateTrainingCycleRepositoryError(new TrainingCycleRepositoryError("permission_denied", "x")),
  "No tienes permisos para acceder a este ciclo.",
);
assert.equal(
  translateTrainingCycleRepositoryError(new TrainingCycleRepositoryError("unexpected", "x")),
  "No pudimos completar la acción sobre ciclos.",
);

// Fallback: cualquier otro error delega en translatePersistenceError.
assert.equal(
  translateTrainingCycleRepositoryError(new Error("relation training_cycles does not exist")),
  "No pudimos completar la acción. Intenta nuevamente.",
);
assert.equal(
  translateTrainingCycleRepositoryError(new Error("JWT expired")),
  "Tu sesión expiró. Inicia sesión nuevamente.",
);
assert.equal(
  translateTrainingCycleRepositoryError(createPublicRepositoryError("invalid_input", "Mensaje publico ajeno a las dos clases de ciclo.")),
  "Mensaje publico ajeno a las dos clases de ciclo.",
  "un PublicError generico (no CycleScopedTrainingRepositoryError) tambien cae en translatePersistenceError, que respeta su mensaje",
);

// Los dos tipos de error nunca se confunden entre si.
assert.notEqual(
  translateTrainingCycleRepositoryError(new CycleScopedTrainingRepositoryError("session_required", "x")),
  translateTrainingCycleRepositoryError(new TrainingCycleRepositoryError("session_required", "x")),
  "cycle-scoped y legacy tienen textos distintos para el mismo codigo (con/sin tilde)",
);

console.log("training-cycle-error tests passed");
