# Fase 2.2J - Aplicacion controlada de migracion productiva Training Cycles

## 1. Contexto de Fase 2.2I

Arquitectura autorizo ejecutar prechecks productivos read-only para Training Cycles.

Resultado productivo confirmado:

```text
public.training_cycles no existe en Produccion.
```

Consecuencia:

- No se puede activar feature flag productiva.
- No se puede habilitar UI productiva de Training Cycles.
- No corresponde ejecutar postchecks funcionales de ciclos.
- Se requiere una fase separada para preparar la aplicacion controlada de la migracion productiva.

## 2. Objetivo de Fase 2.2J

Preparar el plan operativo para una futura aplicacion controlada de la migracion productiva:

```text
supabase/migrations/20260531_training_cycles.sql
```

Esta fase es solo preparacion documental. No autoriza ejecutar Produccion, aplicar migracion ni activar feature flag productiva.

## 3. Alcance permitido

- Revisar el SQL exacto de la migracion.
- Documentar impacto esperado.
- Preparar prechecks previos a la aplicacion.
- Preparar checklist de ejecucion futura.
- Preparar postchecks posteriores.
- Preparar estrategia de rollback/reversa.
- Preparar evidencia requerida para Arquitectura.

## 4. Alcance prohibido

- No aplicar migracion en Produccion.
- No ejecutar SQL productivo.
- No activar `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY`.
- No habilitar UI productiva.
- No modificar base de datos.
- No tocar Supabase Produccion.
- No tocar Vercel Produccion.
- No hacer redeploy.
- No modificar `training_sessions`.
- No modificar `exercise_entries`.
- No insertar ciclos.
- No crear datos iniciales.
- No hacer backfill.
- No modificar codigo funcional.

## 5. SQL exacto de migracion revisado

Archivo revisado:

```text
supabase/migrations/20260531_training_cycles.sql
```

Contenido revisado:

```sql
-- Fase 2.2J - Migracion productiva controlada para ciclos de Training.
-- Validada previamente en QA durante Fase 2.2C.
-- No toca public.training_sessions.
-- No toca public.exercise_entries.
-- No migra localStorage.
-- No crea datos iniciales.
--
-- Rollback conceptual, no ejecutar aqui:
-- 1. drop policy if exists ... on public.training_cycles;
-- 2. drop trigger if exists training_cycles_set_updated_at on public.training_cycles;
-- 3. drop index if exists training_cycles_one_active_per_user_idx;
-- 4. drop index if exists training_cycles_user_deleted_at_idx;
-- 5. drop index if exists training_cycles_user_created_idx;
-- 6. drop index if exists training_cycles_user_status_idx;
-- 7. drop table if exists public.training_cycles;

create table if not exists public.training_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cycle_number integer not null check (cycle_number > 0),
  cycle_type text null,
  goal text null,
  started_at timestamptz not null,
  ended_at timestamptz null,
  status text not null check (status in ('active', 'completed', 'cancelled')),
  plan_snapshot jsonb not null default '{}'::jsonb,
  summary_snapshot jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists training_cycles_user_status_idx
  on public.training_cycles(user_id, status);

create index if not exists training_cycles_user_created_idx
  on public.training_cycles(user_id, created_at);

create index if not exists training_cycles_user_deleted_at_idx
  on public.training_cycles(user_id, deleted_at);

create unique index if not exists training_cycles_one_active_per_user_idx
  on public.training_cycles(user_id)
  where status = 'active' and deleted_at is null;

drop trigger if exists training_cycles_set_updated_at on public.training_cycles;

create trigger training_cycles_set_updated_at
  before update on public.training_cycles
  for each row execute function public.set_updated_at();

alter table public.training_cycles enable row level security;

drop policy if exists "training cycles select own rows" on public.training_cycles;
create policy "training cycles select own rows" on public.training_cycles
  for select
  using (auth.uid() = user_id);

drop policy if exists "training cycles insert own rows" on public.training_cycles;
create policy "training cycles insert own rows" on public.training_cycles
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "training cycles update own rows" on public.training_cycles;
create policy "training cycles update own rows" on public.training_cycles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No se crea policy de delete para authenticated.
-- No se agregan grants explicitos porque el repo no los define para tablas existentes con RLS.
```

## 6. Resultado de revision del SQL

Confirmaciones:

- Crea `public.training_cycles`.
- Crea las columnas esperadas.
- Crea indices esperados.
- Crea unique partial index para un solo ciclo `active` por usuario.
- Habilita RLS.
- Crea policies de select, insert y update para filas propias.
- No crea policy de delete.
- Crea trigger `training_cycles_set_updated_at`.
- Reutiliza `public.set_updated_at()`.
- No toca `training_sessions`.
- No toca `exercise_entries`.
- No inserta datos.
- No hace backfill.
- No modifica rutinas, ejercicios, sesiones ni entries existentes.

Observacion tecnica:

- El SQL contiene `drop trigger if exists` y `drop policy if exists` para idempotencia sobre `public.training_cycles`.
- En el estado productivo confirmado, `public.training_cycles` no existe, por lo que esos drops no deberian afectar objetos productivos existentes fuera de la tabla nueva.
- La columna `user_id` usa `references auth.users(id) on delete cascade`; si un usuario es eliminado desde `auth.users`, sus ciclos asociados se eliminaran en cascada. No hay impacto sobre `training_sessions` ni `exercise_entries`.

## 7. Checklist de impacto esperado

Impacto esperado:

```text
+ public.training_cycles
+ indices training_cycles
+ policies training_cycles
+ trigger updated_at
```

Impacto esperado sobre datos existentes:

```text
0 cambios
```

No se espera ningun cambio en:

- `training_sessions`.
- `exercise_entries`.
- `routines`.
- `exercises`.
- datos de usuarios.
- historial de sesiones.
- entries existentes.

## 8. Prechecks previos a ejecutar antes de aplicar migracion

Prechecks obligatorios, solo read-only:

- Confirmar proyecto Supabase Produccion.
- Confirmar que `public.training_cycles` no existe.
- Confirmar existencia de `public.set_updated_at()`.
- Confirmar baseline de `training_sessions`.
- Confirmar baseline de `exercise_entries`.
- Confirmar feature flag productiva en `false`.
- Confirmar que fallback legacy esta disponible.
- Confirmar que no hay cambios de schema/RLS/RPC pendientes.
- Confirmar que no hay deploys productivos en curso.
- Confirmar responsable de ejecucion.
- Confirmar responsable de validacion.
- Confirmar responsable de rollback.

Si un precheck falla, no aplicar migracion.

## 9. Checklist de ejecucion productiva futura

Orden futuro propuesto, no ejecutar en esta fase:

1. Confirmar aprobacion explicita de Arquitectura para aplicar migracion.
2. Confirmar proyecto Supabase Produccion.
3. Ejecutar prechecks read-only.
4. Guardar evidencia pre-migracion.
5. Aplicar exclusivamente `supabase/migrations/20260531_training_cycles.sql` mediante Supabase CLI sobre el proyecto de Produccion, usando el flujo oficial de migraciones del repositorio y garantizando ejecucion atomica/transaccional.
6. No activar feature flag productiva.
7. No habilitar UI productiva.
8. Ejecutar postchecks.
9. Guardar evidencia post-migracion.
10. Enviar resultados a Claude y Arquitectura.

Metodo de aplicacion requerido:

- Aplicar de forma atomica.
- Usar Supabase CLI sobre el proyecto de Produccion.
- Usar el flujo oficial de migraciones del repositorio.
- Garantizar trazabilidad y registro en historial de migraciones.
- No aplicar via SQL Editor manual sin transaccion explicita y sin aprobacion separada de Arquitectura.
- La ejecucion productiva de esta migracion requerira una aprobacion explicita posterior.

Si el metodo final elegido no es Supabase CLI, debe documentarse previamente como se garantiza:

- atomicidad;
- trazabilidad;
- registro en historial de migraciones;
- rollback/reversa.

## 10. Postchecks posteriores a migracion

Postchecks obligatorios, solo read-only:

- Confirmar que `public.training_cycles` existe.
- Confirmar columnas.
- Confirmar indices.
- Confirmar RLS activo.
- Confirmar policies select/insert/update.
- Confirmar ausencia de delete policy.
- Confirmar grants/permisos efectivos de tabla para `authenticated`, complementarios a RLS.
- Confirmar trigger `updated_at`.
- Confirmar funcion `public.set_updated_at()`.
- Confirmar conteo `training_cycles = 0`.
- Confirmar baseline `training_sessions` sin cambios.
- Confirmar baseline `exercise_entries` sin cambios.
- Confirmar feature flag productiva sigue en `false`.
- Confirmar que fallback legacy sigue activo.
- Confirmar que helper QA no queda accesible en Produccion.

## 10.1 Queries read-only de apoyo

Estas queries son solo para prechecks/postchecks manuales. No ejecutarlas desde Codex sin autorizacion explicita.

### Historial de migraciones Supabase

```sql
select
  name,
  executed_at
from supabase_migrations.schema_migrations
where name like '%training_cycles%';
```

### Grants/permisos efectivos de `training_cycles`

Este check valida permisos efectivos de tabla, complementarios a RLS. Si el proyecto usa grants heredados o el patron estandar del repositorio, debe quedar verificado en postchecks.

```sql
select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'training_cycles'
order by grantee, privilege_type;
```

## 11. Estrategia de rollback/reversa

Rollback/reversa no se ejecuta en esta fase.

Estrategia:

- Si la migracion falla antes de completarse, abortar y no continuar.
- Si se crea `training_cycles` pero falla un postcheck critico, no activar feature flag.
- Mantener fallback legacy.
- No tocar `training_sessions`.
- No tocar `exercise_entries`.
- No insertar ni borrar ciclos.
- Reversa DB solo con aprobacion explicita de Arquitectura.
- Si se requiere reversa DB, preparar plan separado con evidencia, backup y ventana controlada.

Prioridad:

1. Mantener feature flag productiva en `false`.
2. Mantener fallback legacy.
3. Investigar causa del fallo.
4. Solicitar aprobacion separada para reversa DB si fuera necesario.

## 12. Criterios de exito

La aplicacion futura de migracion sera exitosa si:

- `public.training_cycles` existe.
- Columnas esperadas existen.
- Indices esperados existen.
- Unique partial index existe.
- RLS esta activo.
- Policies select/insert/update existen.
- No existe delete policy para frontend.
- Trigger `updated_at` existe.
- `public.set_updated_at()` existe.
- `training_cycles` queda con 0 filas.
- Baseline `training_sessions` no cambia.
- Baseline `exercise_entries` no cambia.
- Feature flag productiva sigue en `false`.
- UI productiva no queda habilitada.
- Evidencia queda guardada.

## 13. Criterios de aborto

Abortar si:

- No hay aprobacion explicita de Arquitectura.
- El proyecto Supabase no es claramente Produccion.
- `public.training_cycles` ya existe y no hay plan para comparar estado.
- `public.set_updated_at()` no existe.
- Baseline `training_sessions` no puede registrarse.
- Baseline `exercise_entries` no puede registrarse.
- Feature flag productiva aparece activa.
- Fallback legacy no esta disponible.
- La revision de diseno detecta que la migracion tocaria `training_sessions`.
- La revision de diseno detecta que la migracion tocaria `exercise_entries`.
- La revision de diseno detecta que la migracion insertaria datos.
- La revision de diseno detecta que la migracion haria backfill.
- Postchecks fallan.

## 14. Evidencia requerida

- Resultado precheck de existencia de `training_cycles`.
- Resultado precheck de `public.set_updated_at()`.
- Baseline `training_sessions` antes/despues.
- Baseline `exercise_entries` antes/despues.
- Evidencia de columnas.
- Evidencia de indices.
- Evidencia de RLS.
- Evidencia de policies.
- Evidencia de grants/permisos efectivos.
- Evidencia de trigger.
- Conteo `training_cycles = 0`.
- Confirmacion de feature flag productiva en `false`.
- Confirmacion de fallback legacy.
- Hora inicio/fin.
- Responsable de ejecucion.
- Responsable de validacion.
- Aprobacion de Arquitectura.

La evidencia debe compartirse sanitizada si contiene logica interna de RLS o detalles de schema no publicos.

## 15. Responsables requeridos

Completar antes de solicitar ejecucion:

- Responsable de ejecucion:
- Responsable de validacion:
- Responsable de rollback:
- Responsable de aprobacion:
- Canal de comunicacion:

Sin responsables definidos, no aplicar migracion.

## 16. Estado de feature flag

`NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY` debe mantenerse en:

```text
false
```

Reglas:

- No activar durante la aplicacion de migracion.
- No activar aunque los postchecks pasen.
- Requerir fase separada para habilitar UI productiva.
- No reutilizar `NEXT_PUBLIC_ENABLE_QA_TOOLS` para Produccion.

## 17. Estado final esperado

Despues de una futura aplicacion aprobada de migracion:

- `public.training_cycles` existe.
- Tabla vacia: 0 filas.
- RLS y policies configuradas.
- Trigger `updated_at` configurado.
- Feature flag productiva en `false`.
- UI productiva no habilitada.
- Fallback legacy activo.
- `training_sessions` sin cambios.
- `exercise_entries` sin cambios.
- Evidencia lista para pedir siguiente aprobacion.

## 18. Solicitud futura a Arquitectura

Antes de ejecutar la migracion, enviar a Arquitectura:

- Este documento.
- Resultado de prechecks productivos read-only.
- Confirmacion de que `public.training_cycles` no existe.
- Confirmacion de que `public.set_updated_at()` existe.
- Baselines de `training_sessions` y `exercise_entries`.
- Confirmacion de feature flag en `false`.
- Responsables definidos.
- Ventana propuesta.

Solicitud futura esperada:

```text
Solicitamos autorizacion explicita para aplicar en Produccion exclusivamente la migracion supabase/migrations/20260531_training_cycles.sql, manteniendo NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false y sin habilitar UI productiva.
```
