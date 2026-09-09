import assert from "node:assert/strict";
import test from "node:test";

import { createTrainingCycleBuilderTestViewModel } from "@/features/training-cycle-builder/hooks/training-cycle-builder-fixtures.check";
import {
  buildTrainingCycleSaveDraftInput,
  createTrainingCycleBuilderState,
  getTrainingCycleDraftValidation,
  trainingCycleBuilderReducer,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import {
  normalizeOptionalYouTubeVideoUrl,
  validateOptionalYouTubeVideoUrl,
} from "@/features/training-cycle-builder/hooks/training-cycle-video-url";

test("acepta sólo variantes HTTPS de YouTube con identificador de 11 caracteres", () => {
  const accepted = [
    "https://youtube.com/watch?v=AbCdEfGhI_1",
    "https://www.youtube.com/embed/AbCdEfGhI_1",
    "https://m.youtube.com/shorts/AbCdEfGhI_1",
    "https://www.youtube.com/live/AbCdEfGhI_1",
    "https://youtu.be/AbCdEfGhI_1",
  ];
  for (const value of accepted) {
    const validation = validateOptionalYouTubeVideoUrl(value);
    assert.equal(validation.valid, true, value);
    if (validation.valid) {
      assert.equal(validation.videoId, "AbCdEfGhI_1");
      assert.equal(validation.normalizedUrl, "https://www.youtube.com/watch?v=AbCdEfGhI_1");
    }
  }
  assert.deepEqual(validateOptionalYouTubeVideoUrl("   "), {
    valid: true,
    normalizedUrl: null,
    videoId: null,
  });
});

test("rechaza protocolos, hosts, credenciales, ids y URLs malformadas", () => {
  const rejected = [
    "http://youtube.com/watch?v=AbCdEfGhI_1",
    "javascript:alert(1)",
    "https://youtube.com.evil.test/watch?v=AbCdEfGhI_1",
    "https://evil.test/?next=https://youtu.be/AbCdEfGhI_1",
    "https://user:password@youtube.com/watch?v=AbCdEfGhI_1",
    "https://youtu.be/short",
    "https://youtu.be/AbCdEfGhI_1/extra",
    "https://youtube.com/watch",
    "https://youtube.com/watch?v=AbCdEfGhI_1&v=ZyXwVuTsR_2",
    "https://youtube.com/channel/AbCdEfGhI_1",
    "youtube.com/watch?v=AbCdEfGhI_1",
    "not a url",
  ];
  for (const value of rejected) {
    assert.equal(validateOptionalYouTubeVideoUrl(value).valid, false, value);
    assert.throws(() => normalizeOptionalYouTubeVideoUrl(value), TypeError);
  }
});

test("un video inválido bloquea validación y nunca llega al payload", () => {
  const fixture = createTrainingCycleBuilderTestViewModel();
  const monday = fixture.draft.routines.monday;
  const invalidDraft = {
    ...fixture.draft,
    routines: {
      ...fixture.draft.routines,
      monday: {
        ...monday,
        exercises: monday.exercises.map((exercise, index) => index === 0
          ? { ...exercise, videoUrl: "https://example.com/video" }
          : exercise),
      },
    },
  };
  const validation = getTrainingCycleDraftValidation(invalidDraft);
  assert.equal(validation.videosValid, false);
  assert.equal(validation.invalidVideoCount, 1);
  assert.equal(validation.canActivate, false);
  assert.throws(() => buildTrainingCycleSaveDraftInput(invalidDraft, "manual"), TypeError);
});

test("un ejercicio personalizado rechaza video inválido y normaliza uno válido", () => {
  let state = createTrainingCycleBuilderState(createTrainingCycleBuilderTestViewModel());
  state = trainingCycleBuilderReducer(state, { type: "set_custom_name", value: "Ejercicio propio" });
  state = trainingCycleBuilderReducer(state, { type: "set_custom_muscle", value: "Abdomen" });
  state = trainingCycleBuilderReducer(state, {
    type: "set_custom_video",
    value: "https://example.com/not-youtube",
  });
  const before = state.draft.routines.monday.exercises.length;
  assert.equal(validateOptionalYouTubeVideoUrl(state.customVideoUrl).valid, false);

  state = trainingCycleBuilderReducer(state, {
    type: "set_custom_video",
    value: "https://youtu.be/AbCdEfGhI_1?si=tracking",
  });
  const normalized = normalizeOptionalYouTubeVideoUrl(state.customVideoUrl);
  state = trainingCycleBuilderReducer(state, {
    type: "custom_exercise_succeeded",
    source: { kind: "custom", id: "custom-video-test" },
    name: "Ejercicio propio",
    muscleGroup: "Abdomen",
    videoUrl: normalized ?? "",
    recommendation: {
      hasHistory: false,
      title: "Sin historial",
      body: "Carga editable",
      source: "Inicio conservador",
    },
  });
  assert.equal(state.draft.routines.monday.exercises.length, before + 1);
  assert.equal(
    state.draft.routines.monday.exercises.at(-1)?.videoUrl,
    "https://www.youtube.com/watch?v=AbCdEfGhI_1",
  );
});
