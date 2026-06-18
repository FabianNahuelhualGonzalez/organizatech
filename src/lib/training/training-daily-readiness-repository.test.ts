import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  getCalendarDateInTimeZone,
  normalizeDailyReadinessPayload,
  normalizeDailyReadinessScope,
  shouldShowDailyReadinessForm,
  type TrainingDailyReadinessPayload,
  type TrainingDailyReadinessRecord,
  type TrainingDailyReadinessScope,
} from "./training-daily-readiness-repository";

const baseMigration = readFileSync("supabase/migrations/20260608_training_daily_readiness.sql", "utf8");
const ambiguityPatch = readFileSync(
  "supabase/migrations/20260609_fix_training_daily_readiness_rpc_ambiguity.sql",
  "utf8",
);
const perCycleDayMigration = readFileSync(
  "supabase/migrations/20260611_training_readiness_per_cycle_day.sql",
  "utf8",
);
const repositorySource = readFileSync("src/lib/training/training-daily-readiness-repository.ts", "utf8");
const perCycleDayReturnsTable = perCycleDayMigration.match(/returns table \([\s\S]*?\)\s*language plpgsql/i)?.[0] ?? "";

assert.equal(
  createHash("sha256").update(baseMigration).digest("hex").toUpperCase(),
  "4ED49989C178DAF75F26671C108BCF05E6620A82B4EFC64481307D7DA78DC680",
  "la migracion original de readiness diaria no debe cambiar",
);
assert.match(
  ambiguityPatch,
  /create or replace function public\.save_daily_training_readiness\(\s*p_payload jsonb\s*\)/i,
  "el patch conserva la firma publica solo con p_payload jsonb",
);
assert.match(
  ambiguityPatch,
  /returns table \(\s*id uuid,\s*local_date date,\s*payload jsonb,\s*created_at timestamptz,\s*updated_at timestamptz\s*\)/i,
  "el patch conserva el retorno de la RPC",
);
assert.match(ambiguityPatch, /security definer/i, "el patch conserva SECURITY DEFINER");
assert.match(ambiguityPatch, /set search_path = public, pg_temp/i, "el patch fija search_path");
assert.match(ambiguityPatch, /America\/Santiago/i, "la fecha local sigue calculandose server-side en Santiago");
assert.match(ambiguityPatch, /auth\.uid\(\)/i, "el user_id se deriva de auth.uid()");
assert.match(
  ambiguityPatch,
  /on conflict on constraint training_daily_readiness_user_local_date_key\s+do nothing/i,
  "el patch evita ambiguedad usando el constraint nominal",
);
assert.doesNotMatch(ambiguityPatch, /do update/i, "la respuesta diaria sigue siendo inmutable");
assert.doesNotMatch(ambiguityPatch, /\bp_user_id\b|\bp_local_date\b/i, "la RPC no acepta user_id ni local_date externos");
assert.doesNotMatch(
  ambiguityPatch,
  /training_sessions|exercise_entries|training_cycles/i,
  "el patch no toca tablas de sesiones, entries ni ciclos",
);
assert.match(
  ambiguityPatch,
  /select\s+readiness\.id,\s*readiness\.payload,\s*readiness\.created_at,\s*readiness\.updated_at\s+into/i,
  "el SELECT de la fila persistida califica columnas con alias de tabla",
);
assert.match(
  ambiguityPatch,
  /where readiness\.user_id = v_user_id\s+and readiness\.local_date = v_local_date/i,
  "la busqueda idempotente usa variables locales inequivocas",
);
assert.match(
  repositorySource,
  /supabase\.rpc\("save_daily_training_readiness",\s*\{\s*p_payload: rpcPayload,\s*\}\)/,
  "el repositorio mantiene la firma publica con un unico p_payload",
);
assert.match(perCycleDayMigration, /add column if not exists cycle_day_id uuid null/i, "la migracion agrega cycle_day_id nullable");
assert.match(perCycleDayMigration, /drop constraint if exists training_daily_readiness_user_local_date_key/i, "la migracion elimina la unicidad diaria global");
assert.match(
  perCycleDayMigration,
  /create unique index if not exists training_daily_readiness_user_local_date_cycle_day_key[\s\S]+where cycle_day_id is not null/i,
  "la migracion crea unique parcial scoped",
);
assert.match(
  perCycleDayMigration,
  /create unique index if not exists training_daily_readiness_user_local_date_legacy_key[\s\S]+where cycle_day_id is null/i,
  "la migracion conserva unique parcial legacy",
);
assert.match(
  perCycleDayMigration,
  /foreign key \(user_id, cycle_day_id\)[\s\S]+references public\.training_cycle_days\(user_id, id\)[\s\S]+on delete restrict/i,
  "la migracion agrega FK compuesta segura hacia training_cycle_days",
);
assert.match(
  perCycleDayMigration,
  /create or replace function public\.save_daily_training_readiness\(\s*p_payload jsonb\s*\)/i,
  "la RPC mantiene una unica firma p_payload jsonb",
);
assert.match(
  perCycleDayReturnsTable,
  /returns table \(\s*id uuid,\s*local_date date,\s*payload jsonb,\s*created_at timestamptz,\s*updated_at timestamptz\s*\)/i,
  "la RPC preserva el tipo de retorno historico",
);
assert.equal(
  (perCycleDayMigration.match(/create or replace function public\.save_daily_training_readiness/gi) ?? []).length,
  1,
  "signature_count esperado = 1",
);
assert.doesNotMatch(perCycleDayMigration, /save_daily_training_readiness\(\s*p_payload jsonb\s*,/i, "no crea overload con parametros adicionales");
assert.doesNotMatch(perCycleDayMigration, /drop function/i, "la migracion no elimina temporalmente la RPC");
assert.doesNotMatch(
  perCycleDayReturnsTable,
  /cycle_day_id uuid/i,
  "cycle_day_id no forma parte del contrato de retorno",
);
assert.match(
  perCycleDayMigration,
  /v_response_payload := p_payload - 'cycle_day_id'/i,
  "cycle_day_id se elimina del JSON canonico de respuesta",
);
assert.match(
  perCycleDayMigration,
  /where day\.id = v_cycle_day_id\s+and day\.user_id = v_user_id\s+and day\.deleted_at is null/i,
  "la RPC valida ownership del cycle_day_id",
);
assert.match(
  perCycleDayMigration,
  /on conflict \(user_id, local_date, cycle_day_id\)\s+where cycle_day_id is not null\s+do nothing/i,
  "la RPC usa conflict target scoped exacto",
);
assert.match(
  perCycleDayMigration,
  /on conflict \(user_id, local_date\)\s+where cycle_day_id is null\s+do nothing/i,
  "la RPC usa conflict target legacy exacto",
);
assert.doesNotMatch(perCycleDayMigration, /on conflict on constraint training_daily_readiness_user_local_date_key/i, "la RPC nueva no usa el constraint global reemplazado");
assert.doesNotMatch(perCycleDayMigration, /do update/i, "readiness sigue siendo inmutable");
assert.doesNotMatch(perCycleDayMigration, /delete from|drop table/i, "la migracion no borra datos");

assert.equal(
  getCalendarDateInTimeZone(new Date("2026-06-16T02:30:00.000Z"), "America/Santiago"),
  "2026-06-15",
  "UTC puede estar en el dia siguiente mientras Santiago sigue en el dia anterior",
);
assert.equal(
  getCalendarDateInTimeZone(new Date("2026-06-16T03:59:00.000Z"), "America/Santiago"),
  "2026-06-15",
  "antes de medianoche local conserva el dia local",
);
assert.equal(
  getCalendarDateInTimeZone(new Date("2026-06-16T04:01:00.000Z"), "America/Santiago"),
  "2026-06-16",
  "despues de medianoche local avanza el dia local",
);
assert.equal(
  getCalendarDateInTimeZone(new Date("2026-01-15T03:30:00.000Z"), "America/Santiago"),
  "2026-01-15",
  "calcula fechas deterministicas durante horario de verano",
);

const fullPayload = normalizeDailyReadinessPayload({
  motivation: 5,
  hydration: 6,
  sleep: 4,
  energy: 7,
  skipped: false,
});
assert.deepEqual(
  fullPayload,
  { motivation: 5, hydration: 6, sleep: 4, energy: 7, skipped: false },
  "normaliza el payload completo actual",
);
assert.deepEqual(
  normalizeDailyReadinessPayload({ skipped: true }),
  { skipped: true },
  "representa omision diaria sin puntajes obligatorios",
);
assert.throws(
  () => normalizeDailyReadinessPayload({ motivation: 8, hydration: 6, sleep: 4, energy: 7, skipped: false }),
  /motivacion/,
  "rechaza puntajes fuera de rango",
);

const rpcArguments = ["p_payload"];
assert.deepEqual(rpcArguments, ["p_payload"], "user_id no forma parte de la firma de la RPC");
assert.equal(rpcArguments.some((argument) => argument.includes("local")), false, "local_date no forma parte de la firma de la RPC");
assert.deepEqual(normalizeDailyReadinessScope({ mode: "legacy" }), { mode: "legacy" }, "legacy se declara explicitamente");
assert.deepEqual(
  normalizeDailyReadinessScope({ mode: "cycle-scoped", cycleDayId: "day-1" }),
  { mode: "cycle-scoped", cycleDayId: "day-1" },
  "scoped conserva cycleDayId",
);
assert.throws(
  () => normalizeDailyReadinessScope({ mode: "cycle-scoped", cycleDayId: "" }),
  /dia del ciclo/,
  "modo scoped sin cycleDayId falla cerrado",
);

const store = createInMemoryDailyReadinessStore();
const legacyScope = { mode: "legacy" } satisfies TrainingDailyReadinessScope;
const dayOneScope = { mode: "cycle-scoped", cycleDayId: "day-1" } satisfies TrainingDailyReadinessScope;
const dayTwoScope = { mode: "cycle-scoped", cycleDayId: "day-2" } satisfies TrainingDailyReadinessScope;
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16", dayOneScope)), true, "primera apertura scoped muestra formulario");
const saved = store.save("user-a", "2026-06-16", dayOneScope, fullPayload);
assert.equal(shouldShowDailyReadinessForm(saved), false, "guardado exitoso crea una fila y omite formulario");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16", dayOneScope)), false, "reapertura del mismo cycleDayId no repite formulario");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16", dayOneScope)), false, "salir y volver omite formulario");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16", dayTwoScope)), true, "otro cycleDayId el mismo dia muestra formulario");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-17", dayOneScope)), true, "mismo cycleDayId en otra fecha muestra formulario");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16", legacyScope)), true, "scoped no reutiliza readiness legacy ni viceversa");
assert.deepEqual(store.get("user-a", "2026-06-16", dayOneScope)?.payload, fullPayload, "payload scoped se conserva tras recarga");
const legacySaved = store.save("user-a", "2026-06-16", legacyScope, fullPayload);
assert.deepEqual(legacySaved.payload, fullPayload, "historico/legacy NULL sigue legible sin depender del retorno cycle_day_id");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16", legacyScope)), false, "legacy NULL mantiene una readiness diaria");

const payloadB = normalizeDailyReadinessPayload({ motivation: 4, hydration: 4, sleep: 4, energy: 4, skipped: false });
const doubleTapRows = [
  store.save("user-a", "2026-06-16", dayOneScope, fullPayload),
  store.save("user-a", "2026-06-16", dayOneScope, payloadB),
];
assert.equal(new Set(doubleTapRows.map((row) => row.id)).size, 1, "doble toque reutiliza la fila diaria");
assert.deepEqual(doubleTapRows[1].payload, fullPayload, "segunda llamada devuelve la primera respuesta persistida");
assert.notDeepEqual(doubleTapRows[1].payload, payloadB, "segundo payload no reemplaza al primero");
assert.equal(doubleTapRows[1].updatedAt, saved.updatedAt, "updated_at no cambia por reintento idempotente");
assert.equal(store.countRows("user-a", "2026-06-16", dayOneScope), 1, "dos solicitudes concurrentes crean una sola fila logica");
assert.notEqual(
  store.save("user-b", "2026-06-16", dayOneScope, fullPayload).id,
  saved.id,
  "dos usuarios pueden responder la misma fecha con filas aisladas",
);
assert.equal(store.get("user-a", "2026-06-16", dayOneScope)?.id, saved.id, "usuario A lee solo su fila");
assert.equal(store.get("user-b", "2026-06-16", dayOneScope)?.id.startsWith("user-b:"), true, "usuario B no sobrescribe datos de A");
assert.throws(
  () => store.save("user-a", "2026-06-16", { mode: "cycle-scoped", cycleDayId: "other-user-day" }, fullPayload),
  /otro usuario/,
  "cycleDayId de otro usuario es rechazado",
);

let trainingSessionsWrites = 0;
let exerciseEntriesWrites = 0;
let trainingCyclesWrites = 0;
const failed = simulateSaveFailure(() => {
  throw new Error("network");
});
assert.equal(failed.canOpenTraining, false, "guardado fallido no abre entrenamiento");
assert.equal(failed.keepFormVisible, true, "guardado fallido mantiene el formulario");
const retry = simulateSaveFailure(() => store.save("user-c", "2026-06-16", dayOneScope, fullPayload));
assert.equal(retry.canOpenTraining, true, "reintento exitoso permite continuar");
assert.equal(shouldShowDailyReadinessForm(store.get("user-c", "2026-06-16", dayOneScope)), false, "consulta no depende de training_session_id");
assert.equal(trainingSessionsWrites, 0, "no se escriben training_sessions");
assert.equal(exerciseEntriesWrites, 0, "no se escriben exercise_entries");
assert.equal(trainingCyclesWrites, 0, "no se escriben training_cycles");
assert.equal(
  getCalendarDateInTimeZone(new Date("2026-06-16T14:00:00.000Z"), "America/Santiago"),
  "2026-06-16",
  "la fecha usada al leer coincide con la usada al guardar",
);
assert.deepEqual(
  { trainingSessionsWrites, exerciseEntriesWrites, trainingCyclesWrites },
  { trainingSessionsWrites: 0, exerciseEntriesWrites: 0, trainingCyclesWrites: 0 },
  "recuperacion de entrenamiento permanece intacta",
);
assert.equal(
  getCalendarDateInTimeZone(new Date("2026-06-17T02:30:00.000Z"), "America/Santiago"),
  "2026-06-16",
  "UTC ya es miercoles mientras Santiago aun es martes",
);

console.log("Pruebas de readiness diario OK");

const latestExercisePerformancePattern = new RegExp([
  "getLatest" + "ExercisePerformances",
  "\\u00daltima vez",
  "Ultima" + " vez",
].join("|"), "i");
const exerciseLineageTablePattern = new RegExp("training_" + "exercise_lineages", "i");
assert.doesNotMatch(repositorySource, latestExercisePerformancePattern, "UI historica no aparece");
assert.doesNotMatch(repositorySource, exerciseLineageTablePattern, "exercise lineage no cambia en repository readiness");

function createInMemoryDailyReadinessStore() {
  const rows = new Map<string, TrainingDailyReadinessRecord>();
  const allowedCycleDays = new Set(["day-1", "day-2"]);
  return {
    get(userId: string, localDate: string, scope: TrainingDailyReadinessScope) {
      return rows.get(createReadinessKey(userId, localDate, scope)) ?? null;
    },
    save(userId: string, serverLocalDate: string, scope: TrainingDailyReadinessScope, payload: TrainingDailyReadinessPayload) {
      const localDate = serverLocalDate;
      const normalizedScope = normalizeDailyReadinessScope(scope);
      if (normalizedScope.mode === "cycle-scoped" && !allowedCycleDays.has(normalizedScope.cycleDayId)) {
        throw new Error("cycleDayId de otro usuario");
      }
      const key = createReadinessKey(userId, localDate, normalizedScope);
      const current = rows.get(key);
      if (current) return current;
      const now = `${localDate}T12:00:00.000Z`;
      const row: TrainingDailyReadinessRecord = {
        id: key,
        localDate,
        payload: normalizeDailyReadinessPayload(payload),
        createdAt: now,
        updatedAt: now,
      };
      rows.set(key, row);
      return row;
    },
    countRows(userId: string, localDate: string, scope: TrainingDailyReadinessScope) {
      return rows.has(createReadinessKey(userId, localDate, scope)) ? 1 : 0;
    },
  };
}

function createReadinessKey(userId: string, localDate: string, scope: TrainingDailyReadinessScope) {
  const normalizedScope = normalizeDailyReadinessScope(scope);
  const cycleDayKey = normalizedScope.mode === "cycle-scoped" ? normalizedScope.cycleDayId : "legacy";
  return `${userId}:${localDate}:${cycleDayKey}`;
}

function simulateSaveFailure(save: () => TrainingDailyReadinessRecord) {
  try {
    save();
    return { canOpenTraining: true, keepFormVisible: false };
  } catch {
    return { canOpenTraining: false, keepFormVisible: true };
  }
}
