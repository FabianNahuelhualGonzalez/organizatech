import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20261009235959_coach_link_required_commercial_terms_v1.sql", "utf8");

test("new invitation RPC requires owned, allowlisted terms and preserves request payload idempotency", () => {
  assert.match(sql, /add column amount_clp bigint check \(amount_clp between 1 and 1000000000000\)/);
  assert.match(sql, /add constraint coach_invitation_terms_together/);
  assert.match(sql, /revoke execute on function public\.create_own_coach_invitation\(text, uuid\)/);
  assert.match(sql, /private\.lock_coach_invitation_owner\(\)/);
  assert.match(sql, /v_existing\.payload <> v_payload/);
  assert.match(sql, /state = 'pending' and amount_clp is null and frequency is null/);
  assert.match(sql, /update private\.coach_invitations set state = 'cancelled', invitation_code = null/);
  assert.match(sql, /exception when sqlstate 'P0R01'/);
  assert.match(sql, /update private\.coach_invitation_operations set payload = v_payload/);
  assert.match(sql, /grant execute on function public\.create_own_coach_invitation\(text, uuid, bigint, text\)/);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from) public\./i);
});

test("one episode insert atomically creates agreement and initial period using Santiago date", () => {
  assert.match(sql, /after insert on private\.coach_relationship_episodes/);
  assert.match(sql, /v_invitation\.amount_clp is null or v_invitation\.frequency is null/);
  assert.match(sql, /errcode = 'P0C01'/);
  assert.match(sql, /return jsonb_build_object\('status', 'requiere_renovacion'\)/);
  assert.match(sql, /new\.linked_at at time zone 'America\/Santiago'/);
  assert.match(sql, /insert into private\.coach_commercial_agreements/);
  assert.match(sql, /insert into private\.coach_commercial_periods/);
  assert.match(sql, /private\.coach_commercial_period_end\(v_start, v_invitation\.frequency\)/);
  assert.doesNotMatch(sql, /\b(?:delete from|truncate|drop table)\b/i);
});
