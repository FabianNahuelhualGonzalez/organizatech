# Fase 2.2G - Plan de habilitacion productiva Training Cycles

## 1. Estado actual

- QA/Preview validado para `training_cycles`.
- UI principal conectada al repository en QA/Preview.
- RLS validado previamente en QA.
- UX de historial de ciclos validada en QA/Preview.
- Reload mantiene estado desde Supabase QA.
- `training_sessions` y `exercise_entries` no fueron modificadas por esta fase.
- Produccion sigue bloqueada.
- El feature flag productivo aun no existe ni esta habilitado.
- El helper QA existe y debe mantenerse bloqueado en Produccion.
- El fallback legacy sigue activo.

Este documento es solo un plan operativo. No autoriza ejecucion productiva.

## 2. Alcance de una futura ventana productiva

Una ventana productiva futura podria incluir, solo con aprobacion explicita:

- Aplicar o verificar la migracion `training_cycles` en Produccion.
- Confirmar estructura de tabla, RLS, policies, indices y trigger.
- Confirmar variables productivas en Vercel.
- Habilitar el repository de ciclos en UI productiva mediante feature flag productiva separada.
- Ejecutar postchecks funcionales y de seguridad.
- Mantener fallback legacy disponible durante la ventana.

Fuera de alcance para este plan:

- Ejecutar SQL desde Codex.
- Tocar Supabase.
- Tocar Produccion.
- Tocar Vercel.
- Modificar `training_sessions`.
- Modificar `exercise_entries`.
- Crear migraciones nuevas.

## 3. Migracion pendiente en Produccion

Antes de habilitar Training Cycles en Produccion, se debe revisar o aplicar:

```text
supabase/migrations/20260531_training_cycles.sql
```

Validaciones obligatorias:

- `public.training_cycles` existe.
- Columnas esperadas existen:
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
- `user_id` referencia `auth.users(id)`.
- `status` permite solo `active`, `completed`, `cancelled`.
- RLS esta habilitada.
- Existen policies para:
  - select own cycles.
  - insert own cycles.
  - update own cycles.
- No existe policy de delete para frontend.
- Existen indices:
  - `training_cycles_user_status_idx`
  - `training_cycles_user_created_idx`
  - `training_cycles_user_deleted_at_idx`
  - `training_cycles_one_active_per_user_idx`
- El unique partial index impide mas de un ciclo `active` por usuario cuando `deleted_at is null`.
- Trigger `updated_at` funciona.

Si cualquiera de estas validaciones falla, no habilitar Produccion.

## 4. Feature flag productiva

El gating actual de QA/Preview usa:

```text
VERCEL_ENV === "preview"
NEXT_PUBLIC_ENABLE_QA_TOOLS === "true"
NEXT_PUBLIC_SUPABASE_ENV === "qa"
```

Produccion no debe usar ese gating.

Estrategia productiva futura recomendada:

- Mantener Produccion bloqueada mientras no exista un flag productivo explicito.
- Crear una variable separada, por ejemplo:

```text
NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=true
```

- No reutilizar `NEXT_PUBLIC_ENABLE_QA_TOOLS` para Produccion.
- No habilitar repository productivo por inferencia de ambiente.
- Requerir aprobacion final de Arquitectura antes de activar el flag.
- Mantener el helper QA inaccesible en Produccion.

La decision del nombre final del flag queda pendiente.

## 5. Checklist previo a Produccion

Antes de cualquier habilitacion productiva:

- Confirmar proyecto Supabase Produccion.
- Confirmar proyecto Vercel Produccion.
- Confirmar que no hay deploys en curso.
- Confirmar backup logico recomendado de tablas relacionadas:
  - `training_cycles`, si existe.
  - `training_sessions`.
  - `exercise_entries`.
  - `routines`.
  - `exercises`.
- Confirmar si la migracion `20260531_training_cycles.sql` ya fue aplicada o sigue pendiente.
- Confirmar estructura exacta de `public.training_cycles`.
- Confirmar RLS activa.
- Confirmar policies select/insert/update.
- Confirmar ausencia de delete policy para frontend.
- Confirmar unique partial index de ciclo activo por usuario.
- Confirmar trigger `updated_at`.
- Confirmar fallback legacy activo.
- Confirmar rollback funcional/UI.
- Confirmar variables Vercel.
- Confirmar que `NEXT_PUBLIC_ENABLE_QA_TOOLS` no habilita nada en Produccion.
- Confirmar que helper QA no queda accesible en Produccion.
- Confirmar que la habilitacion no toca `training_sessions`.
- Confirmar que la habilitacion no toca `exercise_entries`.
- Confirmar plan de monitoreo.
- Confirmar responsables de ejecucion, validacion y rollback.

Sin aprobacion explicita final, no ejecutar.

## 6. Rollback funcional/UI

Rollback recomendado ante error funcional:

- Desactivar feature flag productiva.
- Volver al fallback legacy.
- Redeploy si corresponde.
- No borrar `training_cycles`.
- No eliminar datos generados.
- No tocar `training_sessions`.
- No tocar `exercise_entries`.
- Guardar evidencia del error y del rollback.

Este rollback debe ser la primera opcion porque minimiza riesgo de perdida de datos.

## 7. Rollback de base de datos

Rollback DB queda solo conceptual en esta fase.

Reglas:

- No borrar tabla si ya existen datos productivos sin decision formal.
- Preferir rollback funcional antes que rollback DB.
- Si se requiere rollback DB, preparar plan separado.
- Ese plan debe incluir backup, impacto, aprobacion Arquitectura y ventana controlada.
- No preparar ni ejecutar script destructivo en esta fase.

## 8. Postchecks productivos

Postchecks minimos despues de habilitar, si una futura ventana lo aprueba:

- Usuario real crea ciclo activo.
- Segundo ciclo `active` queda bloqueado.
- Usuario real finaliza ciclo.
- Historial muestra el ciclo finalizado.
- Reload mantiene ciclo activo/historial.
- Logout/login mantiene historial.
- Usuario B no ve ciclos de Usuario A.
- Usuario B puede crear su propio ciclo.
- Produccion no muestra ni permite helper QA.
- UI mobile no presenta errores visuales.
- No hay errores RLS en cliente.
- No hay errores relevantes en logs.
- `training_sessions` sin cambios inesperados.
- `exercise_entries` sin cambios inesperados.
- Fallback legacy sigue disponible.

## 9. Criterios de aborto

Abortar si:

- `training_cycles` no existe.
- `training_cycles` difiere del esquema esperado.
- RLS no esta activa.
- Falta unique active index.
- Policies son incorrectas.
- Existe delete policy accesible desde frontend.
- Helper QA queda accesible en Produccion.
- Feature flag productiva no esta claramente definida.
- Fallback legacy no funciona.
- Aparecen errores RLS.
- Aparecen errores de UI.
- Aparecen escrituras inesperadas en `training_sessions`.
- Aparecen escrituras inesperadas en `exercise_entries`.
- No hay backup logico cuando se requiera.
- No hay aprobacion explicita final.

## 10. Evidencia a guardar

- Capturas o export de variables Vercel relevantes.
- Capturas o resultados de checks Supabase.
- Resultado de postchecks.
- Logs anonimizados.
- Commit o PR asociado.
- Hora de inicio y cierre de ventana.
- Responsable de ejecucion.
- Responsable de validacion.
- Confirmacion de fallback legacy.
- Aprobacion explicita de Arquitectura.

No publicar datos sensibles.

## 11. Decisiones pendientes

- Nombre final del feature flag productivo.
- Si la migracion productiva se aplica manualmente o por pipeline.
- Ventana horaria.
- Responsable de ejecucion.
- Responsable de validacion funcional.
- Responsable de rollback.
- Si se mantiene helper QA o se elimina despues.
- Cuanto tiempo se mantiene fallback legacy.
- Criterio para retirar fallback legacy.

## Recomendacion final

Avanzar solo a preparacion de ventana productiva cuando Arquitectura apruebe explicitamente:

- migracion productiva o verificacion de migracion;
- nombre y alcance del feature flag productivo;
- checklist de postchecks;
- rollback funcional/UI;
- responsables y ventana.

Hasta entonces, Produccion permanece bloqueada y este documento no autoriza ejecucion.
