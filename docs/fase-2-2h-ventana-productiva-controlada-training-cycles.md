# Fase 2.2H - Ventana productiva controlada Training Cycles

## 1. Objetivo de la fase

Preparar la documentacion operativa para una futura ventana productiva controlada de Training Cycles.

Esta fase no autoriza ejecucion productiva. El objetivo es dejar listo el checklist, los prechecks read-only, el orden operativo, la estrategia de feature flag y el rollback funcional/UI para revision de Claude y Arquitectura.

## 2. Alcance permitido

- Preparar documentacion operativa.
- Preparar queries read-only para revision productiva.
- Definir prechecks productivos.
- Definir postchecks productivos.
- Definir criterios de exito y aborto.
- Definir estrategia de feature flag productiva.
- Definir rollback funcional/UI.
- Preparar evidencia requerida para auditoria.

## 3. Alcance prohibido

- No ejecutar Produccion.
- No aplicar migracion.
- No activar feature flag productiva.
- No modificar base de datos.
- No tocar Supabase desde Codex.
- No tocar Vercel desde Codex.
- No tocar `training_sessions`.
- No tocar `exercise_entries`.
- No ejecutar backfill.
- No crear nuevas migraciones.
- No modificar codigo funcional.
- No ejecutar scripts productivos.
- No usar sentencias productivas de escritura o DDL.

## 4. Prechecks productivos read-only

Antes de cualquier decision de ejecucion productiva se deben revisar, solo con consultas read-only:

- Confirmar ambiente Supabase Produccion.
- Confirmar si `public.training_cycles` existe.
- Confirmar estructura de columnas.
- Confirmar indices.
- Confirmar RLS.
- Confirmar policies.
- Confirmar trigger `updated_at`.
- Confirmar baseline de `training_sessions`.
- Confirmar baseline de `exercise_entries`.
- Confirmar que el helper QA no esta accesible en Produccion.
- Confirmar que el fallback legacy sigue activo.
- Confirmar que `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY` sigue en `false`.

Si cualquier precheck falla o es ambiguo, abortar la ejecución de ventana productiva y no continuar.

## 5. Checklist de estructura esperada para `training_cycles`

Tabla esperada:

- `public.training_cycles`

Columnas esperadas:

- `id uuid primary key`
- `user_id uuid not null references auth.users(id)`
- `name text not null`
- `cycle_number integer not null`
- `cycle_type text null`
- `goal text null`
- `started_at timestamptz not null`
- `ended_at timestamptz null`
- `status text not null`
- `plan_snapshot jsonb not null`
- `summary_snapshot jsonb null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `deleted_at timestamptz null`

Indices esperados:

- `training_cycles_user_status_idx`
- `training_cycles_user_created_idx`
- `training_cycles_user_deleted_at_idx`
- `training_cycles_one_active_per_user_idx`

RLS esperado:

- RLS habilitada en `public.training_cycles`.

Policies esperadas:

- select own cycles.
- insert own cycles.
- update own cycles.
- Sin policy de delete para frontend.

Trigger esperado:

- Trigger para mantener `updated_at`.
- Funcion asociada esperada: `public.set_updated_at()`.

## 6. Impacto esperado sobre tablas existentes

Impacto esperado sobre `training_sessions`: cero.

Impacto esperado sobre `exercise_entries`: cero.

La habilitacion de Training Cycles debe operar solo sobre `public.training_cycles`. No debe reescribir sesiones, entries, rutinas ni ejercicios existentes.

## 7. Estrategia de feature flag productiva

Feature flag propuesto:

```text
NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY
```

Configuracion:

- Default: `false`.
- Produccion: `false` hasta aprobacion final explicita.
- QA/Preview: puede mantenerse segun validacion previa.

Reglas:

- No reutilizar `NEXT_PUBLIC_ENABLE_QA_TOOLS` para Produccion.
- No habilitar por inferencia de ambiente.
- No habilitar si `training_cycles` no esta validada en Produccion.
- No habilitar sin rollback funcional/UI listo.
- No habilitar sin aprobacion final de Arquitectura.

## 8. Rollback funcional/UI aprobado

Rollback funcional/UI recomendado:

- Desactivar `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY`.
- Redeploy en Vercel para que el cambio de feature flag tome efecto.
- Volver a fallback legacy.
- Mantener `training_cycles`.
- Mantener datos generados.
- No tocar `training_sessions`.
- No tocar `exercise_entries`.
- Guardar evidencia del rollback.

Este rollback es preferente sobre cualquier rollback DB porque minimiza el riesgo de perdida de datos.

## 9. Postchecks

Postchecks minimos si una ventana futura habilita el flag productivo:

- Usuario real crea ciclo activo.
- Segundo ciclo `active` para el mismo usuario queda bloqueado.
- Usuario real finaliza ciclo.
- Historial muestra ciclo finalizado.
- Reload mantiene estado.
- Logout/login mantiene historial.
- Usuario B no ve ciclos de Usuario A.
- Usuario B crea su propio ciclo.
- Produccion no muestra helper QA.
- Fallback legacy sigue disponible.
- No hay errores RLS.
- No hay errores visuales mobile.
- No hay errores relevantes en logs.
- `training_sessions` mantiene baseline esperado.
- `exercise_entries` mantiene baseline esperado.
- Re-ejecutar las queries de baseline de `training_sessions` y `exercise_entries` y comparar contra los valores registrados en prechecks.

## 10. Criterios de exito

La habilitacion productiva futura se considera exitosa solo si:

- Feature flag fue activado con aprobacion final.
- UI productiva usa `training_cycles` sin errores.
- Ciclo activo se crea correctamente.
- Historial se persiste y se mantiene tras reload.
- RLS aísla usuarios correctamente.
- Helper QA sigue bloqueado en Produccion.
- Fallback legacy sigue disponible.
- No hay cambios inesperados en `training_sessions`.
- No hay cambios inesperados en `exercise_entries`.
- No hay errores relevantes en logs.
- Evidencia fue guardada.

## 11. Criterios de aborto

Abortar si:

- Produccion no esta claramente identificada.
- `training_cycles` no existe y no hay aprobacion para aplicar migracion.
- `training_cycles` difiere del esquema esperado.
- RLS no esta activa.
- Policies no coinciden con lo esperado.
- Falta unique partial index de ciclo activo por usuario.
- Falta trigger `updated_at`.
- Helper QA queda accesible en Produccion.
- `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY` no esta claramente controlado.
- Fallback legacy no funciona.
- Hay errores RLS.
- Hay errores de UI.
- Aparecen escrituras inesperadas en `training_sessions`.
- Aparecen escrituras inesperadas en `exercise_entries`.
- No hay responsables definidos.
- No hay aprobacion explicita final.

## 12. Evidencia requerida

- Resultado de prechecks read-only.
- Capturas o export de variables Vercel relevantes.
- Confirmacion de feature flag productiva en `false` antes de aprobacion.
- Confirmacion de helper QA bloqueado en Produccion.
- Resultado de postchecks.
- Logs anonimizados.
- Commit o PR asociado.
- Hora de inicio y cierre de ventana.
- Responsable de ejecucion.
- Responsable de validacion.
- Responsable de rollback.
- Confirmacion de fallback legacy.
- Aprobacion explicita de Arquitectura.
- La evidencia de policies y baselines no debe compartirse externamente sin sanitizacion.

## 13. Responsables

Completar antes de una ventana productiva:

- Responsable de ejecucion:
- Responsable de validacion funcional:
- Responsable de monitoreo:
- Responsable de rollback:
- Responsable de aprobacion final:
- Canal de comunicacion:

Sin responsables definidos, no ejecutar.
Los responsables deben estar completos antes de solicitar la apertura de ventana productiva.

## 14. Orden operativo

Orden futuro propuesto, sin ejecutar en esta fase:

1. Confirmar aprobacion para revision productiva read-only.
2. Confirmar ambiente Produccion.
3. Ejecutar prechecks read-only.
4. Guardar evidencia.
5. Enviar evidencia a Claude.
6. Enviar evidencia a Arquitectura.
7. Verificar que la migración productiva ya fue aplicada. Si no existe, abortar y solicitar aprobación separada para aplicar la migración.
8. Confirmar feature flag productiva.
9. Confirmar rollback funcional/UI.
10. Pedir aprobacion final explicita.
11. Solo si se aprueba, ejecutar ventana productiva separada.
12. Ejecutar postchecks.
13. Monitorear.
14. Mantener fallback legacy.

## 15. Estado final esperado

Al cerrar la preparacion de Fase 2.2H:

- Documento operativo listo.
- Queries read-only listas para revision.
- Produccion sigue bloqueada.
- Migracion no aplicada desde Codex.
- Feature flag productiva no activada.
- Base de datos no modificada.
- `training_sessions` sin cambios.
- `exercise_entries` sin cambios.
- Siguiente paso definido: auditoria Claude y revision de Arquitectura.

## 16. Checklist para enviar nuevamente a Arquitectura

- Documento de Fase 2.2H revisado.
- Queries read-only revisadas.
- Confirmacion de que no hay queries de escritura.
- Confirmacion de que Produccion sigue bloqueada.
- Confirmacion de que no se activo feature flag productiva.
- Confirmacion de rollback funcional/UI.
- Confirmacion de impacto cero esperado en `training_sessions`.
- Confirmacion de impacto cero esperado en `exercise_entries`.
- Confirmacion de postchecks.
- Confirmacion de responsables pendientes o definidos.
- Solicitud explicita de aprobacion para la siguiente fase separada.

## Queries read-only propuestas

Estas queries son solo para revision manual. No ejecutarlas desde Codex sin autorizacion explicita.

Todas las queries son `select`.

### Existencia de `training_cycles`

```sql
select
  to_regclass('public.training_cycles') as training_cycles_regclass;
```

### Estructura de columnas

```sql
select
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'training_cycles'
order by ordinal_position;
```

### Conteo actual de `training_cycles`

```sql
select
  count(*) as training_cycles_total_count,
  count(*) filter (where deleted_at is null) as training_cycles_active_count,
  count(*) filter (where deleted_at is not null) as training_cycles_soft_deleted_count
from public.training_cycles;
```

### Indices asociados

```sql
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'training_cycles'
order by indexname;
```

### Estado de RLS

```sql
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'training_cycles';
```

### Policies existentes

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
  and tablename = 'training_cycles'
order by policyname;
```

### Trigger `updated_at`

```sql
select
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'training_cycles'
order by trigger_name;
```

### Funcion `public.set_updated_at()`

```sql
select
  routine_schema,
  routine_name,
  data_type as return_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'set_updated_at';
```

### Baseline de `training_sessions`

```sql
select
  count(*) as training_sessions_count,
  count(*) filter (where deleted_at is null) as training_sessions_active_count,
  count(*) filter (where deleted_at is not null) as training_sessions_soft_deleted_count,
  min(created_at) as first_created_at,
  max(created_at) as last_created_at
from public.training_sessions;
```

### Baseline de `exercise_entries`

```sql
select
  count(*) as exercise_entries_count,
  count(distinct session_id) as distinct_session_count,
  min(created_at) as first_created_at,
  max(created_at) as last_created_at
from public.exercise_entries;
```

## Recomendacion final

Enviar este documento a Claude para auditoria. Luego enviar a Arquitectura para revision y eventual aprobacion de una fase separada de ejecucion productiva.

Hasta que esa aprobacion exista, no ejecutar Produccion, no aplicar migracion, no activar feature flag productiva y no modificar base de datos.
