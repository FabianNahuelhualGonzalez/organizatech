import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260620000001_training_workout_readiness.sql", "utf8");
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

const hardeningMigrationNames = readdirSync("supabase/migrations").filter((name) =>
  /_sec_readiness_01_bound_workout_readiness_writes\.sql$/i.test(name),
);
assert.equal(hardeningMigrationNames.length, 1, "existe una unica migracion forward-only SEC-READINESS-01");
const hardeningMigrationPath = `supabase/migrations/${hardeningMigrationNames[0]}`;
const hardeningMigrationBytes = readFileSync(hardeningMigrationPath);
const hardeningMigration = normalizeLineEndings(hardeningMigrationBytes.toString("utf8"));

function compactSql(value: string): string {
  return stripSqlComments(normalizeLineEndings(value)).replace(/\s+/g, " ").trim().toLowerCase();
}

function extractFunctionDefinition(value: string, functionName: string): string {
  const executable = stripSqlComments(normalizeLineEndings(value));
  const header = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`,
    "i",
  ).exec(executable);
  assert.ok(header, `extrae cabecera de ${functionName}`);
  const tail = executable.slice(header.index);
  const openingTag = /\bas\s+(\$(?:[a-z_][a-z_0-9]*)?\$)/i.exec(tail);
  assert.ok(openingTag, `extrae dollar tag de ${functionName}`);
  const bodyStart = openingTag.index + openingTag[0].length;
  const closingTag = tail.indexOf(openingTag[1], bodyStart);
  assert.ok(closingTag >= 0, `encuentra cierre de ${functionName}`);
  return tail.slice(0, closingTag + openingTag[1].length);
}

function occurrenceIndexes(value: string, pattern: RegExp): number[] {
  assert.ok(pattern.global, "occurrenceIndexes requiere regex global");
  return Array.from(value.matchAll(pattern), (match) => match.index);
}

function assertCount(value: string, pattern: RegExp, expected: number, message: string): void {
  assert.equal((value.match(pattern) ?? []).length, expected, message);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertHardeningContract(source: string): void {
  const compact = compactSql(source);
  const save = compactSql(extractFunctionDefinition(source, "save_training_workout_readiness_v2"));
  const insertGuard = compactSql(extractFunctionDefinition(source, "enforce_training_workout_readiness_payload_insert"));
  const actorMatch = /([a-z_][a-z_0-9]*) uuid := auth\.uid\(\)/i.exec(save);
  assert.ok(actorMatch, "save deriva actor exclusivamente desde auth.uid()");
  const actor = actorMatch[1];

  assert.match(
    save,
    /^create or replace function public\.save_training_workout_readiness_v2\( p_workout_attempt_id uuid, p_cycle_id uuid, p_cycle_day_id uuid, p_workout_started_at timestamptz, p_payload jsonb \) returns table \( id uuid, user_id uuid, workout_attempt_id uuid, cycle_id uuid, cycle_day_id uuid, workout_started_at timestamptz, local_date date, payload jsonb, training_session_id uuid, created_at timestamptz, updated_at timestamptz, context_mismatch boolean \) language plpgsql security definer set search_path = '' as /i,
    "save conserva firma/respuesta y usa SECURITY DEFINER con search_path vacio",
  );
  assert.doesNotMatch(save, /\bexecute\b/i, "save no usa SQL dinamico");
  assert.doesNotMatch(save, /\bp_user_id\b/i, "save no acepta ownership cliente");

  assert.match(save, /pg_catalog\.octet_length\(p_payload::pg_catalog\.text\) > 1024/i, "RPC limita JSON serializado a 1024 bytes");
  assert.match(save, /p_payload <> pg_catalog\.jsonb_build_object\('skipped', true\)/i, "RPC exige skipped=true exacto");
  assert.match(
    save,
    /p_payload <> pg_catalog\.jsonb_build_object\( 'skipped', false, 'motivation', p_payload->'motivation', 'hydration', p_payload->'hydration', 'sleep', p_payload->'sleep', 'energy', p_payload->'energy' \)/i,
    "RPC exige exactamente las cinco claves del payload completo",
  );
  for (const score of ["motivation", "hydration", "sleep", "energy"]) {
    assert.match(save, new RegExp(`jsonb_typeof\\(p_payload->'${score}'\\) is distinct from 'number'`, "i"), `RPC valida tipo de ${score}`);
    assert.match(save, new RegExp(`trunc\\(\\(p_payload->>'${score}'\\)::pg_catalog\\.numeric\\)`, "i"), `RPC rechaza fracciones en ${score}`);
  }
  assertCount(save, /not between 1 and 7/gi, 4, "RPC conserva rango 1..7 para las cuatro notas");
  assert.match(
    save,
    /else raise exception using errcode = '22023', message = 'payload de readiness invalido'; end if; v_local_date :=/i,
    "RPC conserva rechazo terminal para skipped ausente, null o no booleano",
  );

  assert.match(insertGuard, /returns trigger language plpgsql security invoker set search_path = ''/i, "guard estructural es trigger invoker con search_path vacio");
  assert.match(insertGuard, /pg_catalog\.octet_length\(new\.payload::pg_catalog\.text\) > 1024/i, "guard estructural limita 1024 bytes");
  assert.match(insertGuard, /new\.payload <> pg_catalog\.jsonb_build_object\('skipped', true\)/i, "guard estructural exige skipped exacto");
  assert.match(
    insertGuard,
    /new\.payload <> pg_catalog\.jsonb_build_object\( 'skipped', false, 'motivation', new\.payload->'motivation', 'hydration', new\.payload->'hydration', 'sleep', new\.payload->'sleep', 'energy', new\.payload->'energy' \)/i,
    "guard estructural exige exactamente las cinco claves completas",
  );
  assertCount(insertGuard, /not between 1 and 7/gi, 4, "guard estructural conserva rango 1..7");
  assert.match(
    insertGuard,
    /else raise exception using errcode = '22023', message = 'payload de readiness invalido'; end if; return new;/i,
    "guard estructural conserva rechazo terminal para skipped ausente, null o no booleano",
  );
  assert.match(insertGuard, /return new;/i, "guard devuelve la fila validada");
  assert.match(
    compact,
    /create trigger training_workout_readiness_payload_insert_guard before insert on public\.training_workout_readiness for each row execute function public\.enforce_training_workout_readiness_payload_insert\(\)/i,
    "defensa estructural se ejecuta en cada INSERT y no bloquea UPDATE historico del link",
  );

  const triggerFunction = "public.enforce_training_workout_readiness_payload_insert()";
  const triggerOwnerStatement = `alter function ${triggerFunction} owner to postgres`;
  const triggerOwnerIndex = compact.indexOf(triggerOwnerStatement);
  const triggerCreateIndex = compact.indexOf("create trigger training_workout_readiness_payload_insert_guard");
  assert.ok(triggerOwnerIndex >= 0, "guard estructural tiene owner postgres explícito");
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    const revoke = `revoke all on function ${triggerFunction} from ${role}`;
    assertCount(compact, new RegExp(`${escapeRegExp(revoke)};`, "gi"), 1, `guard estructural revoca exactamente una vez a ${role}`);
    const revokeIndex = compact.indexOf(revoke);
    assert.ok(
      triggerOwnerIndex < revokeIndex && revokeIndex < triggerCreateIndex,
      `guard estructural fija owner y revoca ${role} antes de crear el trigger`,
    );
  }
  assert.equal(
    (compact.match(new RegExp(`grant\\s+[^;]+\\s+on function ${escapeRegExp(triggerFunction)}\\s+to\\s+[^;]+;`, "gi")) ?? []).length,
    0,
    "guard estructural no concede EXECUTE directo a ningún rol",
  );

  const payloadBoundaryIndex = save.indexOf("pg_catalog.octet_length(p_payload::pg_catalog.text) > 1024");
  const lockIndex = save.indexOf("pg_catalog.pg_advisory_xact_lock");
  const countIndex = save.indexOf("select pg_catalog.count(*)");
  const quotaIndex = save.search(/if [a-z_][a-z_0-9]* >= 32 then/i);
  const insertIndex = save.indexOf("insert into public.training_workout_readiness");
  const lookups = occurrenceIndexes(save, /workout_attempt_id\s*=\s*p_workout_attempt_id/gi);
  assert.equal(lookups.length, 3, "save mantiene lookup inicial, recheck bajo lock y fallback de despliegue");
  assert.ok(payloadBoundaryIndex >= 0 && payloadBoundaryIndex < lookups[0], "payload se rechaza antes del fast retry");
  assert.ok(lookups[0] < lockIndex, "fast retry ocurre antes del lock");
  assert.ok(lockIndex < lookups[1], "recheck idempotente ocurre despues del lock");
  assert.ok(lookups[1] < countIndex, "recheck idempotente ocurre antes de contar cuota");
  assert.ok(lockIndex < countIndex && countIndex < quotaIndex && quotaIndex < insertIndex, "lock, count, limite e insert mantienen orden atomico");
  const postLockLookupStart = save.lastIndexOf("return query", lookups[1]);
  const postLockValidationIndex = save.indexOf("if p_workout_started_at", lookups[1]);
  assert.ok(
    postLockLookupStart > lockIndex && postLockValidationIndex > lookups[1],
    "aísla recheck post-lock antes de validaciones e inserción",
  );
  const postLockRecheck = save.slice(postLockLookupStart, postLockValidationIndex).trim();
  assertCount(postLockRecheck, /return query/gi, 1, "recheck post-lock emite una sola respuesta persistida");
  assert.match(
    postLockRecheck,
    new RegExp(
      `where ([a-z_][a-z_0-9]*)\\.user_id = ${actor} and \\1\\.workout_attempt_id = p_workout_attempt_id;`,
      "i",
    ),
    "recheck post-lock consulta una única identidad autoritativa de intento",
  );
  assert.match(
    postLockRecheck,
    /if found then return; end if;$/i,
    "recheck post-lock termina la función al encontrar el intento persistido",
  );
  assert.doesNotMatch(
    postLockRecheck,
    /\b(?:insert into|select pg_catalog\.count|on conflict)\b/i,
    "recheck post-lock no cuenta cuota ni intenta escribir antes de retornar",
  );
  assert.match(
    save.slice(lockIndex, lookups[1]),
    new RegExp(`hashtextextended\\([^)]*${actor}::pg_catalog\\.text`, "i"),
    "lock transaccional deriva su clave del auth.uid() autoritativo",
  );
  assert.doesNotMatch(save.slice(lockIndex, lookups[1]), /p_workout_attempt_id/i, "lock no se fragmenta por UUID de intento");
  assert.match(save, /created_at >= [a-z_][a-z_0-9]* - interval '36 hours'/i, "cuota usa created_at server-side en 36 horas");
  assert.match(save.slice(countIndex, quotaIndex), /limit 32/i, "conteo de cuota corta al alcanzar 32 filas");
  assert.doesNotMatch(save.slice(countIndex, quotaIndex), /workout_started_at/i, "cuota no confia en timestamp cliente");
  assert.match(save.slice(countIndex, quotaIndex), new RegExp(`where [a-z_][a-z_0-9]*\\.user_id = ${actor}`), "cuota queda aislada por usuario");
  assert.match(save, /if [a-z_][a-z_0-9]* >= 32 then/i, "attempt 33 se rechaza y el 32 se permite");
  assert.match(save, /on conflict on constraint training_workout_readiness_user_attempt_key do nothing/i, "retry conserva ON CONFLICT idempotente");
  assert.doesNotMatch(save, /\bdo update\b/i, "retry nunca sobrescribe payload persistido");

  const cycleBlock = save.slice(save.indexOf("from public.training_cycles"), save.indexOf("from public.training_cycle_days"));
  const dayBlock = save.slice(save.indexOf("from public.training_cycle_days"), countIndex);
  assert.match(cycleBlock, new RegExp(`user_id = ${actor}`, "i"), "ciclo valida ownership");
  assert.match(cycleBlock, /status = 'active'/i, "ciclo debe estar activo");
  assert.match(cycleBlock, /deleted_at is null/i, "ciclo no puede estar eliminado");
  assert.match(cycleBlock, /for share/i, "ciclo queda estable hasta insertar");
  assert.match(dayBlock, /cycle_id = p_cycle_id/i, "dia pertenece al ciclo");
  assert.match(dayBlock, new RegExp(`user_id = ${actor}`, "i"), "dia pertenece al actor");
  assert.match(dayBlock, /deleted_at is null/i, "dia no puede estar eliminado");
  assert.match(dayBlock, /for share/i, "dia queda estable hasta insertar");
  assert.match(save, /p_workout_started_at > [a-z_][a-z_0-9]* \+ interval '5 minutes' or p_workout_started_at < [a-z_][a-z_0-9]* - interval '36 hours'/i, "conserva ventana -36h/+5m");
  assertCount(save, /pg_catalog\.now\(\)/gi, 1, "usa una unica referencia temporal server-side");

  assert.match(compact, /alter table public\.training_workout_readiness owner to postgres/i, "owner de tabla explicito");
  assert.match(compact, /alter table public\.training_workout_readiness enable row level security/i, "RLS permanece habilitado");
  const tableGrant = "grant select on table public.training_workout_readiness to authenticated";
  const tableGrantIndex = compact.indexOf(tableGrant);
  assert.ok(tableGrantIndex >= 0, "authenticated conserva solo SELECT directo");
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    const revoke = `revoke all on table public.training_workout_readiness from ${role}`;
    assertCount(compact, new RegExp(`${escapeRegExp(revoke)};`, "gi"), 1, `tabla revoca exactamente una vez a ${role}`);
    assert.ok(compact.indexOf(revoke) < tableGrantIndex, `tabla aplica REVOKE ${role} antes del GRANT SELECT`);
  }
  assert.deepEqual(
    compact.match(/grant [^;]+ on table public\.training_workout_readiness to [^;]+;/gi) ?? [],
    [`${tableGrant};`],
    "tabla concede exactamente SELECT a authenticated y ningún otro grant",
  );
  assert.doesNotMatch(compact, /grant (?:insert|update|delete|all)[^;]*training_workout_readiness/i, "sin writes directos de tabla");

  const rpcSignatures = [
    "save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb)",
    "link_training_workout_readiness_session_v2(uuid, uuid)",
  ];
  const expectedRpcGrants: string[] = [];
  for (const rpc of rpcSignatures) {
    const rpcPattern = escapeRegExp(rpc);
    assert.match(compact, new RegExp(`alter function public\\.${rpcPattern} owner to postgres`, "i"), `${rpc}: owner explicito`);
    assert.match(compact, new RegExp(`alter function public\\.${rpcPattern} set search_path = ''`, "i"), `${rpc}: search_path vacio`);
    assert.match(compact, new RegExp(`alter function public\\.${rpcPattern} security definer`, "i"), `${rpc}: SECURITY DEFINER`);
    const grant = `grant execute on function public.${rpc} to authenticated`;
    const grantIndex = compact.indexOf(grant);
    assertCount(compact, new RegExp(`${escapeRegExp(grant)};`, "gi"), 1, `${rpc}: concede EXECUTE exactamente una vez`);
    for (const role of ["public", "anon", "authenticated", "service_role"]) {
      const revoke = `revoke all on function public.${rpc} from ${role}`;
      assertCount(compact, new RegExp(`${escapeRegExp(revoke)};`, "gi"), 1, `${rpc}: revoca exactamente una vez a ${role}`);
      assert.ok(compact.indexOf(revoke) < grantIndex, `${rpc}: aplica REVOKE ${role} antes del GRANT EXECUTE`);
    }
    expectedRpcGrants.push(`${grant};`);
  }
  const rpcGrants = compact.match(
    /grant [^;]+ on function public\.(?:save_training_workout_readiness_v2\(uuid, uuid, uuid, timestamptz, jsonb\)|link_training_workout_readiness_session_v2\(uuid, uuid\)) to [^;]+;/gi,
  ) ?? [];
  assert.deepEqual(rpcGrants.sort(), expectedRpcGrants.sort(), "RPCs conceden EXECUTE exactamente a authenticated");
  assert.doesNotMatch(compact, /\b(?:insert into|update|delete from|alter table) public\.(?:training_sessions|exercise_entries|training_daily_readiness)\b/i, "no toca tablas prohibidas ni legacy");
}

function replaceNth(source: string, search: string, replacement: string, ordinal: number): string {
  let from = 0;
  let found = -1;
  for (let index = 0; index <= ordinal; index += 1) {
    found = source.indexOf(search, from);
    assert.ok(found >= 0, `mutation fixture contiene ocurrencia ${ordinal + 1}: ${search}`);
    from = found + search.length;
  }
  return source.slice(0, found) + replacement + source.slice(found + search.length);
}

function assertMutationRejected(
  name: string,
  mutate: (source: string) => string,
  expectedFailure?: RegExp,
): void {
  const mutated = mutate(hardeningMigration);
  assert.notEqual(mutated, hardeningMigration, `mutante cambia bytes: ${name}`);
  assert.notEqual(
    createHash("sha256").update(mutated).digest("hex"),
    createHash("sha256").update(hardeningMigration).digest("hex"),
    `mutante cambia SHA-256: ${name}`,
  );
  if (expectedFailure) {
    assert.throws(() => assertHardeningContract(mutated), expectedFailure, `mutation rechazada por barrera focal: ${name}`);
  } else {
    assert.throws(() => assertHardeningContract(mutated), `mutation rechazada: ${name}`);
  }
  assert.deepEqual(readFileSync(hardeningMigrationPath), hardeningMigrationBytes, `mutante no altera archivo canónico: ${name}`);
}

assertHardeningContract(hardeningMigration);

assertMutationRejected("cap RPC ampliado", (source) => source.replace(
  "pg_catalog.octet_length(p_payload::pg_catalog.text) > 1024",
  "pg_catalog.octet_length(p_payload::pg_catalog.text) > 1025",
));
assertMutationRejected("cap estructural eliminado", (source) => source.replace(
  "pg_catalog.octet_length(new.payload::pg_catalog.text) > 1024",
  "false",
));
assertMutationRejected("allowlist completa omite energy", (source) => source.replace(
  "        'sleep', p_payload->'sleep',\n        'energy', p_payload->'energy'\n",
  "        'sleep', p_payload->'sleep'\n",
));
const terminalPayloadRejection = `  else
    raise exception using
      errcode = '22023',
      message = 'Payload de readiness invalido';
  end if;
`;
const neutralizedTerminalPayloadRejection = `  else
    null;
  end if;
`;
assertMutationRejected("else terminal estructural neutralizado", (source) => replaceNth(
  source,
  terminalPayloadRejection,
  neutralizedTerminalPayloadRejection,
  0,
), /guard estructural conserva rechazo terminal/);
assertMutationRejected("else terminal RPC neutralizado", (source) => replaceNth(
  source,
  terminalPayloadRejection,
  neutralizedTerminalPayloadRejection,
  1,
), /RPC conserva rechazo terminal/);
assertMutationRejected("rango inferior debilitado", (source) => source.replace("not between 1 and 7", "not between 0 and 7"));
assertMutationRejected("lock de sesion", (source) => source.replace("pg_catalog.pg_advisory_xact_lock", "pg_catalog.pg_advisory_lock"));
assertMutationRejected("lock derivado del attempt", (source) => source.replace(
  "v_user_id::pg_catalog.text",
  "p_workout_attempt_id::pg_catalog.text",
));
assertMutationRejected("recheck post-lock eliminado", (source) => replaceNth(
  source,
  "readiness.workout_attempt_id = p_workout_attempt_id",
  "p_workout_attempt_id is null",
  1,
));
assertMutationRejected("retorno semántico post-lock neutralizado", (source) => replaceNth(
  source,
  "  if found then\n    return;\n  end if;\n",
  "  if found then\n    null;\n  end if;\n",
  1,
), /recheck post-lock termina la función/);
assertMutationRejected("attempt 33 permitido", (source) => source.replace("v_recent_attempt_count >= 32", "v_recent_attempt_count > 32"));
assertMutationRejected("ventana de cuota ampliada", (source) => source.replace(
  "readiness.created_at >= v_now - interval '36 hours'",
  "readiness.created_at >= v_now - interval '37 hours'",
));
assertMutationRejected("cuota usa timestamp cliente", (source) => source.replace(
  "readiness.created_at >= v_now",
  "readiness.workout_started_at >= v_now",
));
assertMutationRejected("conteo vuelve a ser ilimitado", (source) => source.replace("    limit 32\n", ""));
assertMutationRejected("payload movido despues del fast retry", (source) => {
  const blockStart = source.indexOf("  if p_payload is null");
  const blockEnd = source.indexOf("  v_local_date :=", blockStart);
  const retryEnd = "  if found then\n    return;\n  end if;\n";
  if (blockStart < 0 || blockEnd < 0) return source;
  const withoutPayloadBoundary = source.slice(0, blockStart) + source.slice(blockEnd);
  const retryEndIndex = withoutPayloadBoundary.indexOf(retryEnd);
  if (retryEndIndex < 0) return source;
  const payloadBoundary = source.slice(blockStart, blockEnd);
  const insertAt = retryEndIndex + retryEnd.length;
  return withoutPayloadBoundary.slice(0, insertAt) + payloadBoundary + withoutPayloadBoundary.slice(insertAt);
});
assertMutationRejected("conteo movido antes de serializar por usuario", (source) => {
  const quotaCount = `  select pg_catalog.count(*)
  into v_recent_attempt_count
  from (
    select 1
    from public.training_workout_readiness as readiness
    where readiness.user_id = v_user_id
      and readiness.created_at >= v_now - interval '36 hours'
    limit 32
  ) as recent_attempts;
`;
  const lockStart = "  perform pg_catalog.pg_advisory_xact_lock(";
  if (!source.includes(quotaCount) || !source.includes(lockStart)) return source;
  return source.replace(quotaCount, "").replace(lockStart, `${quotaCount}\n${lockStart}`);
});
assertMutationRejected("ciclo inactivo aceptado", (source) => source.replace("and cycle.status = 'active'", "and cycle.status is not null"));
assertMutationRejected("dia ajeno aceptado", (source) => source.replace("and day.cycle_id = p_cycle_id", "and day.cycle_id is not null"));
assertMutationRejected("row lock de ciclo debilitado", (source) => replaceNth(source, "for share;", ";", 0));
assertMutationRejected("trigger deja de proteger inserts", (source) => source.replace(
  "before insert on public.training_workout_readiness",
  "before update on public.training_workout_readiness",
));
assertMutationRejected("search_path expuesto", (source) => source.replace("set search_path = ''", "set search_path = public"));
assertMutationRejected("ACL del trigger conserva EXECUTE PUBLIC", (source) => source.replace(
  "revoke all on function public.enforce_training_workout_readiness_payload_insert() from public;",
  "revoke all on function public.enforce_training_workout_readiness_payload_insert() from postgres;",
), /guard estructural revoca exactamente una vez a public/);
assertMutationRejected("GRANT SELECT de tabla ocurre antes de REVOKE", (source) => {
  const revoke = "revoke all on table public.training_workout_readiness from public;\n";
  const grant = "grant select on table public.training_workout_readiness to authenticated;\n";
  if (!source.includes(revoke) || !source.includes(grant)) return source;
  return source.replace(grant, "").replace(revoke, `${grant}${revoke}`);
}, /tabla aplica REVOKE public antes del GRANT SELECT/);
assertMutationRejected(
  "service_role obtiene execute",
  (source) => source + "\ngrant execute on function public.save_training_workout_readiness_v2(uuid, uuid, uuid, timestamptz, jsonb) to service_role;\n",
  /RPCs conceden EXECUTE exactamente a authenticated/,
);

const innocentHardeningMutation = hardeningMigration
  .replace(/^/, "-- comentario inocente antes de la migracion\n")
  .replaceAll("$function$", "$secure_body$")
  .replaceAll("v_user_id", "v_authenticated_actor")
  .replaceAll("v_recent_attempt_count", "v_window_count")
  .replaceAll("v_now", "v_server_time")
  .replace(/\bas readiness\b/g, "as stored_row")
  .replace(/\breadiness\./g, "stored_row.")
  .replace(/\bas cycle\b/g, "as owned_cycle")
  .replace(/\bcycle\./g, "owned_cycle.")
  .replace(/\bas day\b/g, "as owned_day")
  .replace(/\bday\./g, "owned_day.")
  .replace(/\n/g, "\n  ");
assert.doesNotThrow(() => assertHardeningContract(innocentHardeningMutation), "comentarios, formato, dollar tags, aliases y locales no rompen el contrato");

const hardeningSha256 = createHash("sha256").update(hardeningMigrationBytes).digest("hex");
assert.equal(
  hardeningSha256,
  "bea5294e991d1368200e8b712d0f829b2449a33e414433f0c1568dae435bbb95",
  "SHA-256 exacto de migracion SEC-READINESS-01 permanece inmutable",
);

console.log("training-workout-readiness migration tests passed");
