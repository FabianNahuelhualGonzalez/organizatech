import type { CycleHistoryLoadState } from "@/lib/training/cycle-history/cycle-history-coordinator";
import { buildCycleHistoryPdfFilename } from "@/lib/training/cycle-history/cycle-history-filename";
import type { CycleHistoryPdfModel } from "@/lib/training/cycle-history/cycle-history-pdf-model";

export function buildCycleHistoryPdfTestModel(): CycleHistoryPdfModel {
  return {
    generatedAt: "2026-07-21T12:30:00.000Z",
    filename: buildCycleHistoryPdfFilename({
      cycleNumber: 7,
      generatedAt: "2026-07-21T12:30:00.000Z",
    }),
    personalData: {
      fullName: "Persona QA",
      email: "persona@example.test",
      birthDate: "1990-04-09",
      age: 36,
      gender: "non_binary",
      phoneNumber: "+56 9 1111 2222",
    },
    cycle: {
      cycleId: "cycle-pdf-qa",
      name: "Fuerza y técnica",
      cycleNumber: 7,
      cycleType: "Preparación física",
      status: "completed",
      plannedStartDate: "2026-06-01",
      plannedEndDate: "2026-06-28",
      durationWeeks: 4,
      weeksWithDataCount: 3,
    },
    metrics: {
      totalVolumeKg: 14520.5,
      registeredExerciseCount: 3,
      weeklyVolumeKg: { 1: 4200, 2: 4870.5, 3: 5450 },
      volumeProgress: {
        state: "increase",
        firstWeek: 1,
        lastWeek: 3,
        firstWeekVolume: 4200,
        lastWeekVolume: 5450,
        differenceKg: 1250,
      },
      volumeProgressText: "Tu volumen aumentó 1.250 kg entre la primera y la última semana registrada.",
    },
    routines: [
      {
        routineId: "routine-piernas",
        routineName: "Piernas y glúteos",
        weekBlocks: [[1, 2], [3]],
        exercises: [
          {
            identity: { kind: "lineage", key: "lineage-sentadilla" },
            name: "Sentadilla búlgara",
            plan: { targetSets: 3, targetReps: 10, baseWeight: 40 },
            weeks: {
              1: {
                week: 1,
                series: [
                  { entryId: "entry-1", weight: 40, reps: [10, 10, 9], volume: 1160 },
                  { entryId: "entry-2", weight: 42.5, reps: [10, 9, 9], volume: 1190 },
                ],
                totalReps: 57,
                volume: 2350,
              },
              2: {
                week: 2,
                series: [
                  { entryId: "entry-3", weight: 45, reps: [10, 10, 10], volume: 1350 },
                ],
                totalReps: 30,
                volume: 1350,
              },
              3: {
                week: 3,
                series: [
                  { entryId: "entry-4", weight: 47.5, reps: [10, 10, 9], volume: 1377.5 },
                ],
                totalReps: 29,
                volume: 1377.5,
              },
            },
          },
          {
            identity: { kind: "lineage", key: "lineage-extension" },
            name: "Extensión de rodilla",
            plan: null,
            weeks: {
              2: {
                week: 2,
                series: [
                  { entryId: "entry-5", weight: 25, reps: [12, 12, 12], volume: 900 },
                ],
                totalReps: 36,
                volume: 900,
              },
            },
          },
        ],
      },
      {
        routineId: "routine-torso",
        routineName: "Torso",
        weekBlocks: [[2]],
        exercises: [
          {
            identity: { kind: "lineage", key: "lineage-press" },
            name: "Press de banca",
            plan: { targetSets: 4, targetReps: 8, baseWeight: 70 },
            weeks: {
              2: {
                week: 2,
                series: [
                  { entryId: "entry-6", weight: 72.5, reps: [8, 8, 8, 7], volume: 2247.5 },
                ],
                totalReps: 31,
                volume: 2247.5,
              },
            },
          },
        ],
      },
    ],
  };
}

export function buildCycleHistoryPdfTestDetailState(
  status: "ready" | "empty" = "ready",
): Extract<CycleHistoryLoadState, { status: "ready" | "empty" }> {
  const pdfModel = buildCycleHistoryPdfTestModel();
  const cycleId = pdfModel.cycle.cycleId;
  return {
    status,
    cycleId,
    data: {
      metadata: {
        cycleId,
        name: pdfModel.cycle.name,
        cycleNumber: pdfModel.cycle.cycleNumber,
        cycleType: pdfModel.cycle.cycleType,
        status: pdfModel.cycle.status,
        plannedStartDate: pdfModel.cycle.plannedStartDate,
        plannedEndDate: pdfModel.cycle.plannedEndDate,
        startedAt: pdfModel.cycle.plannedStartDate,
        endedAt: pdfModel.cycle.plannedEndDate,
        durationWeeks: pdfModel.cycle.durationWeeks,
        trainingDayCount: 3,
      },
      plan: { cycleId, routines: [] },
      breakdown: { cycleId, routines: [], weeksWithData: status === "ready" ? [1, 2, 3] : [] },
      metrics: pdfModel.metrics,
      pdfModel,
      sessionCount: status === "ready" ? 3 : 0,
      entryCount: status === "ready" ? 6 : 0,
    },
  };
}
