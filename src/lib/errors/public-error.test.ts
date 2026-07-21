import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createPublicRepositoryError,
  getPublicErrorMessage,
  isPublicError,
  isSessionExpiredError,
  PublicError,
} from "@/lib/errors/public-error";
import { translatePersistenceError } from "@/lib/supabase/auth-errors";

const fallback = "No pudimos completar esta accion.";

function extractBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `No se encontro el inicio: ${startMarker}`);
  assert.notEqual(end, -1, `No se encontro el final: ${endMarker}`);
  return source.slice(start, end);
}

{
  const cause = new Error("duplicate key value violates unique constraint training_sessions_unique");
  const error = createPublicRepositoryError(
    "invalid_plan",
    "Revisa los datos del plan.",
    cause,
  );

  assert.ok(error instanceof PublicError);
  assert.equal(error.name, "PublicError");
  assert.equal(error.message, "Revisa los datos del plan.");
  assert.equal(error.code, "invalid_plan");
  assert.equal(error.cause, cause);
  assert.equal(Object.prototype.propertyIsEnumerable.call(error, "cause"), false);
  assert.equal(isPublicError(error), true);
  assert.equal(getPublicErrorMessage(error, fallback), "Revisa los datos del plan.");
  assert.equal(error.message.includes(cause.message), false);
}

{
  const sessionError = createPublicRepositoryError(
    "session_expired",
    "Tu sesion expiro. Inicia sesion nuevamente.",
  );
  assert.equal(isSessionExpiredError(sessionError), true);
  assert.equal(isSessionExpiredError(createPublicRepositoryError("unexpected", "Error seguro.")), false);
  assert.equal(isSessionExpiredError(new Error("JWT expired")), false);
}

{
  const technicalValues: unknown[] = [
    new Error("column user_id does not exist"),
    "PGRST204: relation public.profiles was not found",
    null,
    undefined,
    500,
    true,
    {
      message: "new row violates row-level security policy for table training_sessions",
      details: "Failing row contains a private UUID",
      hint: "Check policy training_sessions_owner_write",
      code: "42501",
    },
    new Error("duplicate key violates constraint exercise_entries_session_id_key"),
    new Error("function create_training_session_with_entries does not exist"),
    new Error("SQLSTATE 23505 for 33ac7a6a-734c-4728-bcb5-afa10f3da630"),
    new Error("El campo obligatorio del plan requiere un valor valido"),
    new Error("El plan es invalido"),
    new Error("El valor es inválido"),
  ];

  for (const value of technicalValues) {
    assert.equal(getPublicErrorMessage(value, fallback), fallback);
  }

  assert.equal(isPublicError(new Error("Error normal")), false);
  assert.equal(isPublicError({ message: "Mensaje", code: "invalid_plan" }), false);
  assert.equal(isPublicError("Mensaje"), false);
}

{
  const original = Object.freeze({
    message: "relation exercise_entries does not exist",
    details: "technical details",
    hint: "technical hint",
    code: "42P01",
  });
  const before = { ...original };

  assert.equal(getPublicErrorMessage(original, fallback), fallback);
  assert.deepEqual(original, before);
}

{
  const technicalError = new Error("relation public.training_sessions does not exist");
  assert.equal(
    translatePersistenceError(technicalError),
    "No pudimos completar la acción. Intenta nuevamente.",
  );
  assert.equal(
    translatePersistenceError(createPublicRepositoryError("invalid_input", "Revisa los datos ingresados.")),
    "Revisa los datos ingresados.",
  );
  assert.equal(
    translatePersistenceError(new Error("JWT expired")),
    "Tu sesión expiró. Inicia sesión nuevamente.",
  );
}

{
  const authErrorsSource = readFileSync("src/lib/supabase/auth-errors.ts", "utf8");
  const persistenceTranslator = extractBetween(
    authErrorsSource,
    "export function translatePersistenceError",
    "export function isSessionExpiredError",
  );
  assert.match(persistenceTranslator, /getPublicErrorMessage\(/);
  assert.doesNotMatch(persistenceTranslator, /return\s+error\.message/);
  assert.doesNotMatch(persistenceTranslator, /return\s+readAuthErrorMessage\(/);
  assert.doesNotMatch(persistenceTranslator, /return\s+String\(error\)/);
}

{
  const repositorySource = readFileSync(
    "src/lib/training/cycle-scoped-training-repository.ts",
    "utf8",
  );
  const errorClass = extractBetween(
    repositorySource,
    "export class CycleScopedTrainingRepositoryError",
    "export async function createTrainingCycleWithPlan",
  );
  const mapper = extractBetween(
    repositorySource,
    "function mapCycleScopedRepositoryError",
    "function readTrainingDayCode",
  );

  assert.match(errorClass, /extends PublicError/);
  assert.match(errorClass, /super\(code, message, cause\)/);
  assert.doesNotMatch(mapper, /readSupabaseErrorMessage/);
  assert.doesNotMatch(mapper, /error\.message/);
  assert.doesNotMatch(mapper, /String\(error\)/);
  assert.doesNotMatch(mapper, /includes\(["'](?:obligatorio|inválido|invalido|requiere|plan)["']\)/);
  assert.match(mapper, /"invalid_plan"/);
  assert.match(mapper, /"unexpected"/);
  assert.match(mapper, /\n\s+error,\n\s+\);/);
}

{
  const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
  const cycleTranslator = extractBetween(
    appSource,
    "function translateTrainingCycleRepositoryError",
    "function translateTrainingWorkoutReadinessError",
  );
  const readinessTranslator = extractBetween(
    appSource,
    "function translateTrainingWorkoutReadinessError",
    "function translateTrainingWorkoutReadinessLinkError",
  );

  assert.match(cycleTranslator, /getPublicErrorMessage\(/);
  assert.doesNotMatch(cycleTranslator, /return\s+error\.message/);
  assert.match(readinessTranslator, /getPublicErrorMessage\(/);
  assert.doesNotMatch(readinessTranslator, /return\s+error\.message/);
  assert.doesNotMatch(readinessTranslator, /String\(error\)/);
}
