import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EvaluationRepositoryError,
  assertEvaluationEmailInvocationSucceeded,
} from "@/features/evaluations/data/evaluations-repository";

test("acepta únicamente la confirmación estructurada del worker de Evaluaciones", () => {
  assert.doesNotThrow(() => assertEvaluationEmailInvocationSucceeded({
    data: { accepted: true, claimed: 1, sent: 1, failed: 0, ambiguous: 0, completionFailed: 0, truncated: false },
    error: null,
  }));
});

test("considera pendiente cualquier fallo o ambigüedad de entrega", () => {
  for (const data of [
    { accepted: true, claimed: 1, sent: 0, failed: 1, ambiguous: 0, completionFailed: 0, truncated: false },
    { accepted: true, claimed: 1, sent: 0, failed: 0, ambiguous: 1, completionFailed: 0, truncated: false },
    { accepted: true, claimed: 1, sent: 0, failed: 0, ambiguous: 1, completionFailed: 1, truncated: false },
    { accepted: true, claimed: 0, sent: 0, failed: 0, ambiguous: 0, completionFailed: 0, truncated: false },
    { accepted: true, claimed: 75, sent: 75, failed: 0, ambiguous: 0, completionFailed: 0, truncated: true },
  ]) {
    assert.throws(
      () => assertEvaluationEmailInvocationSucceeded({ data, error: null }),
      (error: unknown) => error instanceof EvaluationRepositoryError && error.code === "email_pending",
    );
  }
});

test("propaga la respuesta de error de functions.invoke en vez de silenciarla", () => {
  assert.throws(
    () => assertEvaluationEmailInvocationSucceeded({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code" },
    }),
    (error: unknown) => (
      error instanceof EvaluationRepositoryError
      && error.code === "unavailable"
    ),
  );
});

test("falla cerrado ante una respuesta exitosa malformada del worker", () => {
  for (const data of [
    null,
    {},
    { accepted: false, claimed: 1, sent: 1, failed: 0, ambiguous: 0, completionFailed: 0, truncated: false },
    { accepted: true, claimed: -1, sent: 0, failed: 0, ambiguous: 0, completionFailed: 0, truncated: false },
    { accepted: true, claimed: 1, sent: 1, failed: 0, ambiguous: 0, completionFailed: 0 },
    { accepted: true, claimed: 2, sent: 1, failed: 0, ambiguous: 0, completionFailed: 0, truncated: false },
    { accepted: true, claimed: 1, sent: 0, failed: 0, ambiguous: 1, completionFailed: 2, truncated: false },
    { accepted: true, claimed: 1, sent: 1, failed: 0, ambiguous: 0, completionFailed: 0, truncated: "false" },
  ]) {
    assert.throws(
      () => assertEvaluationEmailInvocationSucceeded({ data, error: null }),
      (error: unknown) => error instanceof EvaluationRepositoryError && error.code === "unavailable",
    );
  }
});

test("el reintento conserva request_id hasta confirmar el correo", () => {
  const repository = readFileSync("src/features/evaluations/data/evaluations-repository.ts", "utf8");
  const coach = readFileSync("src/features/evaluations/components/coach-evaluations.tsx", "utf8");
  const student = readFileSync("src/features/evaluations/components/student-evaluations.tsx", "utf8");

  assert.match(repository, /send_own_evaluation_template[\s\S]*p_request_id: input\.requestId/);
  assert.match(repository, /remind_own_evaluation_assignment[\s\S]*p_request_id: requestId/);
  assert.match(repository, /submit_own_evaluation[\s\S]*p_request_id: input\.requestId/);
  assert.match(coach, /sendOperationRef\.current\?\.fingerprint !== fingerprint[\s\S]*requestId: sendOperationRef\.current\.requestId/);
  assert.match(coach, /reminderOperationIdsRef\.current\.get\(assignment\.id\)[\s\S]*remindOwnEvaluationAssignment\(expectedUserId, assignment\.id, requestId\)/);
  assert.match(student, /submitOperationRef\.current\?\.fingerprint !== fingerprint[\s\S]*requestId: submitOperationRef\.current\.requestId/);
});
