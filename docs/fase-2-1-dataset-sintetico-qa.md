# Fase 2.1D - Dataset sintetico QA para consolidacion legacy Training

## Objetivo

Preparar un dataset sintetico y controlado en Supabase QA para probar la consolidacion legacy de Training con el mismo patron observado en Produccion, sin copiar datos sensibles ni usar usuarios, emails, UUIDs o registros productivos.

Este dataset permite validar el script de consolidacion QA antes de cualquier decision productiva:

- 5 grupos legacy.
- 30 `training_sessions` legacy.
- 30 `exercise_entries`.
- 2 usuarios QA afectados.
- 5 grupos `consolidation_candidate`.
- 0 `orphan_entries`.
- 0 `ownership_issues`.
- 0 mezcla de rutinas.
- 0 mezcla de dias.

## Restricciones

- No ejecutar en Produccion.
- No copiar datos reales.
- No usar emails reales.
- No usar UUIDs productivos.
- No tocar Supabase Produccion.
- No mover estos archivos a `supabase/migrations`.
- No hacer backfill productivo.
- No ajustar el script de consolidacion al dataset QA actual.
- No ejecutar consolidacion sin auditoria Claude y aprobacion humana.

## Archivos

- `supabase/diagnostics/202605_training_legacy_synthetic_dataset_qa.sql`
- `supabase/diagnostics/202605_training_legacy_synthetic_dataset_qa_cleanup.sql`
- `supabase/diagnostics/202605_training_legacy_consolidation_synthetic_qa_script.sql`
- `supabase/diagnostics/202605_training_legacy_consolidation_synthetic_qa_rollback.sql`
- `supabase/diagnostics/202605_training_legacy_consolidation_qa_script.sql`
- `supabase/diagnostics/202605_training_legacy_consolidation_qa_rollback.sql`

Todos los SQL estan fuera de `supabase/migrations`.

## QA con legacy previo

El QA actual puede contener registros legacy reales de pruebas anteriores. Si se ejecuta el dataset sintetico sobre ese QA, los conteos globales del script de consolidacion QA original ya no coinciden con el patron productivo simulado:

- 5 grupos sinteticos + legacy previo de QA.
- 30 sesiones sinteticas + sesiones legacy previas de QA.
- 30 entries sinteticas + entries legacy previas de QA.

Por esta razon, el script global `202605_training_legacy_consolidation_qa_script.sql` solo debe ejecutarse en un QA limpio sin legacy previo.

Para el QA actual se debe usar la variante filtrada por marcador:

- `supabase/diagnostics/202605_training_legacy_consolidation_synthetic_qa_script.sql`
- `supabase/diagnostics/202605_training_legacy_consolidation_synthetic_qa_rollback.sql`

Esta variante construye candidatos exclusivamente desde sesiones con notas que comienzan con:

```text
QA_LEGACY_SYNTHETIC_202605 legacy synthetic session
```

Tambien limita auditoria y rollback a `legacy_group_key like 'synthetic:%'` y `rollback_payload.dataset_marker = QA_LEGACY_SYNTHETIC_202605`.

El legacy real existente en QA queda fuera del dataset, fuera de la consolidacion sintetica y fuera del rollback sintetico.

## Usuarios QA requeridos

Antes de ejecutar el script sintetico, deben existir exactamente dos perfiles QA con estos `display_name`:

- `QA Legacy Synthetic User A`
- `QA Legacy Synthetic User B`

Los usuarios deben crearse en Supabase QA. No usar correos reales ni datos personales. El script valida que exista exactamente un perfil con cada nombre para evitar ambiguedad.

## Marcador de datos

Todos los registros creados por el dataset usan el marcador:

```text
QA_LEGACY_SYNTHETIC_202605
```

El marcador aparece en nombres de rutinas, ejercicios, notas de sesiones y notas de entries para permitir limpieza controlada.

## Estructura del dataset

El dataset crea 5 grupos legacy:

| Usuario QA | Dia legacy | Fecha sintetica | Week legacy | Entries |
| --- | --- | --- | --- | --- |
| User A | Lunes | 2026-05-04 | 1 | 6 |
| User A | Martes | 2026-05-05 | 1 | 6 |
| User A | Miercoles | 2026-05-06 | 1 | 6 |
| User B | Jueves | 2026-05-07 | 1 | 6 |
| User B | Viernes | 2026-05-08 | 1 | 6 |

Cada grupo crea:

- 1 rutina sintetica.
- 6 ejercicios sinteticos asociados a esa rutina y dia.
- 6 `training_sessions` legacy, una por ejercicio.
- 6 `exercise_entries`, una por sesion legacy.

El modelo resultante replica el patron legacy confirmado: multiples `training_sessions` para un entrenamiento real.

## Orden recomendado

1. Confirmar que Preview/Development apuntan a Supabase QA.
2. Crear los dos usuarios QA sinteticos.
3. Confirmar que no hay dataset sintetico previo con el marcador.
4. Ejecutar prechecks read-only existentes.
5. Ejecutar manualmente en Supabase QA:
   `supabase/diagnostics/202605_training_legacy_synthetic_dataset_qa.sql`
6. Ejecutar diagnostico read-only para confirmar los conteos esperados.
7. Enviar evidencia a auditoria Claude si corresponde.
8. Si QA tiene legacy previo, ejecutar manualmente solo la variante filtrada:
   `supabase/diagnostics/202605_training_legacy_consolidation_synthetic_qa_script.sql`
9. Validar postchecks.
10. Probar rollback con:
   `supabase/diagnostics/202605_training_legacy_consolidation_synthetic_qa_rollback.sql`
11. Ejecutar cleanup del dataset sintetico cuando termine la prueba.

## Prechecks obligatorios

Antes de crear el dataset:

- Confirmar ambiente QA.
- Confirmar que no se esta conectado a Produccion.
- Confirmar que existen exactamente los dos perfiles QA requeridos.
- Confirmar que no existen rutinas con marcador `QA_LEGACY_SYNTHETIC_202605`.

Antes de consolidar:

- Confirmar 5 grupos legacy.
- Confirmar 30 `training_sessions` legacy.
- Confirmar 30 `exercise_entries`.
- Confirmar 2 usuarios afectados.
- Confirmar 0 entries huerfanas.
- Confirmar 0 ownership issues.
- Confirmar 0 mezcla de rutinas.
- Confirmar 0 mezcla de dias.
- Confirmar 0 entries apuntando a sesiones con `deleted_at is not null`.

## Cleanup

El archivo `202605_training_legacy_synthetic_dataset_qa_cleanup.sql` elimina solo registros marcados con `QA_LEGACY_SYNTHETIC_202605`.

El cleanup contempla ejecucion antes o despues de consolidacion QA:

- Elimina `exercise_entries` sinteticas.
- Elimina `training_sessions` sinteticas.
- Elimina `exercises` sinteticos.
- Elimina `routines` sinteticas.
- Si existe `training_session_consolidation_audit`, elimina filas de auditoria relacionadas con sesiones o entries sinteticas.
- Valida al final que no queden registros con marcador sintetico en `routines`, `exercises`, `training_sessions`, `exercise_entries` ni auditoria sintetica.

No debe ejecutarse en Produccion.

## Evidencia esperada

Despues de crear dataset:

- 5 grupos `consolidation_candidate`.
- 30 sesiones legacy sinteticas.
- 30 entries sinteticas.
- 2 usuarios QA afectados.
- 0 huerfanas.
- 0 ownership issues.
- 0 mezcla de rutinas.
- 0 mezcla de dias.

Despues de consolidar en QA:

- 5 sesiones canonicas activas.
- 30 entries conservadas.
- Entries apuntando a sesiones canonicas.
- Sesiones no canonicas marcadas con `deleted_at`.
- Auditoria con 5 filas ejecutadas.
- Sin entries apuntando a sesiones soft-deleted.

Despues de rollback:

- Entries restauradas a sus `session_id` originales.
- Campos originales de sesiones restaurados desde `rollback_payload`.
- Auditoria marcada como `rolled_back`.

## Riesgos

- Ejecutar por error en Produccion.
- Crear usuarios QA duplicados con el mismo `display_name`.
- Ejecutar el dataset sobre QA con residuos previos.
- Ejecutar consolidacion sin que los prechecks coincidan.
- El cleanup podria eliminar auditoria sintetica necesaria si se ejecuta antes de guardar evidencia.

## Recomendacion

Usar este dataset solo para validar el flujo QA de consolidacion, rollback y postchecks. Mantener fallback legacy activo hasta cerrar todos los casos legacy reales y no avanzar a Produccion sin auditoria Claude, validacion QA y aprobacion humana explicita.
