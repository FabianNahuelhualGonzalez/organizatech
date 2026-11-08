import assert from "node:assert/strict";
import test from "node:test";

import type { ExerciseEntry, ExerciseTemplate, TrainingSession } from "@/lib/progress/types";
import {
  countFlexibleCompletedRoutines,
  selectFlexibleComparisonEntries,
  selectFlexibleWeekRepresentatives,
} from "./flexible-training-progress";
import {
  flexibleCompletionTitle,
  flexibleRoutineLabel,
  getFlexibleTrainingStartDate,
  isFlexibleTrainingPlan,
} from "./flexible-training-schedule";

const cycleId = "cycle-1";
const exercises: ExerciseTemplate[] = [
  { id: "a", cycleId, cycleDayId: "slot-a", routine: "A", day: "Lunes", name: "Sentadilla", targetSets: 4, targetReps: 8, baseWeight: 100 },
  { id: "b", cycleId, cycleDayId: "slot-b", routine: "B", day: "Martes", name: "Remo", targetSets: 4, targetReps: 8, baseWeight: 60 },
  { id: "c", cycleId, cycleDayId: "slot-c", routine: "C", day: "Miércoles", name: "Press", targetSets: 4, targetReps: 8, baseWeight: 50 },
];

function session(id: string, slot: string, week: number, date: string, completedAt: string, status: TrainingSession["status"] = "completed"): TrainingSession {
  return { id, cycleId, cycleDayId: slot, routineId: null, routine: slot, weekNumber: week,
    calendarWeekStart: "2026-11-09", plannedDay: "monday", plannedDate: date, trainedDate: date,
    trainedAt: completedAt, completedAt, status, entries: [] };
}

function entry(id: string, sessionId: string, exerciseId: string, week: number, date: string): ExerciseEntry {
  return { id, sessionId, cycleId, cycleDayId: "slot-a", exerciseId, exerciseName: "Sentadilla", routine: "A",
    week, date, targetSets: 4, targetReps: 8, weight: 100, previousWeight: 100, reps: [8, 8, 8, 7] };
}

test("A repetida conserva ambas sesiones y no completa B o C", () => {
  const sessions = [
    session("a1", "slot-a", 1, "2026-11-10", "2026-11-10T12:00:00Z"),
    session("a2", "slot-a", 1, "2026-11-10", "2026-11-10T19:00:00Z"),
  ];
  assert.equal(countFlexibleCompletedRoutines({ sessions, exercises, cycleId, trainedDate: "2026-11-10" }), 1);
  assert.deepEqual(selectFlexibleWeekRepresentatives(sessions, cycleId).map((item) => item.id), ["a2"]);
  assert.equal(countFlexibleCompletedRoutines({ sessions, exercises, cycleId, trainedDate: "2026-11-10", justCompletedSlotId: "slot-b" }), 2);
});

test("la comparación usa sólo la última sesión completa por rutina y semana", () => {
  const sessions = [
    session("a1", "slot-a", 1, "2026-11-10", "2026-11-10T12:00:00Z"),
    session("a2", "slot-a", 1, "2026-11-13", "2026-11-13T12:00:00Z"),
    session("a3", "slot-a", 2, "2026-11-17", "2026-11-17T12:00:00Z"),
    session("b1", "slot-b", 1, "2026-11-12", "2026-11-12T12:00:00Z", "skipped"),
  ];
  const entries = [entry("old-a", "a1", "a", 1, "2026-11-10"), entry("new-a", "a2", "a", 1, "2026-11-13"), entry("week2-a", "a3", "a", 2, "2026-11-17"), entry("skipped-b", "b1", "b", 1, "2026-11-12")];
  const selected = selectFlexibleComparisonEntries({ sessions, entries, exercises, routineDays: ["Lunes", "Martes", "Miércoles"], cycleId });
  assert.deepEqual(selected.routineDays, ["Lunes"]);
  assert.deepEqual(selected.entries.map((item) => item.id), ["new-a", "week2-a"]);
});

test("la fecha nocturna sigue el inicio en Santiago y los ciclos fijos no cambian", () => {
  assert.equal(getFlexibleTrainingStartDate("2026-11-10T02:30:00Z"), "2026-11-09");
  assert.equal(flexibleRoutineLabel("Lunes"), "Rutina A");
  assert.match(flexibleCompletionTitle("Lunes", "2026-11-09"), /Rutina A completada · lunes/);
  assert.equal(isFlexibleTrainingPlan({ plan: { scheduleMode: "flexible", days: [] } }), true);
  assert.equal(isFlexibleTrainingPlan({ plan: { days: [] } }), false);
});
