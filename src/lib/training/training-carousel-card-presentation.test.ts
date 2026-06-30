import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildTrainingCarouselCardModel } from "@/lib/training/training-carousel-card-presentation";

function createPlannedExercises(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `planned-${index + 1}`,
    name: index === 0 ? "Press plano con nombre bastante largo para truncar en la tarjeta" : `Ejercicio ${index + 1}`,
    targetSets: 4,
    targetReps: 10,
    baseWeight: 100,
  }));
}

async function run() {
  {
    const model = buildTrainingCarouselCardModel({
      day: "Lunes",
      routineName: "Pecho · Hombro · Triceps",
      status: "completed",
      isToday: true,
      registeredCount: 8,
      plannedCount: 8,
      registeredExercises: [],
      plannedExercises: createPlannedExercises(8),
      actionLabel: "Ver resumen",
      maxVisibleExercises: 4,
      formatWeight: (value) => `${value} kg`,
    });

    assert.equal(model.rows.length, 4);
    assert.equal(model.additionalExerciseCount, 4);
    assert.equal(model.statusLabel, "Completado · 8 de 8 · Hoy");
    assert.equal(model.actionLabel, "Ver resumen");
    assert.equal(model.rows[0]?.name, "Press plano con nombre bastante largo para truncar en la tarjeta");
    assert.equal(model.rows[0]?.sets, "4");
    assert.equal(model.rows[0]?.reps, "10");
    assert.equal(model.rows[0]?.kg, "100 kg");
  }

  {
    const model = buildTrainingCarouselCardModel({
      day: "Martes",
      routineName: "Piernas",
      status: "pending",
      isToday: false,
      registeredCount: 0,
      plannedCount: 1,
      registeredExercises: [],
      plannedExercises: createPlannedExercises(1),
      actionLabel: "Ir a rutina",
    });

    assert.equal(model.rows.length, 1);
    assert.equal(model.additionalExerciseCount, 0);
    assert.equal(model.statusLabel, "Pendiente · 0 de 1");
    assert.equal(model.actionLabel, "Ir a rutina");
  }

  {
    const model = buildTrainingCarouselCardModel({
      day: "Miercoles",
      routineName: " ",
      status: "partial",
      isToday: true,
      registeredCount: 1,
      plannedCount: 3,
      registeredExercises: [{
        id: "registered-1",
        exerciseName: "Inclinado smith",
        targetSets: 0,
        totalReps: Number.NaN,
        weight: null,
      }],
      plannedExercises: [{
        id: "planned-1",
        name: "Apertura crossover",
        targetSets: undefined,
        targetReps: 12,
        baseWeight: 0,
      }],
      actionLabel: "Ir a rutina",
      maxVisibleExercises: 4,
    });

    assert.equal(model.routineName, "Entrenamiento");
    assert.equal(model.statusLabel, "Parcial · 1 de 3 · Hoy");
    assert.equal(model.rows[0]?.source, "registered");
    assert.equal(model.rows[0]?.sets, "—");
    assert.equal(model.rows[0]?.reps, "—");
    assert.equal(model.rows[0]?.kg, "—");
    assert.equal(model.rows[1]?.source, "planned");
    assert.equal(model.rows[1]?.sets, "—");
    assert.equal(model.rows[1]?.reps, "12");
    assert.equal(model.rows[1]?.kg, "—");
  }

  {
    const cssSource = readFileSync("src/app/globals.css", "utf8");
    const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
    const helperSource = readFileSync("src/lib/training/training-carousel-card-presentation.ts", "utf8");
    const contentStart = appSource.indexOf("function DashboardTrainingCardContent");
    const contentEnd = appSource.indexOf("function DashboardDayDots", contentStart);
    const cardContentSource = contentStart >= 0 && contentEnd > contentStart ? appSource.slice(contentStart, contentEnd) : "";
    assert.match(cssSource, /\.dashboard-training-carousel[\s\S]*overflow-x: auto/, "carrusel conserva overflow horizontal");
    assert.match(cssSource, /\.dashboard-training-carousel[\s\S]*scroll-snap-type: x mandatory/, "carrusel conserva scroll-snap");
    assert.match(cssSource, /\.dashboard-training-slide[\s\S]*scroll-snap-align: start/, "slides conservan snap align");
    assert.doesNotMatch(helperSource, /Supabase|saveTrainingSession|saveTrainingWorkoutReadiness|getSupabaseBrowserClient/, "helper visual no llama Supabase ni guardado");
    assert.doesNotMatch(cardContentSource, /Supabase|saveTrainingSession|saveTrainingWorkoutReadiness|getSupabaseBrowserClient|createWorkoutAttemptId/, "contenido visual no llama Supabase, guardado ni attempts");
  }

  console.log("training carousel card presentation tests passed");
}

void run();
