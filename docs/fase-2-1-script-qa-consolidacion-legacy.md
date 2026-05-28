# Fase 2.1D - Script QA de consolidacion legacy Training

## Objetivo

Preparar un script transaccional para consolidar datos legacy de Training en Supabase QA, sin ejecutarlo todavia.

La consolidacion busca transformar el patron legacy:

- multiples `training_sessions` por entrenamiento real;
- una `exercise_entry` asociada a cada sesion legacy;

en el modelo Fase 2:

- 1 `training_session` canonica por entrenamiento real;
- N `exercise_entries` apuntando a esa sesion canonica;
- sesiones no canonicas marcadas con `deleted_at`;
- auditoria con `rollback_payload` formal para revertir.

## Alcance QA

Archivos preparados:

- `supabase/diagnostics/202605_training_legacy_consolidation_qa_script.sql`
- `supabase/diagnostics/202605_training_legacy_consolidation_qa_rollback.sql`

Ambos archivos estan fuera de `supabase/migrations`.

El encabezado obligatorio de ambos SQL es:

```sql
-- NO EJECUTAR SIN APROBACION - SCRIPT QA - NO PRODUCCION.
```

## Prohibicion de Produccion

Estos scripts:

- No deben ejecutarse en Produccion.
- No deben moverse a `supabase/migrations`.
- No deben aplicarse como migracion.
- No deben ejecutarse sin auditoria Claude.
- No deben ejecutarse sin aprobacion humana explicita.
- No deben usarse como script productivo.

Produccion queda fuera de esta fase.

## Precondiciones

Antes de cualquier ejecucion futura en Supabase QA:

- Claude debe auditar el SQL completo.
- Arquitectura debe aprobar la ejecucion.
- Debe confirmarse que la conexion abierta apunta a Supabase QA.
- Debe existir respaldo o plan de recuperacion QA.
- Debe validarse que Production sigue apuntando a Supabase Produccion y Preview/Development a Supabase QA.
- No debe haber cambios pendientes no revisados en schema, RLS, RPC ni policies.
- Debe ejecutarse manualmente el precheck read-only de entries apuntando a sesiones soft-deleted y debe retornar 0:

```sql
select count(*)
from public.exercise_entries e
join public.training_sessions s on s.id = e.session_id
where s.deleted_at is not null;
```

Si retorna un valor mayor a 0, no ejecutar la consolidacion.

## Como revisar el script

Revisar en orden:

1. Encabezado de QA/no Produccion.
2. Transaccion explicita `begin;` / `commit;`.
3. Creacion de tabla administrativa de auditoria.
4. Estrategia de acceso/RLS.
5. Criterios de grupos legacy.
6. Prevalidaciones con `raise exception`.
7. `rollback_payload`.
8. Updates de consolidacion.
9. Validaciones post.
10. Script de rollback separado.

## Que valida antes

El script principal aborta antes de modificar datos si no se cumplen exactamente los valores esperados de QA controlado:

- 5 grupos legacy consolidables.
- 30 `training_sessions` legacy.
- 30 `exercise_entries` legacy.
- 2 usuarios afectados.
- 0 entries huerfanas.
- 0 mezcla de rutinas.
- 0 mezcla de dias.
- 0 ownership issues.
- Todos los grupos deben ser `consolidation_candidate`.
- `canonical_session_id = legacy_session_ids[1]`.
- `inferred_planned_day_code` e `inferred_planned_date` deben ser inferibles.
- No deben existir auditorias `pending` o `executed` sin rollback.
- El precheck manual de entries apuntando a sesiones soft-deleted debe retornar 0 antes de ejecutar.

Si una condicion falla, el script usa `raise exception` y la transaccion no debe avanzar.

## Que modifica si se ejecuta en QA

Si en una fase futura se ejecuta en QA y todas las prevalidaciones pasan:

1. Crea o asegura `public.training_session_consolidation_audit`.
2. Inserta 5 registros de auditoria con `rollback_payload`.
3. Actualiza la sesion canonica con:
   - `routine_id`
   - `trained_date`
   - `calendar_week_start`
   - `planned_day`
   - `planned_date`
   - `status = 'completed'`
   - `completed_at`
   - `deleted_at = null`
4. Mueve `exercise_entries.session_id` hacia `canonical_session_id`.
5. Marca sesiones no canonicas con `deleted_at = now()`.
6. Marca auditoria como `executed`.
7. Ejecuta validaciones post-consolidacion.

## Auditoria y acceso

La tabla `training_session_consolidation_audit` se define como tabla administrativa:

- RLS habilitado.
- Sin policies para usuarios normales.
- Sin acceso `anon`.
- Sin acceso `authenticated`.
- Sin exposicion al frontend.
- `rollback_payload` no debe quedar disponible a usuarios normales.

Los `GRANT` operativos deben definirse solo si Arquitectura aprueba un rol administrativo concreto.

La tabla de auditoria no incluye `unique constraint` ni indice sobre `legacy_group_key` en este script QA porque el alcance es acotado y el script aborta si existen auditorias `pending` o `executed` sin rollback. Si este proceso escala o se prepara para Produccion, Arquitectura debe evaluar un indice o constraint unico para evitar duplicidad operacional.

## Decision QA sobre completed_at

El script QA usa:

```sql
completed_at = coalesce(s.completed_at, s.trained_at, s.created_at)
```

Esta regla queda permitida solo para prueba controlada en QA.

Para Produccion requiere aprobacion explicita de Arquitectura, porque puede existir conversion implicita `date -> timestamptz` segun la zona horaria de la sesion SQL.

## Rollback

El rollback esta en:

`supabase/diagnostics/202605_training_legacy_consolidation_qa_rollback.sql`

El rollback:

- Esta dentro de transaccion.
- Usa `training_session_consolidation_audit.rollback_payload`.
- Restaura `exercise_entries.session_id` original por entry id.
- Restaura campos originales de la sesion canonica.
- Restaura campos originales de sesiones no canonicas.
- Restaura `deleted_at` segun payload.
- Marca auditoria como `rolled_back`.
- Puebla `rolled_back_at = now()`.
- No toca datos fuera de los registros auditados.
- Aborta si no hay auditoria valida o si ya fue revertida.

## Schema de rollback_payload

El payload guarda:

```json
{
  "prepared_at": "timestamp",
  "entries": [
    {
      "id": "uuid",
      "original_session_id": "uuid"
    }
  ],
  "canonical_session": {
    "id": "uuid",
    "routine_id": null,
    "calendar_week_start": null,
    "planned_day": null,
    "planned_date": null,
    "trained_date": null,
    "status": "completed",
    "completed_at": null,
    "deleted_at": null
  },
  "non_canonical_sessions": [
    {
      "id": "uuid",
      "routine_id": null,
      "calendar_week_start": null,
      "planned_day": null,
      "planned_date": null,
      "trained_date": null,
      "status": "completed",
      "completed_at": null,
      "deleted_at": null
    }
  ]
}
```

## Checklist antes de ejecutar en QA

- Confirmar rama y archivos revisados.
- Confirmar que los SQL no estan en `supabase/migrations`.
- Confirmar que la conexion es Supabase QA.
- Confirmar que no se esta conectado a Produccion.
- Confirmar auditoria Claude aprobada.
- Confirmar aprobacion humana.
- Confirmar que el script principal y rollback se revisaron juntos.
- Confirmar que no hay datos QA inesperados que cambien los conteos esperados.
- Confirmar que el precheck read-only de entries apuntando a sesiones soft-deleted retorna 0.
- Confirmar que Preview/Development apuntan a Supabase QA.

## Checklist despues de ejecutar en QA

- Confirmar 5 auditorias `executed`.
- Confirmar 30 entries siguen existiendo.
- Confirmar total reps antes/despues.
- Confirmar volumen antes/despues.
- Confirmar que no hay entries sin `session_id`.
- Confirmar que no hay entries apuntando a sesiones con `deleted_at is not null`.
- Confirmar que no hay sesiones activas duplicadas por `user_id/routine_id/trained_date`.
- Confirmar que cada grupo consolidado tiene 1 sesion activa.
- Confirmar que no se mezclan usuarios.
- Confirmar dashboard/carrusel.
- Confirmar comparacion semanal.
- Confirmar que el rollback queda disponible y no ejecutado.

## Evidencia esperada

Para una ejecucion QA correcta:

- `training_session_consolidation_audit`: 5 filas con `status = 'executed'`.
- `exercise_entries`: 30 entries legacy conservadas.
- Sesiones canonicas: 5 sesiones activas con campos Fase 2 poblados.
- Sesiones no canonicas: marcadas con `deleted_at`.
- Entries: apuntan a sesiones canonicas, no a sesiones soft-deleted.
- Totales de reps, peso simple y volumen: sin perdida.

## Fallback legacy

El fallback legacy read-only debe mantenerse despues de la consolidacion QA hasta confirmar que:

- no quedan sesiones legacy activas pendientes;
- no quedan casos no consolidables;
- dashboard, carrusel y comparacion semanal leen correctamente el modelo consolidado;
- rollback fue revisado y sigue disponible.

## Riesgos no bloqueantes

- El check global de entries apuntando a sesiones soft-deleted puede abortar si QA tiene residuos de pruebas anteriores.
- La tabla de auditoria no tiene unique constraint ni indice sobre `legacy_group_key` porque el alcance QA es acotado.
- Si el proceso escala, se debe evaluar indice o unique constraint para `legacy_group_key`.
- La regla de `completed_at` es aceptable en QA, pero requiere decision explicita antes de Produccion.
- El fallback legacy debe mantenerse durante QA hasta validar que no quedan casos activos o no consolidables.

## Advertencia final

No ejecutar estos scripts sin auditoria Claude y aprobacion humana.

No ejecutar en Produccion.

No hacer merge ni promover cambios operativos hasta completar la validacion QA.
