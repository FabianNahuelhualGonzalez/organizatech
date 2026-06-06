# Fase 2.2BN - Preparacion de ventana SQL Production cycle-scoped

## 1. Resumen ejecutivo

La Fase 2.2BN prepara documentalmente una futura ventana SQL Production para
el modelo cycle-scoped de Training. Esta fase no autoriza ni ejecuta SQL,
cambios Supabase, cambios Vercel, backfill o activacion funcional.

Estado verificado:

```text
Fecha: 6 de junio de 2026
main: 25ff1f60201049a68fce0ad7104fca08d60f40c6
PR #30: mergeado
Production deployment: dpl_6JyUq4XG4MCAgUT9XDAtYRL3hSJf
Production state: READY
Production target: production
Training Cycles repository: OFF
ENABLE_TRAINING_CYCLES_REPOSITORY: ausente/no configurada
SQL cycle-scoped Production: pendiente
```

La futura ventana debe:

1. confirmar directamente el ambiente y baseline de Supabase Production;
2. comparar ese baseline con los supuestos de las tres migraciones;
3. ejecutar los tres archivos exactos, en orden y bajo un control
   transaccional previamente auditado;
4. ejecutar postchecks de schema, datos legacy, RLS, policies, grants y RPCs;
5. mantener Training Cycles apagado durante toda la ventana;
6. no crear ciclos, sesiones ni entries productivos;
7. separar la activacion funcional en otra fase.

Recomendacion:

```text
No autorizar aun la aplicacion SQL.
Abrir primero una fase de prechecks read-only en Supabase Production.
Solo si el baseline coincide, preparar una autorizacion de aplicacion manual
con los archivos y hashes documentados aqui.
```

## 2. Estado actual de Production

El codigo mergeado esta desplegado desde `main`:

```text
Commit: 25ff1f60201049a68fce0ad7104fca08d60f40c6
Deployment ID: dpl_6JyUq4XG4MCAgUT9XDAtYRL3hSJf
Estado: READY
Target: production
Source: git
```

Postchecks de 2.2BM:

```text
Aplicacion principal: carga correctamente
trainingCyclesRepositoryEnabled: false
/qa/training-cycles: acceso bloqueado
VERCEL_ENV: production
QA tools: disabled
Supabase env QA: not-set
```

El flujo legacy sigue siendo la ruta productiva. La presencia de archivos SQL
en `main` no implica que esas migraciones hayan sido aplicadas.

## 3. Estado de feature flag Production

Estado aprobado:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY: ausente/no configurada en Production
```

El gate real requiere:

```ts
process.env.VERCEL_ENV === "production" &&
process.env.ENABLE_TRAINING_CYCLES_REPOSITORY === "true"
```

Mientras la variable permanezca ausente, el repository cycle-scoped queda
apagado aunque el schema llegue a Production.

Reglas para la futura ventana:

- confirmar visualmente la ausencia de la flag antes de abrir la ventana;
- no crear, modificar ni guardar variables Vercel;
- no hacer redeploy;
- confirmar nuevamente el runtime OFF despues del SQL;
- no activar Training Cycles dentro de la ventana SQL.

## 4. Estado PR, merge y main

```text
PR: #30
Estado: MERGED / CLOSED
Feature HEAD auditado: 8e574ed97c9a14b5ae8d963c7652d944d28078e8
Merge commit: 25ff1f60201049a68fce0ad7104fca08d60f40c6
main local/remota: sincronizadas durante 2.2BM
```

Los tres archivos SQL pendientes ya estan versionados en `main`. No se debe
modificar su contenido para la ventana sin una nueva revision y autorizacion.

## 5. Migraciones pendientes para Production

Orden obligatorio:

1. `supabase/migrations/20260604_training_cycle_scoped_model.sql`
2. `supabase/migrations/20260604_training_cycle_scoped_policy_fix.sql`
3. `supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql`

Hashes SHA-256 actuales:

```text
4721A69F57289221C50AE7A08D6E199A1699152C2961D5D40B9514380F7C7AC5
  supabase/migrations/20260604_training_cycle_scoped_model.sql

28FCB2DC90DF469D2D829377471939F2E0119BE81AC51E7ADA45E2930CFFD8D1
  supabase/migrations/20260604_training_cycle_scoped_policy_fix.sql

94FD3CB3D8DF1166CB7C17ADB6E5122D58A62387AED61122E7E7C336DF82AFD5
  supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql
```

### 5.1 Modelo base

`20260604_training_cycle_scoped_model.sql`:

- agrega `duration_weeks`, `planned_start_date` y `planned_end_date` a
  `training_cycles`;
- crea `training_cycle_routines`, `training_cycle_days` y
  `training_cycle_exercises`;
- agrega `training_sessions.cycle_id`;
- agrega `training_sessions.cycle_day_id`;
- agrega `exercise_entries.training_cycle_exercise_id`;
- crea constraints, indices y triggers;
- habilita RLS en las tablas nuevas;
- reemplaza policies de tablas nuevas y existentes;
- normaliza grants de `anon` y `authenticated`;
- crea `create_training_cycle_with_plan`;
- crea una primera version de
  `create_training_session_with_cycle_entries`.

### 5.2 Patch de coherencia

`20260604_training_cycle_scoped_policy_fix.sql`:

- crea uniques `(id, cycle_id)` requeridos por FKs compuestas;
- obliga a que rutina, dia, ejercicio y sesion correspondan al mismo ciclo;
- reemplaza policies con comparaciones de `cycle_id` calificadas;
- evita mezcla entre ciclos del mismo usuario.

### 5.3 Contrato final de session entries

`20260605_training_cycle_scoped_session_entries_contract.sql`:

- cambia `exercise_entries.exercise_id` a nullable;
- agrega la constraint:

```sql
exercise_id is not null
or training_cycle_exercise_id is not null
```

- reemplaza la policy `entries own rows`;
- reemplaza `create_training_session_with_cycle_entries`;
- permite una entry 100% cycle-scoped con `exercise_id = null`;
- mantiene entries legacy con `exercise_id` obligatorio.

## 6. Evidencia QA previa

Los tres archivos fueron aplicados manualmente en Supabase QA, en el orden
documentado, sin `db push` ni `migration repair`.

QA confirmo:

- tablas `training_cycle_*` creadas;
- columnas cycle-scoped agregadas;
- constraints compuestas aplicadas;
- RLS habilitada;
- policies `to authenticated`;
- `anon` sin grants;
- `authenticated` solo con `SELECT`, `INSERT` y `UPDATE`;
- RPCs como `SECURITY INVOKER`;
- flujo legacy intacto;
- creacion atomica de ciclo y plan;
- lectura/render desde tablas cycle-scoped;
- persistencia de sesiones y entries;
- `training_cycle_exercise_id` poblado;
- `exercise_id = null` aceptado;
- ausencia de ejercicio legacy artificial;
- `planned_date` calculado desde el rango del ciclo.

Ultima evidencia funcional QA consolidada:

```text
session_id: 33ac7a6a-734c-4728-bcb5-afa10f3da630
cycle_id: 2cb7b989-1d55-4f52-a3f4-f1e1d171fc2a
cycle_day_id: 2c8ecbc3-29ee-403a-9b5d-d88449b2cfa1
planned_day: tuesday
planned_date: 2026-06-09
trained_date: 2026-06-05
status: completed

entry_id: 57461fc8-d9d0-4442-a85a-a1258d737ca4
training_cycle_exercise_id: fd50eb8b-5b60-48c7-bb9f-b9654737bb2d
exercise_id: null
weight: 21
previous_weight: 20
reps: [12,12,12]
```

Conteos QA observados en la prueba:

```text
training_sessions: 7 -> 8
exercise_entries: 8 -> 9
legacy_exercises: 11 -> 11
```

Esta evidencia valida el diseño en QA, pero no reemplaza el baseline directo
de Production.

## 7. Dependencias entre migraciones

### 7.1 Dependencias preexistentes

Antes del primer archivo deben existir:

- `auth.users`;
- `public.training_cycles`;
- `public.training_sessions`;
- `public.exercise_entries`;
- `public.exercises`;
- `public.set_updated_at()`;
- columnas legacy usadas por policies y RPCs;
- extension `pgcrypto`, o permisos para crearla.

### 7.2 Dependencia 1 -> 2

El segundo archivo depende de las tablas y columnas creadas por el primero.
Ademas, el primero contiene policies de estado intermedio con referencias de
`cycle_id` que el segundo reemplaza por comparaciones calificadas.

Consecuencia:

```text
No considerar correcto el estado despues de aplicar solo el archivo 1.
No activar la feature entre los archivos 1 y 2.
No abandonar la ventana con el archivo 1 aplicado sin inspeccion y plan de
forward-fix o rollback.
```

### 7.3 Dependencia 2 -> 3

El tercer archivo depende de:

- `training_cycle_exercises`;
- `training_sessions.cycle_id`;
- `training_sessions.cycle_day_id`;
- `exercise_entries.training_cycle_exercise_id`;
- coherencia de ciclo/dia establecida por el patch;
- RPC creada inicialmente por el primer archivo.

La primera version de la RPC exige `exercise_id` legacy. El tercer archivo la
reemplaza por el contrato final que permite `exercise_id = null`.

Consecuencia:

```text
No considerar completo el contrato frontend despues de aplicar solo los
archivos 1 y 2.
No activar la feature antes de completar y postcheckear el archivo 3.
```

### 7.4 Transaccion

Los archivos no contienen `BEGIN`/`COMMIT` propios.

Recomendacion para la futura fase:

```text
Preparar y auditar una envolvente transaccional que ejecute los tres contenidos
exactos, en orden, dentro de una unica transaccion, si el mecanismo manual
elegido garantiza esa semantica.
```

Si Arquitectura decide ejecucion archivo por archivo:

- confirmar la semantica transaccional del SQL Editor;
- capturar resultado de cada archivo;
- no continuar tras un error;
- no asumir rollback automatico;
- ejecutar inspeccion read-only inmediata para detectar estado parcial;
- preferir forward-fix auditado sobre reintentos ciegos.

## 8. Prechecks read-only para Production

Estas consultas son candidatas. No fueron ejecutadas en Production durante
2.2BN.

### 8.1 Confirmar ambiente

Confirmar visualmente project name/ref de Supabase Production y luego:

```sql
select
  current_database() as database_name,
  current_user as database_user,
  inet_server_addr() as server_address,
  now() as checked_at;
```

Abortar ante cualquier duda de ambiente.

### 8.2 Confirmar dependencias base

```sql
select
  to_regclass('public.training_cycles') as training_cycles,
  to_regclass('public.training_sessions') as training_sessions,
  to_regclass('public.exercise_entries') as exercise_entries,
  to_regclass('public.exercises') as exercises,
  to_regprocedure('public.set_updated_at()') as set_updated_at,
  exists (
    select 1
    from pg_extension
    where extname = 'pgcrypto'
  ) as pgcrypto_installed;
```

Esperado:

- las cuatro tablas existen;
- `public.set_updated_at()` existe;
- registrar si `pgcrypto` ya existe.

### 8.3 Detectar aplicacion previa o parcial

```sql
select
  to_regclass('public.training_cycle_routines') as training_cycle_routines,
  to_regclass('public.training_cycle_days') as training_cycle_days,
  to_regclass('public.training_cycle_exercises') as training_cycle_exercises,
  to_regprocedure(
    'public.create_training_cycle_with_plan(text,integer,text,text,integer,date,date,jsonb)'
  ) as create_cycle_rpc,
  to_regprocedure(
    'public.create_training_session_with_cycle_entries(uuid,uuid,text,date,date,text,integer,text,jsonb)'
  ) as create_session_rpc;
```

Si aparece cualquier objeto cycle-scoped, no asumir que es seguro continuar.
Inventariar su definicion y abortar hasta comparar el estado con los archivos.

### 8.4 Columnas y nulabilidad

```sql
select
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'training_cycles',
    'training_sessions',
    'exercise_entries'
  )
order by table_name, ordinal_position;
```

Validar especialmente:

```text
training_cycles.duration_weeks
training_cycles.planned_start_date
training_cycles.planned_end_date
training_sessions.cycle_id
training_sessions.cycle_day_id
exercise_entries.training_cycle_exercise_id
exercise_entries.exercise_id is_nullable
```

Baseline esperado antes de migrar, sujeto a confirmacion:

- columnas cycle-scoped nuevas ausentes;
- `exercise_entries.exercise_id` sigue `NOT NULL`.

### 8.5 Constraints y foreign keys

```sql
select
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  con.convalidated as validated,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'training_cycles',
    'training_sessions',
    'exercise_entries',
    'training_cycle_routines',
    'training_cycle_days',
    'training_cycle_exercises'
  )
order by c.relname, con.conname;
```

Guardar el resultado completo como baseline de rollback.

### 8.6 Indices y triggers

```sql
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'training_cycles',
    'training_sessions',
    'exercise_entries',
    'training_cycle_routines',
    'training_cycle_days',
    'training_cycle_exercises'
  )
order by tablename, indexname;
```

```sql
select
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in (
    'training_cycles',
    'training_sessions',
    'exercise_entries',
    'training_cycle_routines',
    'training_cycle_days',
    'training_cycle_exercises'
  )
order by event_object_table, trigger_name;
```

### 8.7 RLS y policies

```sql
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'training_cycles',
    'training_sessions',
    'exercise_entries',
    'training_cycle_routines',
    'training_cycle_days',
    'training_cycle_exercises'
  )
order by c.relname;
```

```sql
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'training_cycles',
    'training_sessions',
    'exercise_entries',
    'training_cycle_routines',
    'training_cycle_days',
    'training_cycle_exercises'
  )
order by tablename, policyname, cmd;
```

Guardar las policies actuales de las tablas existentes antes de reemplazarlas.

### 8.8 Grants

```sql
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'training_cycles',
    'training_sessions',
    'exercise_entries',
    'training_cycle_routines',
    'training_cycle_days',
    'training_cycle_exercises'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
```

El resultado es critico porque la migracion revoca permisos existentes en:

- `training_cycles`;
- `training_sessions`;
- `exercise_entries`.

### 8.9 RPCs existentes

```sql
select
  n.nspname as schema_name,
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_training_cycle_with_plan',
    'create_training_session_with_cycle_entries'
  )
order by p.proname, identity_arguments;
```

Si existe una firma inesperada, abortar y revisar colisiones.

### 8.10 Baseline de datos

```sql
select 'training_cycles' as table_name, count(*) as row_count
from public.training_cycles
union all
select 'training_sessions', count(*)
from public.training_sessions
union all
select 'exercise_entries', count(*)
from public.exercise_entries
union all
select 'exercises', count(*)
from public.exercises;
```

Registrar tambien soft-deletes si existen:

```sql
select
  count(*) filter (where deleted_at is null) as active_rows,
  count(*) filter (where deleted_at is not null) as deleted_rows
from public.training_sessions;
```

```sql
select
  count(*) filter (where deleted_at is null) as active_rows,
  count(*) filter (where deleted_at is not null) as deleted_rows
from public.training_cycles;
```

### 8.11 Estado de ciclos existentes

```sql
select
  id,
  user_id,
  name,
  cycle_number,
  cycle_type,
  goal,
  status,
  started_at,
  ended_at,
  deleted_at
from public.training_cycles
order by created_at, id;
```

Existe evidencia historica de un ciclo tecnico productivo desviado. Debe
preservarse, no editarse, no borrarse y no asociarse a nuevas sesiones.

### 8.12 Compatibilidad de datos legacy

```sql
select count(*) as entries_with_null_exercise_id
from public.exercise_entries
where exercise_id is null;
```

Esperado antes del archivo 3:

```text
0
```

```sql
select count(*) as orphan_session_entries
from public.exercise_entries ee
left join public.training_sessions s on s.id = ee.session_id
where s.id is null;
```

```sql
select count(*) as cross_user_session_entries
from public.exercise_entries ee
join public.training_sessions s on s.id = ee.session_id
where ee.user_id is distinct from s.user_id;
```

```sql
select count(*) as missing_or_cross_user_legacy_exercises
from public.exercise_entries ee
left join public.exercises e
  on e.id = ee.exercise_id
 and e.user_id = ee.user_id
where ee.exercise_id is not null
  and e.id is null;
```

Todos deben devolver `0`. Cualquier inconsistencia requiere una fase separada;
no hacer backfill dentro de la ventana.

## 9. Secuencia propuesta de ejecucion SQL manual

Esta secuencia es una propuesta para una fase futura, no una autorizacion.

### 9.1 Antes de ejecutar

1. Confirmar Supabase Production visualmente.
2. Confirmar los hashes exactos de los tres archivos.
3. Confirmar feature flag Production ausente.
4. Confirmar Production frontend estable y repository OFF.
5. Ejecutar todos los prechecks.
6. Guardar resultados, hora, operador y project ref.
7. Comparar policies/grants/RPCs actuales con los supuestos.
8. Confirmar que no hay estado cycle-scoped parcial.
9. Confirmar conteos baseline y queries de integridad en `0`.
10. Confirmar estrategia transaccional y rollback.

### 9.2 Aplicacion

Orden:

```text
1. 20260604_training_cycle_scoped_model.sql
2. 20260604_training_cycle_scoped_policy_fix.sql
3. 20260605_training_cycle_scoped_session_entries_contract.sql
```

Preferencia:

```text
Ejecutar los tres contenidos exactos dentro de una envolvente transaccional
auditada, si Supabase SQL Editor y la sesion usada garantizan una unica
transaccion para todo el lote.
```

No modificar los archivos, no omitir el patch y no insertar SQL adicional.

Si se ejecutan como tres envios:

1. registrar inicio y fin de cada archivo;
2. verificar resultado `Success`;
3. continuar inmediatamente al siguiente solo si no hubo error;
4. no ejecutar pruebas funcionales entre archivos;
5. mantener la flag OFF;
6. ante error, detener y levantar estado parcial read-only.

### 9.3 Despues de ejecutar

1. Ejecutar postchecks completos.
2. Comparar conteos con el baseline.
3. Confirmar cero filas en tablas nuevas.
4. Confirmar columnas cycle-scoped nulas en datos legacy existentes.
5. Confirmar grants, RLS, policies y RPCs finales.
6. Confirmar runtime frontend OFF.
7. No crear datos para probar las RPCs en esta fase.
8. Mantener observacion legacy.

## 10. Postchecks SQL Production

### 10.1 Tablas y columnas

Repetir las consultas de `to_regclass` e `information_schema.columns`.

Esperado:

- existen las tres tablas `training_cycle_*`;
- existen las tres columnas normalizadas de `training_cycles`;
- existen `training_sessions.cycle_id` y `cycle_day_id`;
- existe `exercise_entries.training_cycle_exercise_id`;
- `exercise_entries.exercise_id` es nullable.

### 10.2 Constraints finales

Confirmar por nombre:

```text
training_cycles_duration_weeks_check
training_cycles_planned_dates_check
training_cycles_id_user_id_unique
training_cycle_routines_cycle_user_fk
training_cycle_days_cycle_user_fk
training_cycle_exercises_cycle_user_fk
training_sessions_cycle_day_required_check
training_cycle_routines_id_cycle_id_unique
training_cycle_days_id_cycle_id_unique
training_cycle_days_routine_cycle_fk
training_cycle_exercises_day_cycle_fk
training_sessions_cycle_day_cycle_fk
exercise_entries_exercise_or_cycle_exercise_check
```

Todas deben estar validadas.

### 10.3 Indices y triggers

Confirmar:

```text
training_cycle_routines_user_cycle_idx
training_cycle_routines_user_cycle_name_idx
training_cycle_days_one_routine_per_day_idx
training_cycle_days_user_cycle_week_day_idx
training_cycle_exercises_user_cycle_day_idx
training_sessions_user_cycle_idx
exercise_entries_user_cycle_exercise_idx
```

Triggers:

```text
training_cycle_routines_set_updated_at
training_cycle_days_set_updated_at
training_cycle_exercises_set_updated_at
```

### 10.4 RLS y policies

Confirmar RLS en las seis tablas:

```text
training_cycles
training_cycle_routines
training_cycle_days
training_cycle_exercises
training_sessions
exercise_entries
```

Confirmar:

- policies `to authenticated`;
- no policies abiertas con `true`;
- comparaciones reales de `cycle_id`;
- `entries own rows` separa flujo legacy y cycle-scoped;
- no coexistencia accidental de policies antiguas.

### 10.5 Grants finales

Esperado:

```text
anon: sin permisos en las seis tablas
authenticated: SELECT, INSERT, UPDATE
authenticated: sin DELETE, TRUNCATE, REFERENCES, TRIGGER
```

No debe existir `GRANT ALL`.

### 10.6 RPCs

Confirmar:

- ambas firmas existen;
- `security_definer = false`;
- `search_path = public, pg_temp`;
- execute disponible para `authenticated`;
- no execute a `anon`;
- `create_training_cycle_with_plan` exige plan minimo;
- `create_training_session_with_cycle_entries` exige
  `training_cycle_exercise_id`;
- `exercise_id` se valida solo cuando es informado;
- ciclo, dia y ejercicio se validan contra `auth.uid()`.

### 10.7 Datos y compatibilidad legacy

Repetir los conteos baseline.

Esperado:

- `training_cycles`: sin cambios;
- `training_sessions`: sin cambios;
- `exercise_entries`: sin cambios;
- `exercises`: sin cambios;
- `training_cycle_routines`: `0`;
- `training_cycle_days`: `0`;
- `training_cycle_exercises`: `0`;
- no backfill;
- no sesiones ni entries nuevas;
- no ejercicio legacy artificial.

Confirmar:

```sql
select count(*) as legacy_sessions_with_cycle_data
from public.training_sessions
where cycle_id is not null
   or cycle_day_id is not null;
```

El resultado debe coincidir con el baseline previo. Si las columnas no existian
antes, el esperado inmediato es `0`.

```sql
select count(*) as entries_with_cycle_exercise
from public.exercise_entries
where training_cycle_exercise_id is not null;
```

Esperado inmediato:

```text
0
```

```sql
select count(*) as invalid_entries
from public.exercise_entries
where exercise_id is null
  and training_cycle_exercise_id is null;
```

Esperado:

```text
0
```

### 10.8 Frontend con flag OFF

Sin modificar Vercel:

- Production deployment permanece `READY`;
- app y login cargan;
- Training legacy carga;
- datos existentes siguen visibles;
- repository cycle-scoped permanece OFF;
- `/qa/training-cycles` permanece bloqueado;
- no hay requests a RPCs o tablas cycle-scoped;
- no se crean datos productivos.

## 11. Rollback SQL

No ejecutar rollback en 2.2BN. Todo rollback requiere autorizacion, baseline y
script auditado.

### 11.1 Principios

1. Mantener la flag ausente/OFF.
2. Detener cualquier prueba.
3. Preservar logs, errores y conteos.
4. Determinar si el lote fue atomico o quedo parcialmente aplicado.
5. Preferir forward-fix auditado.
6. No borrar datos para facilitar una reversa.
7. No usar `db push` ni `migration repair`.

### 11.2 Reversa del archivo 3

Solo si se autoriza:

1. restaurar la RPC anterior desde el archivo 1;
2. restaurar la policy anterior de `exercise_entries`;
3. retirar:

```sql
alter table public.exercise_entries
  drop constraint if exists exercise_entries_exercise_or_cycle_exercise_check;
```

4. restaurar `exercise_id NOT NULL` solo si:

```sql
select count(*)
from public.exercise_entries
where exercise_id is null;
```

devuelve `0`.

Si devuelve un valor mayor que `0`, abortar la restauracion de `NOT NULL`. No
editar ni borrar entries sin otra fase.

### 11.3 Reversa del archivo 2

Solo desde un script auditado:

- restaurar las policies anteriores capturadas en el baseline;
- retirar FKs compuestas solo si no existen dependencias;
- retirar uniques auxiliares solo despues de retirar sus FKs;
- no volver deliberadamente a policies con comparaciones ambiguas como estado
  operativo.

Si el archivo 2 falla despues del archivo 1, la opcion preferida es completar
un forward-fix corregido, no mantener el estado intermedio.

### 11.4 Reversa del archivo 1

Las tablas nuevas solo podrian retirarse si:

- estan vacias;
- no hay sesiones/entries relacionadas;
- no hay dependencias;
- Arquitectura autoriza SQL destructivo.

Las columnas agregadas a tablas existentes solo podrian retirarse si:

- contienen exclusivamente `null`;
- no existen constraints, indices, policies, RPCs o FKs dependientes;
- se preservo el baseline;
- existe autorizacion separada.

Antes de retirar objetos:

1. restaurar policies y grants originales;
2. retirar RPCs cycle-scoped;
3. retirar constraints/FKs en orden inverso;
4. retirar triggers e indices nuevos;
5. retirar tablas y columnas solo como ultimo recurso.

No improvisar `DROP TABLE`, `DROP COLUMN`, `DELETE`, `TRUNCATE` o backfill.

## 12. Criterios de aborto

Abortar antes de aplicar si:

- hay duda de ambiente o project ref;
- la flag Productiva aparece configurada;
- Production no esta estable o repository no esta OFF;
- un hash no coincide;
- falta una dependencia base;
- aparece un objeto cycle-scoped no esperado;
- existe una aplicacion parcial;
- una firma RPC colisiona;
- columns/constraints/policies/grants difieren del baseline esperado;
- existen entries con `exercise_id is null` antes del archivo 3;
- hay entries huerfanas o cruces de `user_id`;
- se requiere backfill;
- se requiere SQL adicional no auditado;
- no existe rollback viable.

Abortar durante la aplicacion si:

- cualquier sentencia falla;
- no se puede demostrar la transaccion;
- un archivo no devuelve `Success`;
- se pierde la conexion o el estado es incierto;
- aparece un timeout;
- se observa cambio de datos no esperado;
- alguien solicita activar la feature dentro de la ventana.

Abortar postchecks si:

- cambia un conteo legacy;
- aparecen filas en tablas nuevas;
- RLS queda deshabilitada;
- `anon` conserva permisos;
- `authenticated` conserva permisos amplios;
- una policy es tautologica o abierta;
- una RPC queda `SECURITY DEFINER`;
- una constraint falta o no esta validada;
- el frontend intenta acceder al modelo scoped con flag OFF;
- Training legacy presenta regresion.

## 13. Riesgos

1. Las migraciones alteran policies y grants de tablas legacy en uso.
2. `exercise_entries.exercise_id` cambia de `NOT NULL` a nullable.
3. El primer archivo deja un estado intermedio que depende del patch.
4. La primera RPC de session entries exige legacy y depende del archivo 3 para
   llegar al contrato final.
5. Los archivos no traen una transaccion envolvente.
6. `CREATE TABLE IF NOT EXISTS` no valida que una tabla preexistente tenga la
   estructura esperada.
7. Los `IF NOT EXISTS` pueden ocultar una aplicacion parcial o una definicion
   previa incompatible.
8. Restaurar `NOT NULL` se vuelve dificil si en el futuro existen entries
   scoped con `exercise_id = null`.
9. El ciclo tecnico productivo existente puede bloquear una futura creacion de
   ciclo activo, pero no debe modificarse en esta ventana.
10. Un cambio accidental de flag antes de completar SQL y postchecks activaria
    codigo contra un schema incompleto.
11. La aplicacion manual requiere trazabilidad externa porque no se usara
    `db push` ni `migration repair`.

## 14. Checklist de ventana productiva

### Autorizacion y ambiente

- [ ] Fase de aplicacion SQL explicitamente autorizada.
- [ ] Project/ref Supabase Production confirmado por dos señales.
- [ ] Operador y observador definidos.
- [ ] Hora de inicio y canal de aborto definidos.
- [ ] Production frontend estable.
- [ ] Flag Production ausente.

### Artefactos

- [ ] Commit `25ff1f60201049a68fce0ad7104fca08d60f40c6`
      o commit posterior explicitamente autorizado.
- [ ] Tres archivos exactos presentes.
- [ ] Tres hashes SHA-256 coinciden.
- [ ] Orden confirmado.
- [ ] Envolvente transaccional revisada o semantica por archivo documentada.
- [ ] Rollback/forward-fix auditado disponible.

### Baseline

- [ ] Dependencias base presentes.
- [ ] Columnas y nulabilidad registradas.
- [ ] Constraints/FKs registradas.
- [ ] Indices/triggers registrados.
- [ ] RLS/policies registradas.
- [ ] Grants registrados.
- [ ] RPCs registradas.
- [ ] Conteos legacy registrados.
- [ ] Ciclos existentes registrados.
- [ ] Integridad legacy devuelve cero inconsistencias.
- [ ] Sin aplicacion cycle-scoped parcial.

### Aplicacion

- [ ] Archivo 1 ejecutado.
- [ ] Archivo 2 ejecutado inmediatamente despues.
- [ ] Archivo 3 ejecutado inmediatamente despues.
- [ ] Sin errores, timeout ni conexion incierta.
- [ ] Sin SQL adicional.
- [ ] Sin datos de prueba.
- [ ] Sin backfill.
- [ ] Sin activacion de flag.

### Postchecks

- [ ] Tablas/columnas correctas.
- [ ] Constraints/FKs correctas y validadas.
- [ ] Indices/triggers presentes.
- [ ] RLS habilitada.
- [ ] Policies finales exactas.
- [ ] Grants finales minimos.
- [ ] RPCs finales `SECURITY INVOKER`.
- [ ] Conteos legacy sin cambios.
- [ ] Tablas nuevas vacias.
- [ ] Columnas scoped legacy sin datos inesperados.
- [ ] Frontend legacy operativo.
- [ ] Repository cycle-scoped OFF.
- [ ] `/qa/training-cycles` bloqueado.

## 15. Training Cycles permanecera apagado

Durante prechecks, aplicacion, postchecks y observacion:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY debe permanecer ausente/no configurada.
```

La aplicacion del schema no autoriza:

- crear un ciclo productivo;
- asociar el ciclo tecnico existente;
- crear una sesion scoped;
- crear una entry scoped;
- activar el repository;
- cambiar variables Vercel;
- hacer redeploy.

El criterio de exito de la ventana SQL es schema correcto con comportamiento
legacy intacto, no una prueba funcional cycle-scoped.

## 16. Activacion en una fase posterior

La activacion debe requerir una fase independiente despues de:

1. SQL Production aplicado sin errores;
2. postchecks aprobados;
3. periodo de observacion legacy;
4. confirmacion de grants/RLS multiusuario;
5. plan para el ciclo tecnico productivo existente;
6. rollback de flag y frontend preparado;
7. autorizacion explicita para crear una prueba productiva minima.

Solo esa fase podria evaluar:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY=true
```

No combinar SQL y activacion.

## 17. Decision recomendada para la siguiente fase

Abrir:

```text
Fase 2.2BO - Prechecks read-only Supabase Production para ventana SQL
cycle-scoped
```

Alcance recomendado:

1. ejecutar unicamente las consultas read-only de la seccion 8;
2. registrar project/ref y baseline completo;
3. comparar resultados con los tres archivos;
4. identificar colisiones, datos incompatibles o estado parcial;
5. no aplicar migraciones;
6. volver a Arquitectura con veredicto:
   - apto para ventana SQL;
   - requiere patch previo;
   - o bloqueado.

La aplicacion SQL debe permanecer bloqueada hasta cerrar 2.2BO y auditar la
estrategia transaccional definitiva.

## 18. Confirmaciones de alcance 2.2BN

- No se ejecuto SQL Production.
- No se toco Supabase Production.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se hizo backfill.
- No se activaron feature flags productivas.
- No se crearon ni modificaron variables Vercel.
- No se hizo redeploy.
- No se crearon ciclos productivos.
- No se tocaron datos productivos.
- No se hizo commit.
- No se hizo push.
- `supabase/.temp/` permanece untracked y no incluido.
