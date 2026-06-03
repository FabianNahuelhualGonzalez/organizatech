# Fase 2.2N - Script aislado para Training Cycles

## 1. Objetivo

Preparar un script aislado para aplicar exclusivamente el contenido funcional de:

```text
supabase/migrations/20260531_training_cycles.sql
```

sin usar `supabase db push` y sin arrastrar migraciones antiguas pendientes o desfasadas.

Esta fase es solo preparatoria. No autoriza ejecucion productiva.

## 2. Archivo preparado

Script aislado:

```text
supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
```

El script esta fuera de `supabase/migrations/` para evitar que participe del flujo automatico de migraciones del CLI.

## 3. Justificacion para no usar `supabase db push`

`supabase migration list --linked` mostro migraciones locales sin registro remoto visible:

```text
Local     Remote     Time (UTC)
20260513             20260513
20260527             20260527
20260527             20260527
20260531             20260531
```

Por ese motivo, `supabase db push` no es seguro para Fase 2.2K-R/N, porque podria intentar aplicar mas de una migracion:

- `20260513_add_exercise_day.sql`
- `20260527_legacy_training_diagnostics.sql`
- `20260527_training_sessions_source_of_truth.sql`
- `20260531_training_cycles.sql`

La validacion 2.2M concluyo:

- `20260513_add_exercise_day.sql` parece aplicada de facto.
- `20260527_training_sessions_source_of_truth.sql` parece aplicada de facto.
- `20260527_legacy_training_diagnostics.sql` no corresponde como migracion productiva ordinaria.
- `20260531_training_cycles.sql` no esta aplicada.

Hasta que el historial quede regularizado, el metodo seguro debe aislar la ejecucion de `training_cycles`.

## 4. Alcance permitido futuro

El script aislado solo prepara la creacion de:

- `public.training_cycles`
- indices asociados
- unique partial index para un ciclo activo por usuario
- trigger `training_cycles_set_updated_at`
- RLS
- policies select, insert y update

## 5. Alcance prohibido

El script no debe:

- modificar `public.training_sessions`
- modificar `public.exercise_entries`
- insertar datos
- hacer backfill
- activar feature flag
- tocar Vercel
- hacer redeploy
- usar `supabase db push`
- ejecutar `supabase migration repair`

## 6. Prechecks abortivos

El script aborta si:

- `public.training_cycles` ya existe.
- `public.set_updated_at()` no existe o no es unica.
- El baseline de `training_sessions` no coincide:
  - total: 36
  - activas: 11
  - soft-deleted: 25
- El baseline de `exercise_entries` no coincide:
  - total: 78
  - distinct session count: 11

Estos prechecks son intencionalmente conservadores para evitar aplicar schema nuevo si el estado productivo cambio antes de la ventana.

## 7. Contenido funcional aplicado

El script crea:

```text
public.training_cycles
```

Columnas:

- `id`
- `user_id`
- `name`
- `cycle_number`
- `cycle_type`
- `goal`
- `started_at`
- `ended_at`
- `status`
- `plan_snapshot`
- `summary_snapshot`
- `created_at`
- `updated_at`
- `deleted_at`

Indices:

- `training_cycles_user_status_idx`
- `training_cycles_user_created_idx`
- `training_cycles_user_deleted_at_idx`
- `training_cycles_one_active_per_user_idx`

Trigger:

- `training_cycles_set_updated_at`

Policies:

- `"training cycles select own rows"`
- `"training cycles insert own rows"`
- `"training cycles update own rows"`

No crea policy de delete.

## 8. Postchecks

El script valida despues de crear objetos:

- `public.training_cycles` existe.
- `public.training_cycles` tiene 0 filas.
- Existen 14 columnas esperadas.
- Existen 5 indices esperados, incluyendo primary key.
- RLS esta habilitado.
- Existen 3 policies para select, insert y update.
- No existe policy de delete.
- Existe trigger `training_cycles_set_updated_at`.
- Baseline de `training_sessions` permanece:
  - total: 36
  - activas: 11
  - soft-deleted: 25
- Baseline de `exercise_entries` permanece:
  - total: 78
  - distinct session count: 11

Si un postcheck falla dentro de la transaccion, la ejecucion debe abortar y no debe activarse feature flag.

## 9. Reversa / rollback documentado

La reversa DB no debe ejecutarse sin aprobacion explicita separada de Arquitectura.

Como `training_cycles` debe crearse vacia y la feature flag debe seguir desactivada, la reversa conceptual antes de generar datos productivos seria:

```sql
begin;

drop policy if exists "training cycles update own rows" on public.training_cycles;
drop policy if exists "training cycles insert own rows" on public.training_cycles;
drop policy if exists "training cycles select own rows" on public.training_cycles;
drop trigger if exists training_cycles_set_updated_at on public.training_cycles;
drop index if exists training_cycles_one_active_per_user_idx;
drop index if exists training_cycles_user_deleted_at_idx;
drop index if exists training_cycles_user_created_idx;
drop index if exists training_cycles_user_status_idx;
drop table if exists public.training_cycles;

rollback; -- cambiar a commit solo con aprobacion explicita de rollback DB
```

Si `training_cycles` ya contiene datos productivos, no se debe ejecutar rollback DB sin plan separado, backup y decision de Arquitectura.

Rollback funcional/UI:

- Mantener `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false`.
- No hacer redeploy de habilitacion.
- Mantener fallback legacy.
- No tocar `training_sessions`.
- No tocar `exercise_entries`.

## 10. Evidencia esperada

Antes de ejecucion:

- Confirmacion de Arquitectura.
- Auditoria Claude aprobada para Fase 2.2N y Script B.
- Confirmacion de que `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false`.
- Baseline `training_sessions`.
- Baseline `exercise_entries`.
- Confirmacion de que `public.training_cycles` no existe.
- Confirmacion de que `public.set_updated_at()` existe.

Despues de ejecucion:

- `public.training_cycles` existe.
- `training_cycles` tiene 0 filas.
- Columnas esperadas OK.
- Indices esperados OK.
- RLS habilitado.
- Policies select/insert/update OK.
- Sin policy delete.
- Trigger `updated_at` OK.
- Baseline `training_sessions` sin cambios.
- Baseline `exercise_entries` sin cambios.
- Feature flag productiva sigue en false.
- Vercel sin cambios.

## 11. Confirmacion de impacto

Impacto esperado:

```text
+ public.training_cycles
+ indices training_cycles
+ RLS training_cycles
+ policies training_cycles
+ trigger training_cycles_set_updated_at
```

Impacto esperado sobre datos existentes:

```text
training_sessions: 0 cambios
exercise_entries: 0 cambios
routines: 0 cambios
exercises: 0 cambios
datos iniciales: 0
backfill: 0
```

## 12. Riesgos

- Ejecutar el script sin verificar baseline podria aplicar schema sobre un estado productivo cambiado.
- Ejecutar rollback DB despues de crear datos productivos podria causar perdida de historial de ciclos.
- Activar feature flag antes de postchecks podria exponer UI sobre schema incompleto.
- Usar `supabase db push` en vez del script aislado podria arrastrar migraciones antiguas.
- Usar un script fuera de `supabase/migrations/` deja una deuda de trazabilidad que debe planificarse como fase posterior.

Mitigacion de trazabilidad:

- Planificar una fase posterior especifica, por ejemplo Fase 2.2Q - Reconciliacion post-ejecucion del historial de migraciones.
- Esa fase posterior debe definir como registrar, documentar o regularizar el estado historico despues de ejecutar el script aislado.
- Esta planificacion no autoriza `supabase migration repair` ahora.
- Esta planificacion no autoriza `supabase db push`.
- Esta planificacion no autoriza modificar historial en Fase 2.2N.

## 13. Criterios de aborto

Abortar si:

- Arquitectura no aprueba ejecucion.
- Aparecen nuevas observaciones bloqueantes sobre el script.
- `public.training_cycles` ya existe.
- `public.set_updated_at()` no existe.
- Baseline `training_sessions` difiere.
- Baseline `exercise_entries` difiere.
- El script intenta tocar `training_sessions` o `exercise_entries` fuera de SELECT.
- La feature flag productiva esta activa.
- Vercel requiere cambios.
- Se detecta riesgo de ejecutar migraciones antiguas.

## 14. Estado de auditoria Claude

La auditoria Claude de Fase 2.2N y del Script B ya fue realizada.

Veredicto:

```text
APROBADO - Listo para Arquitectura
```

No hay observaciones bloqueantes pendientes.

## 15. Proximo paso

Enviar a Arquitectura para decidir si:

1. Mantener bloqueo.
2. Ajustar el script aislado si Arquitectura lo solicita.
3. Autorizar una ventana productiva separada para ejecutar el script.
4. Planificar Fase 2.2Q - Reconciliacion post-ejecucion del historial de migraciones.

Este documento no autoriza ejecucion productiva, migracion, feature flag, cambios en Vercel ni cambios de datos.
