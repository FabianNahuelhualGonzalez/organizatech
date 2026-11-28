import assert from "node:assert/strict";
import test from "node:test";
import { parseCoachStudentActivity, parseCoachStudentAttentionPage } from "./coach-student-attention";

const episodeId = "11111111-1111-4111-8111-111111111111";

test("attention preserves multiple reasons for one linked student and an accurate distinct count", () => {
  const result = parseCoachStudentAttentionPage({ serverToday: "2026-11-28", total: 1, rows: [{
    episodeId, studentName: "Alumna de prueba", reasons: ["Pago vencido", "Sin entrenar desde hace 3 días o más"],
    dueOn: "2026-11-25", lastTrainingOn: "2026-11-25", routineUpdatedAt: null, isTraining: false,
  }] });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].reasons.length, 2);
});

test("attention rejects unknown server reasons and malformed activity", () => {
  assert.throws(() => parseCoachStudentAttentionPage({ serverToday: "2026-11-28", total: 1, rows: [{
    episodeId, studentName: "Alumna de prueba", reasons: ["Texto inesperado"],
    dueOn: null, lastTrainingOn: null, routineUpdatedAt: null, isTraining: false,
  }] }), /invalid_response/);
  assert.deepEqual(parseCoachStudentActivity({ lastTrainingOn: null, sessionsInCycle: 0, isTraining: true }),
    { lastTrainingOn: null, sessionsInCycle: 0, isTraining: true });
  assert.throws(() => parseCoachStudentActivity({ lastTrainingOn: null, sessionsInCycle: -1, isTraining: true }));
});
