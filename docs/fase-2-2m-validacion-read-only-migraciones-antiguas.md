# Fase 2.2M - Validacion read-only de migraciones antiguas

## 1. Contexto de 2.2L y bloqueo de 2.2K

La Fase 2.2K sigue bloqueada porque `supabase migration list --linked` mostro migraciones locales sin registro remoto visible:

```text
Local     Remote     Time (UTC)
20260513             20260513
20260527             20260527
20260527             20260527
20260531             20260531
```

Arquitectura aprobo la recomendacion TI de mantener bloqueado `supabase db push`, validar de facto las migraciones antiguas con queries read-only y aislar `20260531_training_cycles.sql` antes de reabrir una ejecucion productiva.

## 2. Autorizacion de Arquitectura

Arquitectura autorizo SQL Editor de Supabase Produccion como canal read-only para Fase 2.2M bajo:

```sql
begin;
set transaction read only;

-- SELECTs autorizados

rollback;
```

Esta fase no autoriza migraciones, reparacion de historial, cambios de schema, cambios de datos, feature flags ni Vercel.

## 3. Restricciones aplicadas

- No ejecutar `supabase db push`.
- No ejecutar `supabase migration repair`.
- No aplicar migraciones.
- No ejecutar `alter`, `create`, `insert`, `update` ni `delete`.
- No tocar Vercel.
- No hacer redeploy.
- No activar feature flag.
- No modificar base de datos.
- No modificar `training_sessions`.
- No modificar `exercise_entries`.
- No hacer commit.
- No hacer push.
- No versionar `supabase/.temp/`.

## 4. Bloque SQL ejecutado

Las consultas fueron ejecutadas manualmente en SQL Editor de Supabase Produccion dentro de una transaccion read-only con rollback.

Resumen de queries ejecutadas:

- Existencia de `public.exercises.day`.
- Columnas esperadas en `public.routines`.
- Columnas esperadas en `public.training_sessions`.
- Constraints de `public.training_sessions`.
- Indices de `public.training_sessions`.
- Existencia de `public.create_training_session_with_entries`.
- Existencia del schema `supabase_migrations`.
- Tablas del schema `supabase_migrations`, si existia.
- Existencia de `public.training_cycles`.
- Baseline de `public.training_sessions`.
- Baseline de `public.exercise_entries`.

## 5. Resultados obtenidos

### 5.1 `public.exercises.day`

Resultado:

```text
column_name: day
data_type: text
is_nullable: YES
column_default: null
```

Conclusion: `public.exercises.day` existe.

### 5.2 Columnas en `public.routines`

Resultado:

```text
deleted_at: timestamp with time zone, nullable, default null
updated_at: timestamp with time zone, not nullable, default now()
```

Conclusion: `deleted_at` y `updated_at` existen en `public.routines`.

### 5.3 Columnas en `public.training_sessions`

Resultado:

```text
completed_at: timestamp with time zone, nullable, default null
deleted_at: timestamp with time zone, nullable, default null
routine_id: uuid, nullable, default null
status: text, not nullable, default 'completed'::text
updated_at: timestamp with time zone, not nullable, default now()
```

Conclusion: existen columnas relevantes del modelo source-of-truth: `routine_id`, `status`, `completed_at` y `deleted_at`.

### 5.4 Query adicional solicitada por Claude

Claude detecto una contradiccion entre el resultado inicial de columnas, aparentemente incompleto, y la evidencia de constraints e indices que probaban la existencia de `planned_day`, `calendar_week_start` y `trained_date`.

Por ese motivo, TI ejecuto una query adicional read-only en SQL Editor de Supabase Produccion, bajo transaccion read-only y rollback, para validar las columnas restantes de `20260527_training_sessions_source_of_truth.sql`.

Resultado:

```text
calendar_week_start | date | YES | NULL
planned_date        | date | YES | NULL
planned_day         | text | YES | NULL
trained_date        | date | YES | NULL
```

Conclusion: las columnas `calendar_week_start`, `planned_day`, `planned_date` y `trained_date` existen en Produccion.

### 5.5 Constraints de `public.training_sessions`

Resultado:

```text
training_sessions_pkey
training_sessions_planned_day_check
training_sessions_routine_id_fkey
training_sessions_status_check
training_sessions_user_id_fkey
training_sessions_week_number_check
```

Conclusion: existen constraints esperadas de status, planned day, routine_id y relaciones principales.

### 5.6 Indices de `public.training_sessions`

Resultado:

```text
sessions_user_week_idx
training_sessions_pkey
training_sessions_user_calendar_week_idx
training_sessions_user_deleted_at_idx
training_sessions_user_routine_trained_unique_idx
training_sessions_user_routine_week_idx
training_sessions_user_status_idx
training_sessions_user_trained_date_idx
```

Conclusion: existen indices source-of-truth asociados a usuario, fecha entrenada, semana calendario, rutina, status y soft delete.

### 5.7 Funcion `public.create_training_session_with_entries`

Resultado:

```text
routine_schema: public
routine_name: create_training_session_with_entries
routine_type: FUNCTION
return_type: uuid
security_type: INVOKER
```

Conclusion: la funcion existe y usa `SECURITY INVOKER`.

### 5.8 Schema y tablas `supabase_migrations`

Resultado:

```text
supabase_migrations schema: sin filas
supabase_migrations tables: sin filas
```

Conclusion: `supabase_migrations` no existe o no es visible desde la consulta read-only ejecutada.

### 5.9 `public.training_cycles`

Resultado:

```text
training_cycles_regclass: null
```

Conclusion: `public.training_cycles` sigue sin existir. `20260531_training_cycles.sql` no esta aplicada.

### 5.10 Baseline `public.training_sessions`

Resultado:

```text
training_sessions_count: 36
training_sessions_active_count: 11
training_sessions_soft_deleted_count: 25
```

### 5.11 Baseline `public.exercise_entries`

Resultado:

```text
exercise_entries_count: 78
distinct_session_count: 11
```

## 6. Analisis por migracion

### 6.1 `20260513_add_exercise_day.sql`

Objetivo local:

```text
Agregar public.exercises.day text.
```

Evidencia productiva:

```text
public.exercises.day existe como text nullable.
```

Conclusion: parece aplicada de facto en Produccion.

Riesgo: no se recomienda ejecutarla mediante `supabase db push` dentro del set completo, porque el historial remoto no esta regularizado y podria arrastrar migraciones adicionales.

### 6.2 `20260527_legacy_training_diagnostics.sql`

Validacion local previa:

```text
No se detecto DDL/DML.
El archivo contiene queries de diagnostico read-only.
```

Conclusion: no corresponde como migracion productiva ordinaria.

Tratamiento propuesto:

- Reclasificarlo fuera de `supabase/migrations/`, por ejemplo hacia `supabase/diagnostics/`, solo con aprobacion explicita de Arquitectura.
- No moverlo en esta fase.
- Definir su tratamiento antes de cualquier regularizacion del historial CLI.

### 6.3 `20260527_training_sessions_source_of_truth.sql`

Objetivo local:

- Agregar `routines.deleted_at`.
- Agregar columnas source-of-truth a `training_sessions`:
  - `routine_id`
  - `calendar_week_start`
  - `planned_day`
  - `planned_date`
  - `trained_date`
  - `status`
  - `completed_at`
  - `deleted_at`
- Agregar constraints e indices.
- Crear o reemplazar `public.create_training_session_with_entries`.

Evidencia productiva:

- `routines.deleted_at` existe.
- `training_sessions.routine_id`, `calendar_week_start`, `planned_day`, `planned_date`, `trained_date`, `status`, `completed_at` y `deleted_at` existen.
- Constraints esperadas de `status`, `planned_day` y `routine_id` existen.
- Indices source-of-truth principales existen.
- `public.create_training_session_with_entries` existe y es `SECURITY INVOKER`.

Conclusion: `20260527_training_sessions_source_of_truth.sql` parece aplicada de facto en Produccion, considerando columnas, constraints, indices y funcion `create_training_session_with_entries`.

Riesgo: no se recomienda ejecutar `supabase db push` ni marcar esta migracion como aplicada sin una decision de Arquitectura, porque el historial remoto no esta regularizado y la migracion toca tablas centrales.

### 6.4 `20260531_training_cycles.sql`

Objetivo local:

Crear `public.training_cycles` con RLS, indices, unique partial index y trigger `updated_at`.

Evidencia productiva:

```text
public.training_cycles = null
```

Conclusion: no esta aplicada.

Riesgo: aunque el SQL propio de `training_cycles` es aditivo, no debe ejecutarse por `supabase db push` mientras el historial de migraciones antiguas siga desfasado.

## 7. Matriz de evidencia de facto

| Migracion local | Evidencia en Produccion | Estado |
| --- | --- | --- |
| `20260513_add_exercise_day.sql` | `public.exercises.day` existe | Aplicada de facto |
| `20260527_legacy_training_diagnostics.sql` | No crea objetos; contiene solo SELECT segun validacion local | Reclasificar, no aplicar como migracion ordinaria |
| `20260527_training_sessions_source_of_truth.sql` | Columnas esperadas, constraints, indices y funcion existen | Aplicada de facto segun evidencia read-only |
| `20260531_training_cycles.sql` | `public.training_cycles` no existe | No aplicada |

## 8. Conclusion general

- `20260513_add_exercise_day.sql` parece aplicada de facto.
- `20260527_legacy_training_diagnostics.sql` es diagnostico read-only y no corresponde como migracion productiva ordinaria.
- `20260527_training_sessions_source_of_truth.sql` parece aplicada de facto en Produccion, considerando columnas, constraints, indices y funcion `create_training_session_with_entries`.
- `20260531_training_cycles.sql` no esta aplicada.
- `supabase_migrations` no existe o no es visible.
- No hay base suficiente para ejecutar `supabase db push`.
- No hay base suficiente para ejecutar `supabase migration repair` sobre todo el set.

## 9. Riesgos

- Ejecutar `supabase db push` podria intentar aplicar varias migraciones locales en bloque.
- Marcar migraciones como aplicadas sin aprobacion explicita podria ocultar diferencias reales de historial.
- Ejecutar `20260527_training_sessions_source_of_truth.sql` podria tocar tablas centrales ya estabilizadas.
- Mantener un archivo diagnostico dentro de `supabase/migrations/` contamina el flujo normal de migraciones.
- Aplicar `20260531_training_cycles.sql` sin aislarlo podria arrastrar migraciones antiguas no autorizadas.

## 10. Recomendacion TI preliminar

Recomendacion:

1. Mantener bloqueado `supabase db push`.
2. No ejecutar `supabase migration repair` todavia sin aprobacion explicita.
3. Preparar una fase separada de regularizacion selectiva del historial, considerando `20260513_add_exercise_day.sql` y `20260527_training_sessions_source_of_truth.sql` como candidatas a marcar `applied` solo si Arquitectura aprueba.
4. Definir el tratamiento del diagnostico `20260527_legacy_training_diagnostics.sql` antes de regularizar, probablemente reclasificandolo hacia `supabase/diagnostics/`.
5. Mantener `20260531_training_cycles.sql` aislada hasta que el historial quede regularizado o hasta que Arquitectura apruebe explicitamente un metodo separado.

## 11. Criterios de aborto

Abortar cualquier siguiente fase si:

- Se requiere `supabase db push` sin historial regularizado.
- Se requiere `supabase migration repair` sin aprobacion explicita.
- Se intenta aplicar `20260531_training_cycles.sql` junto con migraciones antiguas.
- Se intenta ejecutar SQL de escritura.
- Se detecta diferencia critica no explicada en baseline.
- Se intenta activar feature flag productiva antes de crear `training_cycles`.
- Se intenta tocar Vercel o hacer redeploy sin autorizacion.
- Hay riesgo de exponer secretos.

## 12. Proximo paso sugerido para Arquitectura

Arquitectura debe decidir entre:

1. Mantener bloqueo.
2. Preparar regularizacion selectiva de `20260513_add_exercise_day.sql` y `20260527_training_sessions_source_of_truth.sql`, solo si Arquitectura aprueba.
3. Definir el tratamiento de historial del diagnostico `20260527_legacy_training_diagnostics.sql`.
4. Reclasificar `20260527_legacy_training_diagnostics.sql` fuera de `supabase/migrations/`.
5. Aislar `20260531_training_cycles.sql` por metodo separado cuando el historial quede resuelto o cuando Arquitectura apruebe explicitamente un metodo de aislamiento.

## 13. Confirmaciones

- Las queries fueron read-only.
- Se ejecutaron bajo transaccion read-only con rollback.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se aplico migracion.
- No se ejecuto `alter`, `create`, `insert`, `update` ni `delete`.
- No se modifico base de datos.
- No se toco Vercel.
- No se activo feature flag.
- No se modifico `training_sessions`.
- No se modifico `exercise_entries`.
- No se hizo commit.
- No se hizo push.
- `supabase/.temp/` no debe versionarse.
