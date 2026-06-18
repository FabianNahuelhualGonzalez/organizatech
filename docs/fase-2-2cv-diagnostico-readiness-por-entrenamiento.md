# Fase 2.2CV - Diagnostico readiness por entrenamiento

## 1. Resumen ejecutivo

2.2CV diagnostica el contrato actual de readiness y disena el cambio para que el formulario se registre una vez por entrenamiento planificado, no una vez global por dia.

Veredicto tecnico: **A. Viable con cycle_day_id y migracion aditiva**.

El contrato actual persiste readiness con identidad:

```text
user_id + local_date
```

Ese contrato explica el bug confirmado: si el usuario responde el formulario una vez en una fecha local, cualquier otro entrenamiento del mismo dia omite el formulario aunque corresponda a otro `cycle_day_id`.

Contrato recomendado:

```text
user_id + local_date + cycle_day_id
```

Para historicos, `cycle_day_id` debe agregarse nullable. Para nuevas escrituras cycle-scoped, la RPC debe exigir `cycle_day_id` y validar que pertenezca al usuario autenticado.

## 2. Problema reproducido

Caso confirmado:

```text
1. Se crea readiness para una fecha local de miercoles.
2. Mas tarde se abre Piernas del mismo miercoles.
3. La app consulta readiness solo por local_date.
4. Como ya existe una fila para ese dia, setReadiness(record.payload) evita mostrar el formulario.
```

Comportamiento deseado:

```text
Miercoles / Piernas primera apertura -> mostrar formulario.
Miercoles / Piernas reapertura -> no repetir formulario.
Otro entrenamiento el mismo dia -> mostrar formulario propio.
```

## 3. Contrato actual

Tabla actual:

```text
public.training_daily_readiness
```

Columnas en `supabase/migrations/20260608_training_daily_readiness.sql:4-10`:

```text
id uuid primary key
user_id uuid not null
local_date date not null
payload jsonb not null
created_at timestamptz
updated_at timestamptz
```

Constraint actual en `supabase/migrations/20260608_training_daily_readiness.sql:11`:

```text
training_daily_readiness_user_local_date_key unique (user_id, local_date)
```

RLS y grants:

```text
20260608_training_daily_readiness.sql:41  enable row level security
20260608_training_daily_readiness.sql:43-47  policy SELECT own rows, auth.uid() = user_id
20260608_training_daily_readiness.sql:52-55  revoke all, grant SELECT to authenticated
20260608_training_daily_readiness.sql:160-162 grant execute RPC to authenticated
```

No hay DELETE policy. No hay grants directos INSERT/UPDATE para authenticated; la escritura va por RPC.

## 4. Evidencia de codigo y SQL

Migracion base:

```text
supabase/migrations/20260608_training_daily_readiness.sql:4-12
supabase/migrations/20260608_training_daily_readiness.sql:59-75
supabase/migrations/20260608_training_daily_readiness.sql:110-145
```

La migracion base usa `on conflict (user_id, local_date) do nothing` en `20260608_training_daily_readiness.sql:121`.

Patch de ambiguedad:

```text
supabase/migrations/20260609_fix_training_daily_readiness_rpc_ambiguity.sql:1-13
supabase/migrations/20260609_fix_training_daily_readiness_rpc_ambiguity.sql:52-63
supabase/migrations/20260609_fix_training_daily_readiness_rpc_ambiguity.sql:95-97
```

El patch conserva firma:

```sql
save_daily_training_readiness(p_payload jsonb)
```

y cambia el conflicto a:

```sql
on conflict on constraint training_daily_readiness_user_local_date_key do nothing
```

Repositorio:

```text
src/lib/training/training-daily-readiness-repository.ts:75-90
src/lib/training/training-daily-readiness-repository.ts:93-113
src/lib/training/training-daily-readiness-repository.ts:136-138
```

La lectura actual calcula `localDate` en Santiago y consulta:

```ts
.from("training_daily_readiness")
.select("id,local_date,payload,created_at,updated_at")
.eq("local_date", localDate)
.maybeSingle()
```

No filtra por `cycle_day_id` porque la columna no existe.

## 5. Flujo actual de frontend

Flujo observado:

```text
TrainingDashboard -> startTrainingWithDailyReadiness()
-> getDailyTrainingReadiness()
-> setDailyReadinessRecord(record)
-> setReadiness(record?.payload ?? null)
-> setHasStartedTraining(true)
-> render:
   !readiness => TrainingReadinessScreen
   readiness => GuidedTrainingScreen
```

Evidencia:

```text
src/components/organizatech-app.tsx:1931-1958
src/components/organizatech-app.tsx:1968-1987
src/components/organizatech-app.tsx:2497-2514
```

La condicion que muestra u omite el formulario esta en render:

```text
hasStartedTraining && !readiness -> muestra TrainingReadinessScreen
hasStartedTraining && readiness -> muestra GuidedTrainingScreen
```

Por eso una fila diaria existente bloquea el formulario de cualquier otro entrenamiento en la misma fecha.

## 6. Disponibilidad de cycle_day_id

Para cycle-scoped, `cycle_day_id` esta disponible antes de guardar el entrenamiento:

```text
src/components/organizatech-app.tsx:4997-5015
```

`createExerciseTemplatesFromCycleScopedPlan()` asigna:

```ts
cycleDayId: day.id
trainingCycleExerciseId: exercise.id
```

Tambien se resuelve antes de persistir sesion:

```text
src/components/organizatech-app.tsx:2035-2042
src/components/organizatech-app.tsx:2087-2090
```

`createTrainingSessionWithCycleEntries()` exige `cycleDayId` en tipos:

```text
src/lib/training/cycle-scoped-training-repository.ts:60-69
```

Respuestas:

```text
A. cycle_day_id existe antes del modal/formulario en flujo cycle-scoped porque dayExercises trae cycleDayId.
B. Al salir y volver, el draft actual conserva activeRoutineDay, pero no guarda explicitamente cycleDayId.
C. Recovery usa activeRoutineDay/readiness/drafts; debe persistir o rederivar cycleDayId desde plan vigente para evitar ambiguedad.
D. Flujos legacy no tienen cycle_day_id legitimo.
E. cycle_day_id puede ser NULL legitimamente para historicos y legacy, pero no para nuevas readiness cycle-scoped.
```

## 7. Contrato propuesto

Agregar a `training_daily_readiness`:

```sql
alter table public.training_daily_readiness
  add column if not exists cycle_day_id uuid null;
```

Identidad nueva para cycle-scoped:

```text
user_id + local_date + cycle_day_id
```

Para evitar romper historicos, no reemplazar inmediatamente el constraint viejo con NOT NULL global. La migracion debe ser aditiva y de dos carriles:

```text
Historico/legacy:
  cycle_day_id IS NULL
  se conserva compatibilidad con filas existentes.

Cycle-scoped nuevo:
  cycle_day_id IS NOT NULL
  unicidad por user_id, local_date, cycle_day_id.
```

## 8. Compatibilidad historica

Las filas existentes no tienen `cycle_day_id`. No debe hacerse backfill por nombre de dia, rutina o texto.

Recomendacion:

```text
1. cycle_day_id nullable.
2. Mantener filas historicas NULL.
3. Exigir cycle_day_id solo para nuevas escrituras cycle-scoped en la RPC.
4. Mantener lectura legacy diaria para flujos sin cycle_day_id durante transition.
```

No alterar ni borrar readiness historicas.

## 9. Seguridad multiusuario

Riesgo a resolver: un cliente podria enviar un `cycle_day_id` de otro usuario si la RPC solo inserta el UUID.

Regla obligatoria en RPC:

```sql
exists (
  select 1
  from public.training_cycle_days d
  where d.id = p_cycle_day_id
    and d.user_id = v_user_id
    and d.deleted_at is null
)
```

FK recomendada:

```text
cycle_day_id -> training_cycle_days(id) on delete restrict
```

Para reforzar aislamiento por FK compuesta se puede agregar antes:

```sql
alter table public.training_cycle_days
  add constraint training_cycle_days_user_id_id_unique unique (user_id, id);
```

y luego:

```sql
foreign key (user_id, cycle_day_id)
references public.training_cycle_days(user_id, id)
on delete restrict
```

Si se evita la FK compuesta, la validacion SECURITY DEFINER debe ser obligatoria.

## 10. Cambios de esquema propuestos

Migracion aditiva candidata, no ejecutada:

```sql
alter table public.training_daily_readiness
  add column if not exists cycle_day_id uuid null;

create index if not exists training_daily_readiness_user_local_date_cycle_day_idx
  on public.training_daily_readiness(user_id, local_date, cycle_day_id)
  where cycle_day_id is not null;

create unique index if not exists training_daily_readiness_user_local_date_cycle_day_key
  on public.training_daily_readiness(user_id, local_date, cycle_day_id)
  where cycle_day_id is not null;
```

Decision pendiente para el constraint viejo:

```text
Si se mantiene unique(user_id, local_date), no se puede tener mas de una readiness scoped el mismo dia.
Por lo tanto debe sustituirse para el nuevo contrato.
```

Opcion segura:

```sql
alter table public.training_daily_readiness
  drop constraint if exists training_daily_readiness_user_local_date_key;

create unique index if not exists training_daily_readiness_legacy_user_local_date_key
  on public.training_daily_readiness(user_id, local_date)
  where cycle_day_id is null;
```

Esto preserva idempotencia legacy diaria y permite multiples readiness scoped por dia.

## 11. Cambios de RPC propuestos

Crear o reemplazar:

```sql
save_daily_training_readiness(p_payload jsonb)
```

Reglas:

```text
- v_user_id := auth.uid()
- v_local_date := Santiago date server-side
- validar payload igual que hoy
- extraer cycle_day_id desde p_payload y quitarlo del JSON canonico
- si cycle_day_id is not null:
  - validar training_cycle_days.id = cycle_day_id
  - validar training_cycle_days.user_id = v_user_id
  - validar deleted_at is null
  - insertar con cycle_day_id
  - ON CONFLICT por unique parcial scoped
- si cycle_day_id is null:
  - comportamiento legacy por user_id + local_date
  - ON CONFLICT por unique parcial legacy
- DO NOTHING, sin DO UPDATE
- retorno conserva el contrato historico: id, local_date, payload, created_at, updated_at
```

Tambien agregar lectura:

```text
get_training_readiness_for_training(p_cycle_day_id uuid)
```

o mantener lectura directa desde frontend con filtro:

```text
local_date = hoy
cycle_day_id = currentCycleDayId
```

Preferencia: RPC de lectura para centralizar fecha Santiago y validacion multiusuario.

## 12. Cambios de frontend propuestos

Repository:

```text
TrainingDailyReadinessRecord agrega cycleDayId?: string | null.
getDailyTrainingReadiness({ cycleDayId?: string | null }).
saveDailyTrainingReadiness(payload, { cycleDayId?: string | null }).
```

UI:

```text
startTrainingWithDailyReadiness debe resolver currentCycleDayId antes de consultar readiness.
persistDailyReadiness debe enviar el mismo currentCycleDayId.
Workout draft debe guardar cycleDayId o una identidad estable del entrenamiento activo.
Recovery debe reusar la misma identidad y no depender solo de activeRoutineDay.
Legacy debe seguir usando cycleDayId null.
```

No usar `training_session_id` como primera identidad porque la sesion no existe todavia cuando se solicita readiness.

## 13. Tests requeridos

Casos minimos:

```text
1. Primera apertura user/local_date/cycle_day_id muestra formulario.
2. Reapertura del mismo cycle_day no lo repite.
3. Distinto cycle_day el mismo dia si lo muestra.
4. Mismo cycle_day en fecha distinta si lo muestra.
5. Dos usuarios aislados aunque usen fechas iguales.
6. cycle_day_id ajeno es rechazado por RPC.
7. Concurrencia no genera duplicados.
8. Recovery conserva cycle_day_id.
9. Readiness historica NULL sigue legible.
10. Legacy con cycle_day_id null conserva idempotencia diaria.
11. RLS permite SELECT own rows.
12. Sin DELETE fisico ni DO UPDATE.
```

## 14. Riesgos

```text
- Mas de una rutina el mismo dia: cycle_day_id resuelve mejor que day_code.
- Recovery actual solo guarda activeRoutineDay; debe persistir/rederivar cycleDayId.
- Ciclos versionados: cycle_day_id pertenece a un ciclo concreto, correcto.
- cycle_day_id deleted_at: RPC debe rechazar deleted_at no null para nuevas escrituras.
- Legacy: no tiene cycle_day_id, debe mantener carril NULL.
- Zona horaria: mantener local_date server-side en America/Santiago.
- Doble click/dos pestanas: unique scoped + DO NOTHING evita duplicados.
- Formulario guardado pero entrenamiento no iniciado: aceptable; queda readiness del intento para ese entrenamiento.
- Error de red al consultar: no debe abrir entrenamiento silenciosamente si no se sabe si hay readiness.
```

## 15. Estrategia migration-first

Secuencia recomendada:

```text
1. Migracion aditiva QA:
   - cycle_day_id nullable
   - indices/uniques parciales
   - RPC actualizada compatible con p_cycle_day_id default null
2. Postchecks QA de catalogo y permisos.
3. Frontend QA usando cycleDayId para cycle-scoped.
4. Pruebas manuales:
   - mismo entrenamiento no repite
   - otro entrenamiento mismo dia muestra
   - legacy no rompe
5. Migracion aditiva Production.
6. Confirmar frontend anterior estable con default null.
7. Merge frontend.
8. Smoke Production.
```

No desplegar frontend que exija `cycle_day_id` antes de instalar el contrato SQL.

## 16. Rollback funcional

Rollback sin borrar datos:

```text
- Apagar uso frontend de cycle_day_id.
- Volver temporalmente a lectura diaria legacy.
- Mantener columna cycle_day_id y filas nuevas.
- No eliminar readiness creadas.
- No ejecutar DELETE.
- No revertir datos manualmente.
```

Rollback funcional no implica rollback fisico de la migracion.

## 17. Restricciones

Durante 2.2CV:

```text
- No codigo funcional.
- No migracion ejecutable definitiva.
- No SQL remoto.
- No Supabase remoto.
- No Vercel.
- No deployment.
- No cambios en exercise lineage.
- No UI "Ultima vez".
- No getLatestExercisePerformances.
```

## 18. Recomendacion tecnica

Recomendacion: **A. Viable con cycle_day_id y migracion aditiva**.

La identidad `user_id + local_date + cycle_day_id` es la minima que representa "una readiness por entrenamiento planificado" antes de crear `training_session`.

Siguiente fase sugerida, sin abrir ni implementar todavia:

```text
Fase 2.2CW - Implementacion del contrato readiness por entrenamiento en rama aislada
```

## 19. Decision solicitada a Arquitectura

Solicitar autorizacion para preparar 2.2CW con:

```text
1. Migracion candidata aditiva.
2. RPC compatible con p_cycle_day_id default null.
3. Repository typed con cycleDayId opcional.
4. Frontend cycle-scoped enviando cycleDayId.
5. Tests SQL/TS de identidad por entrenamiento.
6. Sin aplicar SQL hasta autorizacion QA separada.
```
