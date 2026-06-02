# Fase 2.2Q - Reconciliacion post-ejecucion del historial de migraciones

Nota de alcance:

En este documento, "reconciliacion" significa planificacion y evaluacion de alternativas para reconciliar el historial. En esta fase no se ejecuto ninguna accion de regularizacion, no se modifico historial remoto y no se hicieron cambios en Produccion.

## 1. Contexto

La Fase 2.2P - Ejecucion productiva controlada del script aislado Training Cycles fue cerrada correctamente.

Estado confirmado:

```text
Fase 2.2P: cerrada completamente
Commit remoto cierre 2.2P: bfa29d9
training_cycles: creada en Produccion
training_cycles_count: 0
Feature flag: OFF
Vercel: sin tocar
UI productiva: bloqueada
```

La tabla `public.training_cycles` fue creada exitosamente mediante el script aislado:

```text
supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
```

Artefacto autorizado:

```text
commit eb5cfb1
```

La ejecucion no uso `supabase db push` y no regularizo el historial CLI.

## 2. Estado actual esperado

Estado esperado despues de Fase 2.2P:

- `public.training_cycles` existe en Produccion.
- `public.training_cycles` esta vacia.
- `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY` sigue OFF / no activa.
- Vercel no fue tocado.
- UI productiva sigue bloqueada.
- Fallback legacy sigue activo.
- `supabase/migrations/20260531_training_cycles.sql` sigue existiendo en el repo.
- `supabase/diagnostics/202606_training_cycles_isolated_production_script.sql` esta versionado como evidencia de ejecucion aislada.
- El historial CLI no fue regularizado.
- `supabase/.temp/` es metadata local y no debe versionarse.

Archivos locales de migracion existentes:

```text
supabase/migrations/20260513_add_exercise_day.sql
supabase/migrations/20260527_legacy_training_diagnostics.sql
supabase/migrations/20260527_training_sessions_source_of_truth.sql
supabase/migrations/20260531_training_cycles.sql
```

## 3. Problema a resolver

El problema posterior a la ejecucion aislada es de trazabilidad e historial:

- `public.training_cycles` ya existe en Produccion.
- La migracion original `supabase/migrations/20260531_training_cycles.sql` sigue en `supabase/migrations/`.
- El historial CLI/local-remoto estaba desfasado antes de la ejecucion.
- Si alguien ejecuta `supabase db push` en el futuro, Supabase CLI compararia todas las migraciones locales contra el historial remoto y podria aplicar en orden todas las que no esten registradas.
- El riesgo no se limita a `20260531_training_cycles.sql`; incluye las cuatro migraciones locales cuyo historial no esta regularizado:
  - `20260513_add_exercise_day.sql`
  - `20260527_legacy_training_diagnostics.sql`
  - `20260527_training_sessions_source_of_truth.sql`
  - `20260531_training_cycles.sql`
- Se debe evitar duplicidad, confusion operativa o intentos de aplicar de nuevo una migracion cuyo efecto ya existe.
- Se debe decidir como documentar o reconciliar que `training_cycles` fue aplicada fuera del flujo CLI.

La migracion `20260531_training_cycles.sql` es mayormente idempotente porque usa mecanismos como:

```text
CREATE TABLE IF NOT EXISTS
CREATE INDEX IF NOT EXISTS
DROP TRIGGER IF EXISTS
DROP POLICY IF EXISTS
```

Si esa migracion se aplicara de forma verdaderamente aislada, el riesgo inmediato seria bajo y reversible. El riesgo principal de `supabase db push` viene del conjunto completo de migraciones locales pendientes, especialmente las migraciones `20260527`, porque involucran `training_sessions`, que esta explicitamente protegida.

Esta fase no autoriza regularizacion ni cambios remotos; solo prepara opciones y recomendacion.

## 4. Opciones de reconciliacion

### Opcion A - Mantener bloqueo de `supabase db push` y documentar estado

Descripcion:

- Mantener prohibido `supabase db push`.
- Mantener el estado documentado en 2.2P y 2.2Q.
- Requerir revision manual antes de cualquier operacion futura de migraciones.

Ventajas:

- No toca Produccion.
- No modifica historial remoto.
- Riesgo operativo inmediato bajo.
- Mantiene trazabilidad documental completa.

Desventajas:

- La deuda tecnica permanece.
- Futuras operaciones de migracion siguen bloqueadas o requieren revision especial.
- No resuelve la discrepancia entre `supabase/migrations/` y estado productivo.

### Opcion B - Preparar `supabase migration repair --status applied`

Descripcion:

Preparar una fase futura, separada y aprobada, para marcar como aplicada la migracion correspondiente:

```bash
supabase migration repair --status applied <migration_id>
```

Condiciones:

- Solo con aprobacion futura de Arquitectura.
- Solo despues de confirmar read-only que `public.training_cycles` existe y coincide con el artefacto.
- Solo despues de confirmar que no se arrastran otras migraciones antiguas.
- Solo si se entiende exactamente que historial remoto sera modificado.

Ventajas:

- Reconciliaria el historial CLI.
- Reduciria riesgo de que `db push` intente aplicar 20260531 en el futuro.
- Mantiene `supabase/migrations/20260531_training_cycles.sql` como migracion canonica.

Desventajas:

- Modifica historial remoto.
- Requiere extremo cuidado con el `migration_id`.
- No debe usarse para ocultar diferencias.
- No resuelve por si sola otras migraciones antiguas si siguen desfasadas.

### Opcion C - Mover o reclasificar `20260531_training_cycles.sql`

Descripcion:

Mover o reclasificar la migracion original fuera de `supabase/migrations/`, o marcarla de otra forma en el repo, solo si Arquitectura lo aprueba.

Ventajas:

- Evita que `supabase db push` la vea como migracion pendiente.
- Reduce posibilidad de reaplicacion accidental por CLI.

Desventajas:

- Cambia historia del repo.
- Puede degradar trazabilidad canonical de la migracion.
- Requiere decision explicita sobre como representar que el schema ya fue aplicado.
- Podria ser confuso si en QA la migracion si fue aplicada por flujo normal.

### Opcion D - Mantener migracion original como referencia historica y depender del script aislado como evidencia ejecutada

Descripcion:

Mantener:

- `supabase/migrations/20260531_training_cycles.sql` como referencia canonical original.
- `supabase/diagnostics/202606_training_cycles_isolated_production_script.sql` como evidencia del metodo productivo ejecutado.
- Documentos 2.2N, 2.2P y 2.2Q como trazabilidad operativa.

Ventajas:

- No modifica repo ni historial remoto.
- Preserva contexto completo.
- Evita decisiones apresuradas de repair o movimiento.

Desventajas:

- No elimina el riesgo de `db push` futuro.
- Requiere que todo operador conozca el bloqueo.
- Sigue existiendo una discrepancia entre artefacto de migrations y estado productivo.

### Opcion E - Regularizacion integral del historial de migraciones

Descripcion:

Abrir una fase futura mas amplia para reconciliar todo el set de migraciones locales/remotas, no solo `20260531`.

Incluye revisar:

- `20260513_add_exercise_day.sql`
- `20260527_legacy_training_diagnostics.sql`
- `20260527_training_sessions_source_of_truth.sql`
- `20260531_training_cycles.sql`

Ventajas:

- Ataca la causa raiz del bloqueo.
- Permite eventualmente recuperar un flujo CLI sano.
- Reduce deuda operacional a largo plazo.

Desventajas:

- Mayor alcance.
- Mayor riesgo.
- Requiere evidencia read-only detallada.
- Requiere aprobacion explicita y probablemente fases adicionales.

### Opcion F - Consulta read-only del historial remoto como paso previo

Descripcion:

Ejecutar solo una inspeccion read-only del estado remoto de migraciones antes de decidir cualquier regularizacion.

Alcance:

- Consultar estado remoto del historial, si Arquitectura lo autoriza.
- No ejecutar `supabase db push`.
- No ejecutar `supabase migration repair`.
- No modificar historial remoto.
- No modificar base de datos.

Ventajas:

- Mejora evidencia antes de decidir.
- Reduce incertidumbre sobre el estado remoto real.
- Puede informar si conviene repair selectivo, regularizacion integral o mantener bloqueo.

Desventajas:

- No resuelve por si sola la deuda.
- Requiere autorizacion operacional para consultar remoto.
- Debe cuidarse no exponer secretos ni connection strings.

## 5. Riesgos por opcion

| Opcion | Riesgo principal | Riesgo residual |
| --- | --- | --- |
| A - Mantener bloqueo | Deuda permanece | Futuras migraciones siguen bloqueadas |
| B - Migration repair | Modificar historial remoto incorrectamente | Otras migraciones pueden seguir desfasadas |
| C - Mover/reclasificar migracion | Perder trazabilidad canonical | Confusion entre QA, repo y Produccion |
| D - Mantener referencia historica | Riesgo de db push futuro | Requiere disciplina documental |
| E - Regularizacion integral | Alcance mas amplio y complejo | Requiere varias aprobaciones |
| F - Consulta read-only remota | Evidencia incompleta si permisos son limitados | No resuelve la deuda por si sola |

## 6. Recomendacion TI preliminar

Recomendacion preliminar:

1. Mantener bloqueado `supabase db push` por ahora.
2. No ejecutar `supabase migration repair` en esta fase.
3. No mover ni reclasificar `20260531_training_cycles.sql` todavia.
4. Documentar 2.2P como evidencia de ejecucion productiva aislada.
5. Preparar una fase futura especifica para regularizacion del historial, evaluando primero si conviene:
   - repair selectivo de `20260531`, o
   - regularizacion integral del historial completo.
6. Mantener feature flag OFF hasta Fase 2.2R.
7. Antes de cualquier regularizacion, considerar una consulta read-only del historial remoto como paso previo.

Recomendacion tecnica:

```text
Adoptar temporalmente Opcion A + Opcion D, y preparar una fase futura controlada para evaluar Opcion B u Opcion E.
```

Motivo:

- Ya existe `public.training_cycles` en Produccion.
- La UI productiva sigue bloqueada.
- No hay urgencia tecnica para modificar historial remoto antes de habilitar la UI.
- Cualquier `migration repair` debe ser una fase separada con evidencia y aprobacion.
- Un `migration repair` selectivo solo sobre `20260531` no habilita `supabase db push` mientras las otras tres migraciones locales sigan sin regularizar.

## 7. Criterios de aborto

Abortar cualquier accion futura si:

- Se intenta ejecutar `supabase migration repair` sin aprobacion explicita.
- Se intenta ejecutar `supabase db push`.
- Se intenta tocar Supabase remoto en esta fase documental.
- Se intenta tocar Vercel.
- Se intenta activar feature flag.
- Se intenta modificar base de datos.
- Se intenta modificar `training_sessions`.
- Se intenta modificar `exercise_entries`.
- Se intenta mover migraciones sin aprobacion de Arquitectura.
- Hay dudas sobre el estado real de `public.training_cycles`.

## 8. Evidencia requerida antes de cualquier accion futura

Antes de cualquier accion de reconciliacion real, reunir:

- Confirmacion read-only de que `public.training_cycles` existe.
- Confirmacion read-only de que `public.training_cycles` sigue vacia o documentar filas existentes.
- Confirmacion de script ejecutado:
  `supabase/diagnostics/202606_training_cycles_isolated_production_script.sql`.
- Confirmacion de artefacto `eb5cfb1`.
- Confirmacion de cierre `bfa29d9`.
- Estado actual de migraciones locales.
- Estado remoto de migraciones, si se consulta, solo read-only.
- Confirmacion de feature flag OFF.
- Confirmacion de Vercel sin cambios.
- Confirmacion de UI productiva bloqueada.

La evidencia debe estar sanitizada y no debe incluir secretos, tokens, passwords, connection strings, service role keys ni datos personales.

## 9. Proximo paso recomendado para Arquitectura

Arquitectura debe decidir si:

1. Mantiene bloqueo de historial por ahora y avanza a Fase 2.2R con feature flag controlada.
2. Solicita una fase de regularizacion selectiva de `20260531`.
3. Solicita una fase de regularizacion integral de migraciones antiguas.
4. Solicita mover/reclasificar artefactos del repositorio.
5. Solicita una fase de consulta read-only del historial remoto como paso previo.

Recomendacion TI:

```text
Mantener bloqueo de db push y migration repair, no tocar historial remoto todavia, y preparar decision separada antes de cualquier regularizacion real.
```

Este documento no autoriza `supabase db push`, `supabase migration repair`, cambios remotos, Vercel, feature flags ni modificaciones de base de datos.
