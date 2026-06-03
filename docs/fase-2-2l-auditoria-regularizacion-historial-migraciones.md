# Fase 2.2L - Auditoria y regularizacion del historial de migraciones

## 1. Contexto de bloqueo de Fase 2.2K

La Fase 2.2K fue detenida antes de aplicar la migracion productiva `training_cycles` porque el historial local/remoto de migraciones no esta regularizado.

El objetivo original de Fase 2.2K era aplicar exclusivamente:

```text
supabase/migrations/20260531_training_cycles.sql
```

Sin embargo, antes de autorizar `supabase db push`, Arquitectura solicito confirmar que no existan otras migraciones locales pendientes que puedan ejecutarse junto con esa migracion.

La conclusion operativa actual es:

```text
No ejecutar supabase db push.
No aplicar 20260531 todavia.
No ejecutar SQL manual parcial.
No activar feature flag.
```

## 2. Resultado de supabase migration list --linked

Resultado reportado:

```text
Local     Remote     Time (UTC)
20260513             20260513
20260527             20260527
20260527             20260527
20260531             20260531
```

Interpretacion:

- Existen cuatro archivos locales en `supabase/migrations/`.
- El listado remoto no muestra registros equivalentes visibles para esas migraciones.
- El comando no permite concluir que `supabase db push` aplicaria solo `20260531_training_cycles.sql`.
- Ejecutar `supabase db push` en este estado podria intentar aplicar mas de una migracion.
- El campo `Remote` vacio no debe interpretarse automaticamente como "todas las migraciones deben aplicarse"; debe tratarse como evidencia de desfase, ausencia o no visibilidad del tracking remoto en el estado actual.

## 3. Riesgo de ejecutar db push

Ejecutar `supabase db push` en el estado actual tiene riesgo alto porque podria aplicar todas las migraciones locales que Supabase CLI considere pendientes:

- `20260513_add_exercise_day.sql`
- `20260527_legacy_training_diagnostics.sql`
- `20260527_training_sessions_source_of_truth.sql`
- `20260531_training_cycles.sql`

Esto no cumple el alcance aprobado de Fase 2.2K, que era aplicar exclusivamente `20260531_training_cycles.sql`.

Riesgos principales:

- Aplicar cambios de schema antiguos sin revision productiva especifica.
- Ejecutar un archivo de diagnostico ubicado incorrectamente como migracion.
- Reemplazar funciones o constraints existentes.
- Registrar migraciones antiguas como aplicadas sin trazabilidad previa.
- Tocar `training_sessions`, `exercise_entries`, `routines` o `exercises` fuera del alcance de Training Cycles.

## 4. Inventario de migraciones locales

```text
supabase/migrations/20260513_add_exercise_day.sql
supabase/migrations/20260527_legacy_training_diagnostics.sql
supabase/migrations/20260527_training_sessions_source_of_truth.sql
supabase/migrations/20260531_training_cycles.sql
```

## 5. Analisis individual por migracion

### 5.1 20260513_add_exercise_day.sql

**Objetivo funcional**

Agregar la columna `day` a `public.exercises`.

**Tipo**

- Schema real.
- Cambio aditivo.
- No destructivo.

**SQL relevante**

```sql
alter table public.exercises
  add column if not exists day text;
```

**Objetos que crea/modifica/elimina**

- Modifica `public.exercises`.
- Agrega columna `day text` si no existe.
- No elimina objetos.

**Tablas afectadas**

- `public.exercises`.

**Impacto por tabla**

| Punto | Resultado |
| --- | --- |
| Toca `training_sessions` | No |
| Toca `exercise_entries` | No |
| Toca `routines` | No |
| Toca `exercises` | Si |
| Inserta datos | No |
| Hace backfill | No |

**Idempotencia**

Es idempotente por `add column if not exists`.

**Puede volver a ejecutarse sin riesgo**

Riesgo bajo si la columna ya existe. Si no existe, modificaria schema productivo de `exercises`, por lo que no debe ejecutarse sin aprobacion explicita.

**Aplicada de facto en Produccion**

No confirmado en esta fase. El esquema local incluye `public.exercises.day`, pero se requiere validacion read-only en Produccion.

**Si NO debe aplicarse en Produccion**

No debe aplicarse junto con Fase 2.2K. Si falta en Produccion, requiere decision separada porque toca `public.exercises`.

**Riesgo de aplicarla con supabase db push**

Riesgo medio: aunque es aditiva, queda fuera del alcance de Training Cycles y modificaria schema productivo no autorizado en Fase 2.2K.

### 5.2 20260527_legacy_training_diagnostics.sql

**Objetivo funcional**

Ejecutar consultas de diagnostico read-only para datos legacy de Training.

**Tipo**

- Diagnostico.
- Read-only.
- No es una migracion de schema.
- No destructivo.

**SQL relevante**

Contiene solo consultas `select` sobre:

- `public.training_sessions`
- `public.exercise_entries`
- `public.exercises`

**Objetos que crea/modifica/elimina**

- No crea objetos.
- No modifica objetos.
- No elimina objetos.

**Tablas afectadas**

No afecta tablas porque solo consulta:

- `public.training_sessions`
- `public.exercise_entries`
- `public.exercises`

**Impacto por tabla**

| Punto | Resultado |
| --- | --- |
| Toca `training_sessions` | Solo lectura |
| Toca `exercise_entries` | Solo lectura |
| Toca `routines` | No |
| Toca `exercises` | Solo lectura |
| Inserta datos | No |
| Hace backfill | No |

**Idempotencia**

Las consultas son repetibles porque no modifican estado.

**Puede volver a ejecutarse sin riesgo**

Como diagnostico manual, si. Como migracion productiva, no es recomendable porque un archivo de migracion no deberia contener solo diagnosticos operativos.

**Aplicada de facto en Produccion**

No aplica: no deja objetos persistentes que permitan verificar aplicacion de facto.

**Si NO debe aplicarse en Produccion**

No debe aplicarse mediante `supabase db push`. Debe salir del flujo de migraciones productivas o regularizarse de forma documentada si Arquitectura decide marcar historial.

Destino propuesto:

```text
supabase/diagnostics/
```

El archivo diagnostico no corresponde como migracion productiva ordinaria. Se propone moverlo o reclasificarlo hacia `supabase/diagnostics/` solo con aprobacion explicita de Arquitectura. No se debe mover en esta fase. Su tratamiento en el historial CLI debe quedar decidido antes de cualquier regularizacion de migraciones.

Evidencia indirecta:

Varias queries del diagnostico referencian columnas relacionadas con el modelo `source_of_truth`, como `routine_id`, `trained_date`, `deleted_at`, `calendar_week_start`, `planned_day` y `planned_date`. Esto puede servir como evidencia indirecta para orientar la validacion read-only de si partes de `20260527_training_sessions_source_of_truth.sql` ya existen de facto en Produccion.

**Riesgo de aplicarla con supabase db push**

Riesgo medio: no modifica datos, pero puede contaminar historial de migraciones con un diagnostico, generar falsa trazabilidad y ejecutar consultas no necesarias durante una ventana de migracion.

### 5.3 20260527_training_sessions_source_of_truth.sql

**Objetivo funcional**

Convertir `training_sessions` en fuente de verdad para entrenamientos, agregando campos de rutina, calendario, estado, soft delete, constraints, indices y la funcion `public.create_training_session_with_entries`.

**Tipo**

- Schema real.
- Cambio aditivo y de constraints.
- No destructivo en intencion, pero toca tablas productivas centrales.
- Contiene `create or replace function`.

**Objetos que crea/modifica/elimina**

- Modifica `public.routines`.
- Modifica `public.training_sessions`.
- Crea/recrea constraints en `public.training_sessions`.
- Crea indices en `public.training_sessions`.
- Crea o reemplaza funcion `public.create_training_session_with_entries`.
- La funcion contiene `insert` sobre `public.training_sessions` y `public.exercise_entries`, pero esos inserts no se ejecutan al crear la funcion.

**Tablas afectadas**

- `public.routines`
- `public.training_sessions`
- `public.exercise_entries` indirectamente dentro de la funcion
- `public.exercises` indirectamente por validacion dentro de la funcion

**Impacto por tabla**

| Punto | Resultado |
| --- | --- |
| Toca `training_sessions` | Si |
| Toca `exercise_entries` | No durante migracion; si dentro de funcion cuando se invoque |
| Toca `routines` | Si |
| Toca `exercises` | No durante migracion; si dentro de validaciones de funcion |
| Inserta datos | No durante migracion |
| Hace backfill | No |

**Idempotencia**

Parcial:

- `add column if not exists`: idempotente.
- `create index if not exists`: idempotente.
- `drop constraint if exists` + `add constraint`: reejecutable, pero modifica metadata.
- `create or replace function`: reejecutable, pero sobrescribe la funcion actual.

**Puede volver a ejecutarse sin riesgo**

No debe considerarse sin riesgo. Aunque varias instrucciones son idempotentes, reejecutarla puede reemplazar una funcion productiva y tocar constraints/indices de `training_sessions`.

**Aplicada de facto en Produccion**

Parcialmente probable, pero no confirmado completamente en esta fase.

Evidencia disponible:

- Los prechecks productivos pudieron consultar `training_sessions.deleted_at`, por lo que al menos esa columna existe.
- El baseline productivo informado fue:
  - `training_sessions_count = 36`
  - `training_sessions_active_count = 11`
  - `training_sessions_soft_deleted_count = 25`
- Esto sugiere que parte del modelo con soft delete existe en Produccion.

Falta validar read-only:

- `routines.deleted_at`
- `training_sessions.routine_id`
- `training_sessions.calendar_week_start`
- `training_sessions.planned_day`
- `training_sessions.planned_date`
- `training_sessions.trained_date`
- `training_sessions.status`
- `training_sessions.completed_at`
- constraints
- indices
- funcion `public.create_training_session_with_entries`

**Si NO debe aplicarse en Produccion**

No debe aplicarse dentro de Fase 2.2K porque toca `training_sessions`, `routines` y funcion de escritura. Si se requiere regularizarla, debe pasar por fase separada de auditoria y aprobacion.

**Riesgo de aplicarla con supabase db push**

Riesgo alto: esta migracion excede el alcance aprobado para Training Cycles, toca tablas centrales ya consolidadas y podria sobrescribir funcion productiva.

### 5.4 20260531_training_cycles.sql

**Objetivo funcional**

Crear `public.training_cycles` para persistir ciclos de entrenamiento por usuario con RLS estricta, indices, unique partial index para un ciclo activo por usuario y trigger `updated_at`.

**Tipo**

- Schema real.
- Aditiva.
- No destructiva para tablas existentes.

**Objetos que crea/modifica/elimina**

- Crea `public.training_cycles` si no existe.
- Crea indices:
  - `training_cycles_user_status_idx`
  - `training_cycles_user_created_idx`
  - `training_cycles_user_deleted_at_idx`
  - `training_cycles_one_active_per_user_idx`
- Crea trigger:
  - `training_cycles_set_updated_at`
- Habilita RLS.
- Crea policies:
  - select own rows
  - insert own rows
  - update own rows
- No crea policy de delete.

**Tablas afectadas**

- `public.training_cycles`.

**Impacto por tabla**

| Punto | Resultado |
| --- | --- |
| Toca `training_sessions` | No |
| Toca `exercise_entries` | No |
| Toca `routines` | No |
| Toca `exercises` | No |
| Inserta datos | No |
| Hace backfill | No |

**Idempotencia**

Mayormente idempotente:

- `create table if not exists`
- `create index if not exists`
- `drop trigger if exists` + `create trigger`
- `drop policy if exists` + `create policy`

Si se reejecuta sobre una tabla existente con datos, no deberia borrar datos, pero puede reemplazar trigger/policies.

**Puede volver a ejecutarse sin riesgo**

No debe ejecutarse sin aprobacion explicita. Es la migracion candidata para Fase 2.2K, pero solo despues de resolver historial local/remoto.

**Aplicada de facto en Produccion**

No. Evidencia productiva read-only reportada:

```text
to_regclass('public.training_cycles') = null
```

**Si NO debe aplicarse en Produccion**

Si sigue bloqueado el historial, no debe aplicarse mediante `supabase db push`. Puede aplicarse solo con metodo autorizado y garantia de que no se aplicaran migraciones no autorizadas.

**Riesgo de aplicarla con supabase db push**

Riesgo bajo por contenido propio, pero riesgo alto por mecanismo actual, porque `db push` podria aplicar otras migraciones locales pendientes junto con ella.

## 6. Matriz local vs. Produccion

| Objeto / evidencia | Local | Produccion, evidencia disponible | Estado |
| --- | --- | --- | --- |
| `public.exercises.day` | Declarado en `schema.sql` y migracion `20260513` | No confirmado en esta fase | Requiere query read-only |
| Diagnosticos legacy `20260527_legacy_training_diagnostics.sql` | Archivo de SELECTs en `migrations` | No deja objeto persistente | No corresponde como migracion productiva |
| `public.training_sessions.deleted_at` | Migracion `20260527_training_sessions_source_of_truth.sql` | Confirmado indirectamente por baseline con `deleted_at` | Aplicado de facto parcialmente |
| Otros campos source-of-truth de `training_sessions` | En migracion `20260527_training_sessions_source_of_truth.sql` | No confirmados en esta fase | Requiere queries read-only |
| Indices source-of-truth de `training_sessions` | En migracion `20260527_training_sessions_source_of_truth.sql` | No confirmados en esta fase | Requiere queries read-only |
| `public.create_training_session_with_entries` | En migracion `20260527_training_sessions_source_of_truth.sql` | No confirmado en esta fase | Requiere query read-only |
| `public.set_updated_at()` | En `schema.sql` | Confirmado: `public | set_updated_at | trigger` | Existe |
| `public.training_cycles` | En migracion `20260531_training_cycles.sql` | Confirmado ausente: `null` | Pendiente real |
| Historial Supabase CLI `training_cycles` | Archivo local existe | No se encontro registro aplicado; `supabase_migrations.schema_migrations` no existe segun precheck manual | Pendiente segun evidencia |

## 7. Migraciones posiblemente aplicadas de facto

### 20260527_training_sessions_source_of_truth.sql

Posiblemente aplicada de forma parcial o por una ruta distinta al historial CLI, porque Produccion ya responde a consultas con `training_sessions.deleted_at`.

No se puede concluir aplicacion total sin validar columnas, indices, constraints y funcion.

### 20260513_add_exercise_day.sql

No confirmado. Debe validarse si `public.exercises.day` existe en Produccion.

## 8. Migraciones que no deben ejecutarse en este estado

### No ejecutar mediante db push

- `20260513_add_exercise_day.sql`
- `20260527_legacy_training_diagnostics.sql`
- `20260527_training_sessions_source_of_truth.sql`
- `20260531_training_cycles.sql`

Motivo: el historial local/remoto no permite garantizar que se aplique solo `20260531_training_cycles.sql`.

### No ejecutar nunca como migracion productiva ordinaria

- `20260527_legacy_training_diagnostics.sql`

Motivo: es un set de queries de diagnostico. Debe vivir fuera del flujo de migraciones o tratarse como caso historico a regularizar.

## 9. Migraciones pendientes reales

Con evidencia actual:

- `20260531_training_cycles.sql` es pendiente real porque `public.training_cycles` no existe en Produccion.

Pendientes por confirmar:

- `20260513_add_exercise_day.sql`: depende de existencia de `public.exercises.day`.
- `20260527_training_sessions_source_of_truth.sql`: depende de validacion completa de columnas, constraints, indices y funcion.

No aplica:

- `20260527_legacy_training_diagnostics.sql`: no crea estado persistente.

## 10. Estrategias posibles

### Estrategia A - Regularizacion del historial

Marcar migraciones antiguas como aplicadas solo si se confirma que sus cambios ya existen de facto en Produccion.

Comando oficial de referencia:

```bash
supabase migration repair --status applied <migration_id>
```

Este comando esta prohibido en esta fase. Su ejecucion requiere aprobacion explicita separada de Arquitectura. Solo podria considerarse si se confirma con evidencia read-only que una migracion local ya esta aplicada de facto en Produccion. No debe usarse para ocultar diferencias, saltarse validaciones ni forzar un historial que no representa el estado real de la base de datos.

Condiciones:

- Requiere aprobacion explicita de Arquitectura.
- Requiere evidencia read-only por cada objeto.
- No debe marcarse como aplicada una migracion que no exista de facto.
- No debe regularizarse el diagnostico sin decision explicita sobre como tratar archivos read-only dentro de `migrations`.

Orden recomendado antes de marcar migraciones como aplicadas:

1. Validar objetos de Produccion con queries read-only.
2. Confirmar equivalencia funcional con cada migracion local.
3. Auditar diferencias.
4. Obtener aprobacion de Arquitectura.
5. Ejecutar regularizacion de historial solo si corresponde.
6. Repetir `supabase migration list --linked`.
7. Reabrir Fase 2.2K solo si queda aislada `20260531_training_cycles.sql`.

Riesgos:

- Marcar como aplicada una migracion incompleta.
- Ocultar diferencias reales de schema.
- Perder trazabilidad del metodo original por el que Produccion llego al estado actual.

### Estrategia B - Aplicacion selectiva futura de 20260531

Aplicar `20260531_training_cycles.sql` solo despues de regularizar historial o aislar ejecucion de forma segura.

Condiciones:

- Requiere aprobacion explicita de Arquitectura.
- Debe garantizarse que no se ejecutan `20260513` ni `20260527`.
- Debe mantenerse `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false`.
- No debe tocar `training_sessions` ni `exercise_entries`.

Riesgos:

- Si se usa `db push` sin regularizar historial, podria aplicar migraciones antiguas.
- Si se usa metodo alternativo, puede perder trazabilidad CLI si no se documenta y aprueba.

### Estrategia C - Mantener bloqueo

No ejecutar nada hasta resolver inconsistencias.

Condiciones:

- Mantener `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false`.
- Mantener fallback legacy.
- No tocar Vercel.
- No modificar base de datos.

Riesgos:

- Se retrasa habilitacion productiva de ciclos.
- La deuda de historial permanece abierta.

## 11. Riesgos por estrategia

| Estrategia | Riesgo tecnico | Riesgo operativo | Reversibilidad |
| --- | --- | --- | --- |
| A - Regularizacion del historial | Medio si la evidencia es incompleta | Medio por trazabilidad historica | Requiere plan separado |
| B - Aplicacion selectiva futura de 20260531 | Bajo para SQL propio, alto si no se aisla | Medio | Funcionalmente reversible con flag; DB requiere plan |
| C - Mantener bloqueo | Bajo | Medio por demora | Total |

## 12. Recomendacion TI preliminar

Recomendacion preliminar:

1. Mantener bloqueo de `supabase db push`.
2. Ejecutar solo auditoria read-only para confirmar el estado de facto de `20260513` y `20260527_training_sessions_source_of_truth`.
3. Separar el tratamiento del archivo `20260527_legacy_training_diagnostics.sql`, porque no deberia formar parte de una ejecucion productiva de migraciones.
4. Solicitar a Arquitectura una fase explicita de regularizacion de historial si las migraciones antiguas ya estan aplicadas de facto.
5. Solo despues, reabrir Fase 2.2K para aplicar `20260531_training_cycles.sql` de forma aislada y trazable.

## 13. Queries read-only sugeridas para validar Produccion

Estas queries son propuestas para una fase posterior autorizada. No ejecutarlas sin aprobacion explicita.

### 13.1 Existencia de columna `public.exercises.day`

```sql
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'exercises'
  and column_name = 'day';
```

### 13.2 Columnas source-of-truth en `public.training_sessions`

```sql
select
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'training_sessions'
  and column_name in (
    'routine_id',
    'calendar_week_start',
    'planned_day',
    'planned_date',
    'trained_date',
    'status',
    'completed_at',
    'deleted_at'
  )
order by column_name;
```

### 13.3 Columna `public.routines.deleted_at`

```sql
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'routines'
  and column_name = 'deleted_at';
```

### 13.4 Constraints de `public.training_sessions`

```sql
select
  conname,
  pg_get_constraintdef(c.oid) as constraint_definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'training_sessions'
  and conname in (
    'training_sessions_status_check',
    'training_sessions_planned_day_check'
  )
order by conname;
```

### 13.5 Indices source-of-truth de `public.training_sessions`

```sql
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'training_sessions'
  and indexname in (
    'training_sessions_user_trained_date_idx',
    'training_sessions_user_calendar_week_idx',
    'training_sessions_user_routine_week_idx',
    'training_sessions_user_status_idx',
    'training_sessions_user_deleted_at_idx',
    'training_sessions_user_routine_trained_unique_idx'
  )
order by indexname;
```

### 13.6 Funcion `public.create_training_session_with_entries`

```sql
select
  routine_schema,
  routine_name,
  data_type as return_type,
  security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'create_training_session_with_entries';
```

### 13.7 Ausencia de `public.training_cycles`

```sql
select
  to_regclass('public.training_cycles') as training_cycles_regclass;
```

### 13.8 Funcion `public.set_updated_at`

```sql
select
  routine_schema,
  routine_name,
  data_type as return_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'set_updated_at';
```

### 13.9 Baseline `public.training_sessions`

```sql
select
  count(*) as training_sessions_count,
  count(*) filter (where deleted_at is null) as training_sessions_active_count,
  count(*) filter (where deleted_at is not null) as training_sessions_soft_deleted_count
from public.training_sessions;
```

### 13.10 Baseline `public.exercise_entries`

```sql
select
  count(*) as exercise_entries_count,
  count(distinct session_id) as distinct_session_count
from public.exercise_entries;
```

### 13.11 Historiales de migracion disponibles

```sql
select
  table_schema,
  table_name
from information_schema.tables
where table_name ilike '%migration%'
order by table_schema, table_name;
```

### 13.12 Existencia del schema `supabase_migrations`

```sql
select
  schema_name
from information_schema.schemata
where schema_name = 'supabase_migrations';
```

### 13.13 Historial de migraciones Supabase CLI, solo si existe

```sql
select
  name,
  executed_at
from supabase_migrations.schema_migrations
where name in (
  '20260513_add_exercise_day',
  '20260527_legacy_training_diagnostics',
  '20260527_training_sessions_source_of_truth',
  '20260531_training_cycles'
);
```

Si `supabase_migrations.schema_migrations` no existe, registrar ese resultado como evidencia y no intentar crearla.

## 14. Criterios de aborto

Abortar cualquier regularizacion o ejecucion si:

- No se puede confirmar conexion inequivoca a Produccion.
- Se requiere `supabase db push` antes de resolver el historial.
- Hay mas de una migracion pendiente y no existe plan de aislamiento aprobado.
- Una migracion antigua no esta aplicada de facto y no tiene aprobacion propia.
- El archivo de diagnostico se intentaria ejecutar como migracion productiva.
- Se detecta que una regularizacion requeriria escribir en historial remoto sin aprobacion explicita.
- Se detecta diferencia no explicada en baselines de `training_sessions` o `exercise_entries`.
- `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY` esta activo.
- Hay riesgo de exponer secretos.

## 15. Evidencia requerida antes de cualquier regularizacion

- Salida de `supabase migration list --linked` anonimizada y sin secretos.
- Inventario local de `supabase/migrations/`.
- Evidencia read-only de existencia de objetos por cada migracion antigua.
- Confirmacion de ausencia de `public.training_cycles`.
- Confirmacion de existencia de `public.set_updated_at`.
- Baseline actual de `training_sessions`.
- Baseline actual de `exercise_entries`.
- Decision documentada sobre el archivo de diagnostico `20260527_legacy_training_diagnostics.sql`.
- Aprobacion explicita de Arquitectura para cualquier reparacion o regularizacion de historial.

La evidencia no debe incluir tokens, passwords, connection strings, service role keys, anon keys completas ni datos personales.

## 16. Estado final esperado

Estado esperado antes de reabrir Fase 2.2K:

- Historial local/remoto explicado y regularizado o estrategia de aislamiento aprobada.
- `supabase db push` no intentaria aplicar migraciones fuera del alcance aprobado.
- `20260531_training_cycles.sql` identificado como unica migracion pendiente real a ejecutar, o metodo alternativo aprobado explicitamente.
- `training_sessions` y `exercise_entries` sin cambios.
- `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false`.
- Vercel sin cambios.
- Fallback legacy disponible.

Este documento no autoriza regularizar historial, aplicar migraciones, modificar Produccion ni activar feature flags.
