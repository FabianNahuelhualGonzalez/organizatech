import assert from "node:assert/strict";

import type { ExerciseTemplate } from "@/lib/progress/types";
import {
  createExerciseDraft,
  normalizeExerciseDraft,
  normalizeExerciseDrafts,
  type ExerciseDraft,
} from "@/lib/training/training-exercise-draft";

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

const exercise = {
  id: "exercise-1",
  routine: "Empuje",
  name: "Press banca",
  targetSets: 3,
  targetReps: 10,
  baseWeight: 80,
} satisfies ExerciseTemplate;

{
  const created = createExerciseDraft(exercise);
  assert.deepEqual(created, {
    weight: "",
    rir: "",
    reps: ["", "", ""],
    registered: false,
    observation: "",
  });
  assert.notEqual(created.reps, createExerciseDraft(exercise).reps, "cada constructor entrega reps independientes");
}

{
  const source: ExerciseDraft = {
    weight: "82,5",
    rir: "1",
    reps: [10],
    registered: true,
    observation: "Controlar descenso",
  };
  const original = structuredClone(source);
  const expanded = normalizeExerciseDraft(exercise, source);
  const trimmed = normalizeExerciseDraft({ ...exercise, targetSets: 1 }, {
    ...source,
    reps: [10, 9, 8],
  });

  assert.deepEqual(expanded.reps, [10, "", ""], "reps se ajusta a targetSets y rellena faltantes");
  assert.deepEqual(trimmed.reps, [10], "reps elimina excedentes sobre targetSets");
  assert.equal(expanded.observation, "Controlar descenso");
  assert.deepEqual(source, original, "normalizeExerciseDraft no muta el input");
  assert.notEqual(expanded.reps, source.reps);
}

{
  const legacyInput = {
    "exercise-1": {
      weight: "82,5",
      rir: "2",
      reps: ["10", "", "invalid"],
      registered: 1,
    },
    "exercise-2": {
      weight: "not-a-weight",
      reps: null,
      observation: "",
    },
    "exercise-3": {
      weight: 90.5,
      reps: [8, 7],
      observation: "Buena ejecucion",
    },
  };
  const original = structuredClone(legacyInput);
  const normalized = normalizeExerciseDrafts(legacyInput);

  assert.deepEqual(normalized["exercise-1"], {
    weight: "82,5",
    rir: "2",
    reps: [10, "", 0],
    registered: true,
    observation: "",
  });
  assert.deepEqual(normalized["exercise-2"], {
    weight: "",
    rir: "",
    reps: [],
    registered: false,
    observation: "",
  });
  assert.deepEqual(normalized["exercise-3"], {
    weight: "90,5",
    rir: "",
    reps: [8, 7],
    registered: false,
    observation: "Buena ejecucion",
  });
  assert.deepEqual(legacyInput, original, "la normalizacion de recovery no muta el draft persistido");
  assert.deepEqual(normalizeExerciseDrafts(null), {});
}

console.log("training-exercise-draft tests passed");
