import { buildCycleHistoryBreakdown } from "@/lib/training/cycle-history/cycle-history-breakdown";
import { buildCycleHistoryMetricsSummary } from "@/lib/training/cycle-history/cycle-history-metrics";
import { buildCycleHistoryPdfModel } from "@/lib/training/cycle-history/cycle-history-pdf-model";
import type {
  CycleHistoryDetail,
  CycleHistoryPublicError,
} from "@/lib/training/cycle-history/cycle-history-service";
import type {
  CycleHistoryCycleMetadata,
  CycleHistoryEntryRow,
  CycleHistoryPersonalData,
  CycleHistoryPlan,
  CycleHistorySessionRow,
} from "@/lib/training/cycle-history/cycle-history-types";

/**
 * Fixtures 100% estáticos para la ruta QA aislada de H1-C.
 *
 * No consulta Supabase, no importa ningún repository ni el data source de H1-B.
 * No contiene datos personales reales: el nombre y demás campos son inventados
 * exclusivamente para esta demo visual.
 */

const QA_GENERATED_AT = "2026-07-21T12:00:00.000Z";

export const QA_PERSONAL_DATA: CycleHistoryPersonalData = {
  firstName: "QA",
  lastName: "Fixture",
  email: null,
  birthDate: null,
  gender: null,
  phoneNumber: null,
};

const QA_CYCLE_WITH_DATA: CycleHistoryCycleMetadata = {
  cycleId: "qa-cycle-1",
  name: "Mesociclo",
  cycleNumber: 3,
  cycleType: "Hipertrofia",
  status: "completed",
  plannedStartDate: "2026-06-01",
  plannedEndDate: "2026-06-28",
  startedAt: "2026-06-01T12:00:00.000Z",
  endedAt: "2026-06-28T12:00:00.000Z",
  durationWeeks: 4,
};

const QA_CYCLE_EMPTY: CycleHistoryCycleMetadata = {
  cycleId: "qa-cycle-2",
  name: "Mesociclo",
  cycleNumber: 2,
  cycleType: "Resistencia",
  status: "cancelled",
  plannedStartDate: "2026-04-01",
  plannedEndDate: null,
  startedAt: "2026-04-01T12:00:00.000Z",
  endedAt: "2026-04-10T12:00:00.000Z",
  durationWeeks: null,
};

const QA_CYCLE_ACTIVE: CycleHistoryCycleMetadata = {
  cycleId: "qa-cycle-3",
  name: "Macrociclo",
  cycleNumber: 4,
  cycleType: null,
  status: "active",
  plannedStartDate: "2026-07-01",
  plannedEndDate: null,
  startedAt: "2026-07-01T12:00:00.000Z",
  endedAt: null,
  durationWeeks: 6,
};

export const QA_CYCLES: CycleHistoryCycleMetadata[] = [
  QA_CYCLE_ACTIVE,
  QA_CYCLE_WITH_DATA,
  QA_CYCLE_EMPTY,
];

const QA_PLAN_WITH_DATA: CycleHistoryPlan = {
  cycleId: QA_CYCLE_WITH_DATA.cycleId,
  routines: [
    {
      id: "qa-routine-1",
      name: "Torso Fuerza",
      sortOrder: 0,
      days: [
        {
          id: "qa-day-1",
          routineId: "qa-routine-1",
          weekIndex: 1,
          dayCode: "monday",
          sortOrder: 0,
          exercises: [
            {
              id: "qa-exercise-1",
              name: "Press militar",
              targetSets: 4,
              targetReps: 10,
              baseWeight: 100,
              sortOrder: 0,
              exerciseLineageId: "qa-lineage-1",
            },
            {
              id: "qa-exercise-2",
              name: "Remo con barra",
              targetSets: 4,
              targetReps: 8,
              baseWeight: 80,
              sortOrder: 1,
              exerciseLineageId: "qa-lineage-2",
            },
          ],
        },
      ],
    },
  ],
};

const QA_SESSIONS_WITH_DATA: CycleHistorySessionRow[] = [
  {
    id: "qa-session-1",
    cycleId: QA_CYCLE_WITH_DATA.cycleId,
    routineId: "qa-routine-1",
    routineName: "Torso Fuerza",
    trainedDate: "2026-06-01",
  },
  {
    id: "qa-session-2",
    cycleId: QA_CYCLE_WITH_DATA.cycleId,
    routineId: "qa-routine-1",
    routineName: "Torso Fuerza",
    trainedDate: "2026-06-08",
  },
];

const QA_ENTRIES_WITH_DATA: CycleHistoryEntryRow[] = [
  {
    id: "qa-entry-1",
    sessionId: "qa-session-1",
    exerciseLineageId: "qa-lineage-1",
    trainingCycleExerciseId: "qa-exercise-1",
    exerciseName: "Press militar",
    weight: 100,
    reps: [10, 10, 10, 8],
  },
  {
    id: "qa-entry-2",
    sessionId: "qa-session-1",
    exerciseLineageId: "qa-lineage-2",
    trainingCycleExerciseId: "qa-exercise-2",
    exerciseName: "Remo con barra",
    weight: 80,
    reps: [8, 8, 8, 8],
  },
  {
    id: "qa-entry-3",
    sessionId: "qa-session-2",
    exerciseLineageId: "qa-lineage-1",
    trainingCycleExerciseId: "qa-exercise-1",
    exerciseName: "Press militar",
    weight: 102.5,
    reps: [10, 10, 10, 10],
  },
];

function buildDetail(
  cycle: CycleHistoryCycleMetadata,
  plan: CycleHistoryPlan,
  sessions: CycleHistorySessionRow[],
  entries: CycleHistoryEntryRow[],
): CycleHistoryDetail {
  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: cycle.cycleId,
    plan,
    sessions,
    entries,
    plannedStartDate: cycle.plannedStartDate,
  });
  const metrics = buildCycleHistoryMetricsSummary(breakdown);
  return {
    metadata: cycle,
    plan,
    breakdown,
    metrics,
    pdfModel: buildCycleHistoryPdfModel({
      cycle,
      breakdown,
      personalData: QA_PERSONAL_DATA,
      generatedAt: QA_GENERATED_AT,
    }),
    sessionCount: sessions.length,
    entryCount: entries.length,
  };
}

export const QA_DETAIL_WITH_DATA: CycleHistoryDetail = buildDetail(
  QA_CYCLE_WITH_DATA,
  QA_PLAN_WITH_DATA,
  QA_SESSIONS_WITH_DATA,
  QA_ENTRIES_WITH_DATA,
);

export const QA_DETAIL_EMPTY: CycleHistoryDetail = buildDetail(
  QA_CYCLE_EMPTY,
  { cycleId: QA_CYCLE_EMPTY.cycleId, routines: [] },
  [],
  [],
);

export const QA_DETAIL_ACTIVE: CycleHistoryDetail = buildDetail(
  QA_CYCLE_ACTIVE,
  { cycleId: QA_CYCLE_ACTIVE.cycleId, routines: [] },
  [],
  [],
);

export const QA_SIMULATED_ERROR: CycleHistoryPublicError = {
  code: "unexpected",
  message: "No pudimos cargar el detalle de este ciclo.",
};

export function getQaDetailForCycle(cycleId: string): CycleHistoryDetail | null {
  if (cycleId === QA_CYCLE_WITH_DATA.cycleId) return QA_DETAIL_WITH_DATA;
  if (cycleId === QA_CYCLE_EMPTY.cycleId) return QA_DETAIL_EMPTY;
  if (cycleId === QA_CYCLE_ACTIVE.cycleId) return QA_DETAIL_ACTIVE;
  return null;
}
