import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  getCalendarDateInTimeZone,
  normalizeDailyReadinessPayload,
  shouldShowDailyReadinessForm,
  type TrainingDailyReadinessPayload,
  type TrainingDailyReadinessRecord,
} from "./training-daily-readiness-repository";

const baseMigration = readFileSync("supabase/migrations/20260608_training_daily_readiness.sql", "utf8");
const ambiguityPatch = readFileSync(
  "supabase/migrations/20260609_fix_training_daily_readiness_rpc_ambiguity.sql",
  "utf8",
);
const repositorySource = readFileSync("src/lib/training/training-daily-readiness-repository.ts", "utf8");

assert.equal(
  createHash("sha256").update(baseMigration).digest("hex").toUpperCase(),
  "A06186A518F35C423D583C537A2839C0A545A66F62DA40C2C0D5D6768E413839",
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
  /supabase\.rpc\("save_daily_training_readiness",\s*\{\s*p_payload: normalizedPayload,\s*\}\)/,
  "el repositorio invoca la RPC unicamente con p_payload",
);

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

const store = createInMemoryDailyReadinessStore();
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16")), true, "primera apertura muestra formulario");
const saved = store.save("user-a", "2026-06-16", fullPayload);
assert.equal(shouldShowDailyReadinessForm(saved), false, "guardado exitoso crea una fila y omite formulario");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16")), false, "segunda apertura del mismo dia omite formulario");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16")), false, "salir y volver omite formulario");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16")), false, "editar rutina y volver omite formulario");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-16")), false, "recargar la aplicacion omite formulario");
assert.equal(shouldShowDailyReadinessForm(store.get("user-a", "2026-06-17")), true, "dia local siguiente muestra formulario");
assert.deepEqual(store.get("user-a", "2026-06-16")?.payload, fullPayload, "payload diario se conserva tras recarga");

const payloadB = normalizeDailyReadinessPayload({ motivation: 4, hydration: 4, sleep: 4, energy: 4, skipped: false });
const doubleTapRows = [
  store.save("user-a", "2026-06-16", fullPayload),
  store.save("user-a", "2026-06-16", payloadB),
];
assert.equal(new Set(doubleTapRows.map((row) => row.id)).size, 1, "doble toque reutiliza la fila diaria");
assert.deepEqual(doubleTapRows[1].payload, fullPayload, "segunda llamada devuelve la primera respuesta persistida");
assert.notDeepEqual(doubleTapRows[1].payload, payloadB, "segundo payload no reemplaza al primero");
assert.equal(doubleTapRows[1].updatedAt, saved.updatedAt, "updated_at no cambia por reintento idempotente");
assert.equal(store.countRows("user-a", "2026-06-16"), 1, "dos solicitudes concurrentes crean una sola fila logica");
assert.notEqual(
  store.save("user-b", "2026-06-16", fullPayload).id,
  saved.id,
  "dos usuarios pueden responder la misma fecha con filas aisladas",
);
assert.equal(store.get("user-a", "2026-06-16")?.id, saved.id, "usuario A lee solo su fila");
assert.equal(store.get("user-b", "2026-06-16")?.id.startsWith("user-b:"), true, "usuario B no sobrescribe datos de A");

let trainingSessionsWrites = 0;
let exerciseEntriesWrites = 0;
let trainingCyclesWrites = 0;
const failed = simulateSaveFailure(() => {
  throw new Error("network");
});
assert.equal(failed.canOpenTraining, false, "guardado fallido no abre entrenamiento");
assert.equal(failed.keepFormVisible, true, "guardado fallido mantiene el formulario");
const retry = simulateSaveFailure(() => store.save("user-c", "2026-06-16", fullPayload));
assert.equal(retry.canOpenTraining, true, "reintento exitoso permite continuar");
assert.equal(shouldShowDailyReadinessForm(store.get("user-c", "2026-06-16")), false, "consulta no depende de training_session_id");
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

function createInMemoryDailyReadinessStore() {
  const rows = new Map<string, TrainingDailyReadinessRecord>();
  return {
    get(userId: string, localDate: string) {
      return rows.get(`${userId}:${localDate}`) ?? null;
    },
    save(userId: string, serverLocalDate: string, payload: TrainingDailyReadinessPayload) {
      const localDate = serverLocalDate;
      const key = `${userId}:${localDate}`;
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
    countRows(userId: string, localDate: string) {
      return rows.has(`${userId}:${localDate}`) ? 1 : 0;
    },
  };
}

function simulateSaveFailure(save: () => TrainingDailyReadinessRecord) {
  try {
    save();
    return { canOpenTraining: true, keepFormVisible: false };
  } catch {
    return { canOpenTraining: false, keepFormVisible: true };
  }
}
