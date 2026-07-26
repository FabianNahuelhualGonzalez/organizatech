import assert from "node:assert/strict";

import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";

function acceptExerciseDraft(draft: ExerciseDraft): ExerciseDraft {
  return draft;
}

const draft = acceptExerciseDraft({
  weight: "82,5",
  rir: "2",
  reps: [10, "", 8],
  registered: false,
  observation: "Controlar la tecnica",
});
const registeredDraft = acceptExerciseDraft({
  ...draft,
  registered: true,
  reps: [10, 9, 8],
});

assert.deepEqual(draft, {
  weight: "82,5",
  rir: "2",
  reps: [10, "", 8],
  registered: false,
  observation: "Controlar la tecnica",
});
assert.equal(registeredDraft.registered, true);
assert.deepEqual(registeredDraft.reps, [10, 9, 8]);

console.log("training-exercise-draft type fixture tests passed");
