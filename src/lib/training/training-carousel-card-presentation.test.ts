import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildTrainingCarouselCardModel,
  resolveActiveCarouselIndex,
  resolveTrainingCarouselAction,
} from "@/lib/training/training-carousel-card-presentation";

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
  assert.deepEqual(resolveTrainingCarouselAction("completed"), { label: "Ver resumen", action: "summary" });
  assert.deepEqual(resolveTrainingCarouselAction("pending"), { label: "Ir a rutina", action: "routine" });
  assert.deepEqual(resolveTrainingCarouselAction("partial"), { label: "Continuar rutina", action: "routine" });
  assert.equal(resolveTrainingCarouselAction("completed").label, "Ver resumen");
  assert.equal(resolveTrainingCarouselAction("pending").label, "Ir a rutina");
  assert.equal(resolveTrainingCarouselAction("partial").label, "Continuar rutina");

  {
    const slideStatuses = ["completed", "pending"] as const;
    assert.equal(resolveTrainingCarouselAction(slideStatuses[0]).label, "Ver resumen");
    assert.equal(resolveTrainingCarouselAction(slideStatuses[1]).label, "Ir a rutina");
  }

  {
    const slideStatuses = ["pending", "completed"] as const;
    assert.equal(resolveTrainingCarouselAction(slideStatuses[0]).action, "routine");
    assert.equal(resolveTrainingCarouselAction(slideStatuses[1]).action, "summary");
  }

  {
    const slides = [
      { offsetLeft: 0, offsetWidth: 320 },
      { offsetLeft: 320, offsetWidth: 320 },
    ];
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 0, viewportWidth: 320, slides }), 0);
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 320, viewportWidth: 320, slides }), 1);
  }

  {
    const slides = [
      { offsetLeft: 0, offsetWidth: 300 },
      { offsetLeft: 316, offsetWidth: 300 },
      { offsetLeft: 632, offsetWidth: 300 },
    ];
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 316, viewportWidth: 300, slides }), 1);
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 632, viewportWidth: 300, slides }), 2);
  }

  {
    const slides = [
      { offsetLeft: 48, offsetWidth: 360 },
      { offsetLeft: 424, offsetWidth: 360 },
    ];
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 0, viewportWidth: 360, slides }), 0);
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 376, viewportWidth: 360, slides }), 1);
  }

  {
    const desktopSlides = [
      { offsetLeft: 12, offsetWidth: 840 },
      { offsetLeft: 852, offsetWidth: 840 },
    ];
    const mobileSlides = [
      { offsetLeft: 6, offsetWidth: 342 },
      { offsetLeft: 348, offsetWidth: 342 },
    ];
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 840, viewportWidth: 840, slides: desktopSlides }), 1);
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 342, viewportWidth: 342, slides: mobileSlides }), 1);
  }

  {
    const slides = [
      { offsetLeft: 0, offsetWidth: 300 },
      { offsetLeft: 300, offsetWidth: 300 },
    ];
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 150, viewportWidth: 300, slides }), 0);
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: -80, viewportWidth: 300, slides }), 0);
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 900, viewportWidth: 300, slides }), 1);
    assert.equal(resolveActiveCarouselIndex({ scrollLeft: 0, viewportWidth: 300, slides: [] }), 0);
  }

  {
    const weekDays = ["Lunes", "Martes"];
    const slides = [
      { offsetLeft: 32, offsetWidth: 500 },
      { offsetLeft: 532, offsetWidth: 500 },
    ];
    const martesIndex = resolveActiveCarouselIndex({ scrollLeft: 500, viewportWidth: 500, slides });
    const lunesIndex = resolveActiveCarouselIndex({ scrollLeft: 0, viewportWidth: 500, slides });
    assert.equal(weekDays[martesIndex], "Martes");
    assert.equal(weekDays[lunesIndex], "Lunes");
  }

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
    const dashboardStart = appSource.indexOf("function DashboardScreen");
    const dashboardEnd = appSource.indexOf("function buildDashboardTrainingCardModel", dashboardStart);
    const dashboardSource = dashboardStart >= 0 && dashboardEnd > dashboardStart ? appSource.slice(dashboardStart, dashboardEnd) : "";
    assert.match(cssSource, /\.dashboard-training-carousel[\s\S]*overflow-x: auto/, "carrusel conserva overflow horizontal");
    assert.match(cssSource, /\.dashboard-training-carousel[\s\S]*scroll-snap-type: x mandatory/, "carrusel conserva scroll-snap");
    assert.match(cssSource, /\.dashboard-training-slide[\s\S]*scroll-snap-align: start/, "slides conservan snap align");
    assert.match(dashboardSource, /const activeDayAction = resolveTrainingCarouselAction\(activeDayData\.status\)/, "boton activo deriva label y accion desde el status activo");
    assert.match(dashboardSource, /resolveActiveCarouselIndex\(\{[\s\S]*scrollLeft: container\.scrollLeft,[\s\S]*viewportWidth: container\.clientWidth,[\s\S]*offsetLeft: child\.offsetLeft,[\s\S]*offsetWidth: child\.offsetWidth/, "handler usa el resolvedor robusto de slide activo");
    assert.match(dashboardSource, /activeDayAction\.action === "summary" \? viewSummary\(activeDayData\.day\) : goToRoutine\(\)/, "accion del boton usa la misma decision que el label");
    assert.match(dashboardSource, /\{activeDayAction\.label\}/, "label del boton usa la decision activa");
    assert.doesNotMatch(dashboardSource, /activeDayData\.isCompleted \? "Ver resumen" : "Ir a rutina"|activeDayData\.isCompleted \? viewSummary/, "boton no depende de isCompleted stale");
    assert.doesNotMatch(helperSource, /Supabase|saveTrainingSession|saveTrainingWorkoutReadiness|getSupabaseBrowserClient/, "helper visual no llama Supabase ni guardado");
    assert.doesNotMatch(cardContentSource, /Supabase|saveTrainingSession|saveTrainingWorkoutReadiness|getSupabaseBrowserClient|createWorkoutAttemptId/, "contenido visual no llama Supabase, guardado ni attempts");
  }

  console.log("training carousel card presentation tests passed");
}

void run();
