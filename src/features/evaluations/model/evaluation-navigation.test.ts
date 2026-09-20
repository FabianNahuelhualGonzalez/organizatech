import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvaluationOpenRequest,
  type EvaluationOpenRequest,
} from "@/features/evaluations/model/evaluation-navigation";

test("conserva el assignment tipado y secuencia aperturas de la misma identidad", () => {
  const first = createEvaluationOpenRequest(null, "student-1", "assignment-1");
  const second = createEvaluationOpenRequest(first, "student-1", "assignment-2");

  assert.deepEqual(first, {
    ownerUserId: "student-1",
    assignmentId: "assignment-1",
    sequence: 1,
  });
  assert.deepEqual(second, {
    ownerUserId: "student-1",
    assignmentId: "assignment-2",
    sequence: 2,
  });
});

test("reinicia la secuencia al cambiar de identidad y admite el fallback sin assignment", () => {
  const current: EvaluationOpenRequest = {
    ownerUserId: "student-1",
    assignmentId: "assignment-1",
    sequence: 4,
  };

  assert.deepEqual(createEvaluationOpenRequest(current, "coach-1", null), {
    ownerUserId: "coach-1",
    assignmentId: null,
    sequence: 1,
  });
});
