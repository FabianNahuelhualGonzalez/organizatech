import assert from "node:assert/strict";

import {
  findDashboardEntries,
  findDashboardSessionForDay,
  getDashboardEntryExerciseIdentity,
  getDashboardExerciseIdentity,
} from "@/lib/dashboard/dashboard-session-selection";
import type {
  ExerciseEntry,
  ExerciseTemplate,
  TrainingSession,
} from "@/lib/progress/types";

function createExercise(overrides: Partial<ExerciseTemplate> = {}): ExerciseTemplate {
  return {
    id: "legacy-exercise",
    routine: "Piernas",
    day: "Miércoles",
    name: "Sentadilla",
    targetSets: 3,
    targetReps: 10,
    baseWeight: 80,
    ...overrides,
  };
}

function createEntry(overrides: Partial<ExerciseEntry> = {}): ExerciseEntry {
  return {
    id: "entry-1",
    exerciseId: "legacy-exercise",
    exerciseName: "Sentadilla",
    routine: "Piernas",
    week: 1,
    date: "2026-07-08",
    targetSets: 3,
    targetReps: 10,
    weight: 80,
    previousWeight: 75,
    reps: [10, 10, 10],
    ...overrides,
  };
}

function createSession(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: "session-1",
    routineId: "routine-1",
    routine: "Piernas",
    weekNumber: 1,
    calendarWeekStart: "2026-07-06",
    plannedDay: "wednesday",
    plannedDate: "2026-07-08",
    trainedDate: "2026-07-08",
    trainedAt: "2026-07-08T14:00:00.000Z",
    status: "completed",
    entries: [],
    ...overrides,
  };
}

function testExerciseIdentityPreservesLegacyAndCycleScopedFallbacks() {
  const exercise = createExercise({
    trainingCycleExerciseId: "cycle-exercise",
    exerciseLineageId: "lineage-1",
  });
  const entry = createEntry({
    trainingCycleExerciseId: "cycle-exercise",
    exerciseLineageId: "lineage-1",
  });

  assert.equal(getDashboardExerciseIdentity(exercise, false), "legacy-exercise");
  assert.equal(getDashboardExerciseIdentity(exercise, true), "cycle-exercise");
  assert.equal(getDashboardEntryExerciseIdentity(entry, false), "legacy-exercise");
  assert.equal(getDashboardEntryExerciseIdentity(entry, true), "cycle-exercise");
  assert.equal(
    getDashboardExerciseIdentity(createExercise({ exerciseLineageId: "lineage-only" }), true),
    "legacy-exercise",
    "sin trainingCycleExerciseId conserva el fallback legacy aunque exista lineage",
  );
}

function testDashboardEntriesFiltersLegacyDateAndExerciseIdentity() {
  const exercises = [createExercise()];
  const matching = createEntry({ date: "2026-07-08T15:00:00.000Z" });
  const otherDate = createEntry({ id: "entry-2", date: "2026-07-09" });
  const otherExercise = createEntry({ id: "entry-3", exerciseId: "other-exercise" });

  assert.deepEqual(
    findDashboardEntries([matching, otherDate, otherExercise], exercises, "2026-07-08", false),
    [matching],
  );
  assert.deepEqual(findDashboardEntries([matching], exercises, "", false), []);
  assert.deepEqual(findDashboardEntries([matching], [], "2026-07-08", false), []);
}

function testDashboardEntriesUsesCycleIdentityWithoutRequiringEntryDate() {
  const exercises = [createExercise({ trainingCycleExerciseId: "cycle-exercise" })];
  const matching = createEntry({
    date: "2026-06-01",
    trainingCycleExerciseId: "cycle-exercise",
  });
  const other = createEntry({
    id: "entry-2",
    trainingCycleExerciseId: "other-cycle-exercise",
  });

  assert.deepEqual(
    findDashboardEntries([matching, other], exercises, "2026-07-08", true),
    [matching],
  );
}

function testSessionSelectionPreservesLegacyAndCycleScopedPriority() {
  const exercises = [createExercise({ cycleDayId: "cycle-day-1", trainingCycleExerciseId: "cycle-exercise" })];
  const legacyByDate = createSession({ id: "legacy-date", plannedDay: "monday" });
  const legacyByDay = createSession({ id: "legacy-day", plannedDate: "2026-07-01" });
  assert.equal(
    findDashboardSessionForDay([legacyByDate, legacyByDay], exercises, "2026-07-08", "wednesday", false)?.id,
    "legacy-date",
  );

  const scopedByEntry = createSession({
    id: "scoped-entry",
    cycleDayId: "different-day",
    plannedDay: "monday",
    entries: [createEntry({ trainingCycleExerciseId: "cycle-exercise", date: "2026-06-01" })],
  });
  assert.equal(
    findDashboardSessionForDay([scopedByEntry], exercises, "2026-07-08", "wednesday", true)?.id,
    "scoped-entry",
  );

  const scopedByCycleDay = createSession({ id: "scoped-day", cycleDayId: "cycle-day-1", plannedDay: "monday" });
  assert.equal(
    findDashboardSessionForDay([scopedByCycleDay], exercises, "2026-07-08", "wednesday", true)?.id,
    "scoped-day",
  );

  const scopedByPlannedDay = createSession({ id: "scoped-planned", cycleDayId: "different-day" });
  assert.equal(
    findDashboardSessionForDay([scopedByPlannedDay], exercises, "2026-07-08", "wednesday", true)?.id,
    "scoped-planned",
  );
}

testExerciseIdentityPreservesLegacyAndCycleScopedFallbacks();
testDashboardEntriesFiltersLegacyDateAndExerciseIdentity();
testDashboardEntriesUsesCycleIdentityWithoutRequiringEntryDate();
testSessionSelectionPreservesLegacyAndCycleScopedPriority();

console.log("dashboard session selection tests passed");
