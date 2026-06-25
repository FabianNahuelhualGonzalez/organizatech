import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260620_training_workout_readiness.sql", "utf8");
const postcheck = readFileSync("supabase/operations/qa/release-b/d2/01_postcheck_readonly.sql", "utf8");

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function stripSqlComments(value: string): string {
  return value
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripSqlStringLiterals(value: string): string {
  return value.replace(/'(?:''|[^'])*'/g, "''");
}

const sql = normalizeLineEndings(migration);
const executableSql = stripSqlComments(sql);
const postcheckSql = normalizeLineEndings(postcheck);
const executablePostcheckSql = stripSqlComments(postcheckSql);
const executablePostcheckWithoutStrings = stripSqlStringLiterals(executablePostcheckSql);

const saveFunctionBody =
  executableSql.match(/create or replace function public\.save_training_workout_readiness_v2[\s\S]*?\$function\$;/i)?.[0] ??
  "";
assert.ok(saveFunctionBody, "extrae cuerpo de save v2");
assert.match(postcheckSql, /a\.attname::text as column_name/i, "postcheck convierte pg_attribute.attname a text en columns_found");
assert.match(postcheckSql, /array_agg\(src\.attname::text order by src_ord\.n\) as source_columns/i, "postcheck convierte source_columns a text[]");
assert.match(postcheckSql, /array_agg\(dst\.attname::text order by dst_ord\.n\) as target_columns/i, "postcheck convierte target_columns a text[]");
assert.match(postcheckSql, /array_agg\(att\.attname::text order by ord\.n\) as columns/i, "postcheck convierte index columns a text[]");
assert.match(postcheckSql, /\(tgtype & 1\) = 1/i, "postcheck valida FOR EACH ROW con bit 1");
assert.match(postcheckSql, /\(tgtype & 2\) = 2/i, "postcheck valida BEFORE con bit 2");
assert.match(postcheckSql, /\(tgtype & 16\) = 16/i, "postcheck valida UPDATE con bit 16");
assert.doesNotMatch(postcheckSql, /\(tgtype & 4\) = 4/i, "postcheck no valida INSERT con bit 4");
assert.match(executablePostcheckSql.trimStart(), /^begin transaction read only;/i, "postcheck inicia transaccion read only");
assert.match(executablePostcheckSql.trimEnd(), /rollback;$/i, "postcheck termina con rollback");
assert.match(postcheckSql, /case when bool_and\(ok\) then 'D2_QA_VERIFIED' else 'D2_QA_FAILED' end as verdict/i, "postcheck devuelve verdict");
assert.match(postcheckSql, /jsonb_object_agg\(check_name, ok order by check_name\) as checks/i, "postcheck devuelve checks");
assert.match(postcheckSql, /\(select to_jsonb\(row_counts\) from row_counts\) as row_counts/i, "postcheck devuelve row_counts");
assert.doesNotMatch(
  executablePostcheckWithoutStrings,
  /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke|call|do|copy|merge|execute)\b/i,
  "postcheck no contiene instrucciones SQL mutantes ejecutables",
);

assert.match(sql, /create table if not exists public\.training_workout_readiness/i, "crea tabla training_workout_readiness");
assert.match(sql, /constraint training_workout_readiness_user_attempt_key unique \(user_id, workout_attempt_id\)/i, "identidad unica por user_id/workout_attempt_id");
assert.match(sql, /create unique index if not exists training_workout_readiness_session_key[\s\S]+on public\.training_workout_readiness\(training_session_id\)[\s\S]+where training_session_id is not null/i, "unique parcial por training_session_id");
assert.match(sql, /foreign key \(cycle_id, user_id\)[\s\S]+references public\.training_cycles\(id, user_id\)[\s\S]+on delete restrict/i, "FK compuesta a training_cycles");
assert.match(sql, /foreign key \(cycle_day_id, cycle_id\)[\s\S]+references public\.training_cycle_days\(id, cycle_id\)[\s\S]+on delete restrict/i, "FK compuesta a training_cycle_days");
assert.match(sql, /foreign key \(training_session_id\)[\s\S]+references public\.training_sessions\(id\)[\s\S]+on delete restrict/i, "FK a training_sessions");
assert.match(sql, /constraint training_workout_readiness_payload_check check \([\s\S]+payload \? 'skipped'[\s\S]+motivation[\s\S]+hydration[\s\S]+sleep[\s\S]+energy/i, "CHECK de payload");
assert.match(sql, /alter table public\.training_workout_readiness enable row level security/i, "RLS habilitado");
assert.match(sql, /create policy "workout readiness own select"[\s\S]+for select[\s\S]+to authenticated[\s\S]+using \(auth\.uid\(\) = user_id\)/i, "solo policy SELECT propia");
const policyStatements = executableSql.match(/create policy[^;]+;/gi) ?? [];
assert.equal(policyStatements.length, 1, "solo existe una policy");
assert.doesNotMatch(policyStatements.join("\n"), /for\s+(insert|update|delete)/i, "sin policies directas de escritura");
assert.match(sql, /revoke all on table public\.training_workout_readiness from public/i, "revoca tabla public");
assert.match(sql, /revoke all on table public\.training_workout_readiness from anon/i, "revoca tabla anon");
assert.match(sql, /revoke all on table public\.training_workout_readiness from authenticated/i, "revoca tabla authenticated");
assert.match(sql, /revoke all on table public\.training_workout_readiness from service_role/i, "revoca tabla service_role");
assert.match(sql, /grant select on table public\.training_workout_readiness to authenticated/i, "tabla solo SELECT authenticated");
assert.doesNotMatch(
  executableSql,
  /grant\s+(select|insert|update|delete|truncate|references|trigger|maintain|all)\s+on\s+table\s+public\.training_workout_readiness\s+to\s+service_role/i,
  "sin grants de tabla a service_role",
);
assert.doesNotMatch(
  executableSql,
  /grant\s+[^;]+\s+on\s+table\s+public\.training_workout_readiness\s+to\s+service_role/i,
  "sin ningun grant de tabla a service_role",
);

assert.match(sql, /create or replace function public\.save_training_workout_readiness_v2\(\s*p_workout_attempt_id uuid,\s*p_cycle_id uuid,\s*p_cycle_day_id uuid,\s*p_workout_started_at timestamptz,\s*p_payload jsonb\s*\)/i, "RPC save v2 existe");
assert.match(sql, /create or replace function public\.link_training_workout_readiness_session_v2\(\s*p_workout_attempt_id uuid,\s*p_training_session_id uuid\s*\)/i, "RPC link v2 existe");
assert.match(sql, /save_training_workout_readiness_v2[\s\S]+security definer[\s\S]+set search_path = public, pg_temp/i, "save v2 SECURITY DEFINER y search_path");
assert.match(sql, /link_training_workout_readiness_session_v2[\s\S]+security definer[\s\S]+set search_path = public, pg_temp/i, "link v2 SECURITY DEFINER y search_path");
assert.match(sql, /v_user_id uuid := auth\.uid\(\)/i, "usa auth.uid()");
assert.doesNotMatch(sql, /\bp_user_id\b/i, "no acepta p_user_id");
assert.match(
  sql,
  /on conflict on constraint training_workout_readiness_user_attempt_key\s+do nothing/i,
  "save usa ON CONFLICT ON CONSTRAINT para evitar ambiguedad con RETURNS TABLE",
);
assert.doesNotMatch(
  sql,
  /on conflict \(user_id, workout_attempt_id\)\s+do nothing/i,
  "save no usa lista de columnas ambigua con variables de salida RETURNS TABLE",
);
assert.doesNotMatch(sql, /do update/i, "save no usa DO UPDATE");
assert.match(sql, /context_mismatch boolean/i, "save retorna context_mismatch");
assert.match(sql, /is distinct from p_cycle_id[\s\S]+is distinct from p_cycle_day_id[\s\S]+is distinct from p_workout_started_at[\s\S]+is distinct from v_local_date[\s\S]+is distinct from p_payload/i, "context_mismatch compara contexto");
assert.match(sql, /for update/i, "link bloquea readiness FOR UPDATE");
assert.match(sql, /v_session\.user_id <> v_user_id/i, "link valida usuario");
assert.match(sql, /v_session\.cycle_id is distinct from v_readiness\.cycle_id/i, "link valida ciclo");
assert.match(sql, /v_session\.cycle_day_id is distinct from v_readiness\.cycle_day_id/i, "link valida dia");
assert.match(
  saveFunctionBody,
  /p_workout_started_at > now\(\) \+ interval '5 minutes'\s+or p_workout_started_at < now\(\) - interval '36 hours'/i,
  "save v2 valida ventana temporal -36h/+5m",
);
assert.match(sql, /v_session\.created_at < v_readiness\.workout_started_at - interval '5 minutes'[\s\S]+v_session\.created_at > v_readiness\.workout_started_at \+ interval '36 hours'/i, "link valida ventana temporal");
assert.match(sql, /v_readiness\.training_session_id = p_training_session_id[\s\S]+already_linked := true/i, "link idempotente");

const initialLookupIndex = saveFunctionBody.indexOf("from public.training_workout_readiness as readiness");
const temporalValidationIndex = saveFunctionBody.indexOf("p_workout_started_at > now() + interval '5 minutes'");
const cycleValidationIndex = saveFunctionBody.indexOf("from public.training_cycles as cycle");
const cycleDayValidationIndex = saveFunctionBody.indexOf("from public.training_cycle_days as day");
assert.ok(initialLookupIndex >= 0, "save v2 tiene lookup inicial por identidad");
assert.ok(temporalValidationIndex > initialLookupIndex, "lookup ocurre antes de validacion temporal");
assert.ok(cycleValidationIndex > initialLookupIndex, "lookup ocurre antes de validar ciclo");
assert.ok(cycleDayValidationIndex > initialLookupIndex, "lookup ocurre antes de validar dia");
assert.match(
  saveFunctionBody,
  /if v_id is not null then[\s\S]+user_id := v_persisted_user_id[\s\S]+cycle_id := v_persisted_cycle_id[\s\S]+payload := v_payload[\s\S]+return next;/i,
  "retry existente devuelve valores persistidos antes de validaciones mutables",
);
assert.match(
  saveFunctionBody,
  /returning[\s\S]+readiness\.user_id[\s\S]+readiness\.workout_attempt_id[\s\S]+readiness\.cycle_id[\s\S]+readiness\.cycle_day_id[\s\S]+readiness\.workout_started_at[\s\S]+readiness\.local_date/i,
  "insert retorna valores persistidos reales",
);

assert.match(sql, /revoke all on function public\.save_training_workout_readiness_v2\(uuid, uuid, uuid, timestamptz, jsonb\) from service_role/i, "save v2 revoca service_role");
assert.match(sql, /revoke all on function public\.link_training_workout_readiness_session_v2\(uuid, uuid\) from service_role/i, "link v2 revoca service_role");
assert.doesNotMatch(sql, /grant execute on function public\.(save_training_workout_readiness_v2|link_training_workout_readiness_session_v2)[^\n]+service_role/i, "sin grant explicito a service_role");

assert.doesNotMatch(executableSql, /insert\s+into\s+public\.training_sessions/i, "sin inserts a training_sessions");
assert.doesNotMatch(executableSql, /update\s+public\.training_sessions/i, "sin updates a training_sessions");
assert.doesNotMatch(executableSql, /insert\s+into\s+public\.exercise_entries/i, "sin inserts a exercise_entries");
assert.doesNotMatch(executableSql, /update\s+public\.exercise_entries/i, "sin updates a exercise_entries");
assert.doesNotMatch(executableSql, /insert\s+into\s+public\.training_daily_readiness|update\s+public\.training_daily_readiness|alter\s+table\s+public\.training_daily_readiness/i, "sin modificaciones a readiness legacy");
assert.doesNotMatch(executableSql, /backfill|dual-write|dual write/i, "sin backfill ni dual-write ejecutable");
assert.doesNotMatch(executableSql, /drop\s+[^;]*cascade/i, "sin DROP con cascade");
assert.doesNotMatch(executableSql, /delete\s+from|truncate\s+table/i, "sin borrados fisicos");

console.log("training-workout-readiness migration tests passed");
