import assert from "node:assert/strict";

import type { ExerciseEntry, TrainingSession } from "@/lib/progress/types";
import { buildTrainingProgressTimeline, getRelativeProgressWeek } from "@/lib/progress/training-progress-week";

const entry: ExerciseEntry = {
  id: "entry-1",
  sessionId: "session-1",
  cycleId: "cycle-1",
  exerciseId: "exercise-1",
  exerciseName: "Jalón al pecho",
  routine: "Jalón",
  week: 6,
  date: "2026-11-08",
  targetSets: 4,
  targetReps: 10,
  weight: 20,
  previousWeight: 20,
  reps: [10, 10, 10, 10],
};
const session: TrainingSession = {
  id: "session-1",
  cycleId: "cycle-1",
  routineId: "routine-1",
  routine: "Jalón",
  weekNumber: 6,
  calendarWeekStart: "2026-11-02",
  plannedDay: "sunday",
  plannedDate: "2026-11-08",
  trainedDate: "2026-11-08",
  trainedAt: "2026-11-08T20:00:00.000Z",
  status: "completed",
  entries: [entry],
};

{
  const result = buildTrainingProgressTimeline({
    entries: [entry],
    sessions: [session],
    referenceDate: "2026-11-08",
    activeCycleId: "cycle-1",
  });

  assert.equal(result.anchorDate, "2026-11-08");
  assert.equal(result.currentWeek, 1, "el primer entrenamiento real siempre inicia el progreso en semana 1");
  assert.equal(result.entries[0]?.week, 1);
  assert.equal(result.sessions[0]?.weekNumber, 1);
  assert.equal(result.sessions[0]?.entries[0]?.week, 1);
}

assert.equal(getRelativeProgressWeek("2026-11-08", "2026-11-09"), 2);
assert.equal(getRelativeProgressWeek("2026-11-08", "2026-11-22"), 3);

{
  const result = buildTrainingProgressTimeline({
    entries: [],
    sessions: [],
    referenceDate: "2026-11-08",
    activeCycleId: "cycle-1",
  });
  assert.equal(result.currentWeek, 1, "sin entrenamientos reales la interfaz permanece preparada para semana 1");
}
