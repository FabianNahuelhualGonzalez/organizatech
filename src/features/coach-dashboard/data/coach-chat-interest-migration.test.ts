import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("supabase/migrations/20261009234519_coach_chat_interest_read_v1.sql", "utf8");

test("Chat read RPC has one Boolean result and existing Coach ownership", () => {
  assert.match(source, /create function public\.read_own_coach_chat_interest\(\)\s+returns jsonb/i);
  assert.match(source, /security definer\s+set search_path = ''/i);
  assert.match(source, /v_owner uuid := private\.require_coach_dashboard_owner\(\)/);
  assert.match(source, /'chatInterestRegistered', exists \(/);
  assert.match(source, /interest\.coach_user_id = v_owner and interest\.feature = 'chat'/);
  assert.match(source, /revoke all on function public\.read_own_coach_chat_interest\(\) from public, anon, authenticated;/);
  assert.match(source, /grant execute on function public\.read_own_coach_chat_interest\(\) to authenticated;/);
  assert.equal((source.match(/pg_catalog\.jsonb_build_object/g) ?? []).length, 1);
  assert.doesNotMatch(source, /monthly_fee_clp|monthlyFeeClp|coach_dashboard_settings|\bp_[a-z_]+\b/i);
  assert.doesNotMatch(source, /(?:create|alter|drop)\s+(?:table|policy|trigger)|(?:insert into|update|delete from)/i);
});
