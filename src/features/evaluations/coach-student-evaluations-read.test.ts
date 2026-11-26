import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EvaluationRepositoryError,
  listOwnCoachStudentEvaluations,
} from "@/features/evaluations/data/evaluations-repository";

const migration = readFileSync(
  "supabase/migrations/20261126200839_coach_student_evaluation_read_v1.sql", "utf8",
);

test("la ficha sólo lee evaluaciones de un episodio propio y todavía activo", () => {
  assert.match(migration, /episode\.id = p_episode_id and episode\.coach_user_id = v_coach\s+and episode\.ended_at is null/);
  assert.match(migration, /registration\.user_id = v_coach and episode\.id = p_episode_id\s+and episode\.ended_at is null/);
  assert.match(migration, /assignment\.relationship_episode_id = p_episode_id\s+and assignment\.coach_user_id = v_coach/);
  assert.match(migration, /when response\.state = 'completed' then response\.answers\s+else '\{\}'::jsonb/);
  assert.match(migration, /revoke all on function public\.list_own_coach_student_evaluations\(uuid, integer, integer\)\s+from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all) on (?:table )?private\./i);
});

test("el lector rechaza episodios y paginación inválidos antes de consultar", async () => {
  for (const [episodeId, limit, offset] of [
    ["not-an-episode", 50, 0],
    ["11111111-1111-4111-8111-111111111111", 101, 0],
    ["11111111-1111-4111-8111-111111111111", 50, -1],
  ] as const) {
    await assert.rejects(
      listOwnCoachStudentEvaluations("11111111-1111-4111-8111-111111111111", episodeId, limit, offset),
      (error: unknown) => error instanceof EvaluationRepositoryError && error.code === "invalid",
    );
  }
});
