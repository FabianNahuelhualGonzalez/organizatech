# Fase 2.2P - Solicitud de ejecucion controlada Training Cycles

## 1. Contexto

Arquitectura aprobo formalmente la Fase 2.2N - Reconciliacion del metodo de ejecucion Training Cycles.

Veredicto:

```text
Fase 2.2N: APROBADA
```

Metodo oficial candidato para futura ejecucion productiva:

```text
Linea B - supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
```

La decision arquitectonica descarta `supabase db push` para esta ejecucion especifica, porque el historial local/remoto sigue desfasado y podria arrastrar migraciones antiguas.

Auditorias Claude ya completadas:

```text
Script aislado auditado tecnicamente por Claude en Fase 2.2N: APROBADO.
Informe de reconciliacion Fase 2.2N auditado por Claude: APROBADO.
Solicitud Fase 2.2P auditada por Claude: APROBADO.
```

## 2. Metodo oficial candidato aprobado

Script exacto:

```text
supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
```

Motivos de aprobacion:

- Aisla exclusivamente `public.training_cycles`.
- No depende de `supabase db push`.
- No arrastra migraciones antiguas.
- Es transaccional.
- Tiene prechecks abortivos.
- Tiene postchecks.
- Valida baseline.
- No toca `training_sessions` salvo SELECT de baseline.
- No toca `exercise_entries` salvo SELECT de baseline.
- No contiene DML sobre datos existentes.

## 3. Metodo no autorizado

Para esta ejecucion no se usara:

- `supabase db push`
- `supabase migration repair`
- migracion parcial manual desde `supabase/migrations/`
- activacion de feature flag
- cambios en Vercel
- redeploy

## 4. Baseline final vigente esperado

Antes de ejecutar, Produccion debe seguir en este baseline:

```text
training_sessions = 36
training_sessions active = 11
training_sessions soft_deleted = 25
exercise_entries = 78
distinct_session_count = 11
```

Si alguno de estos valores cambia, abortar y no ejecutar.

## 5. Confirmaciones previas esperadas

Antes de ejecutar el script aislado debe confirmarse:

```text
public.training_cycles = NULL / inexistente
public.set_updated_at() = existente
NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY = false / no activa
fallback legacy = disponible
```

## 6. Script exacto a ejecutar

```text
supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
```

El script fue versionado en:

```text
commit eb5cfb1
```

Archivos de Fase 2.2N incluidos en ese commit:

```text
docs/fase-2-2n-reconciliacion-metodo-ejecucion-training-cycles.md
docs/fase-2-2n-script-aislado-training-cycles.md
supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
```

No modificar el script en la consola antes de ejecutar.

## 7. Confirmacion de feature flag

La feature flag productiva debe permanecer desactivada:

```text
NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false
```

Tambien se acepta como no activa si la variable no esta definida y el codigo mantiene fallback legacy.

No activar esta flag durante la ventana de creacion de schema.

## 8. Confirmacion de no impacto

El script aislado:

- No toca `training_sessions` salvo SELECT de baseline.
- No toca `exercise_entries` salvo SELECT de baseline.
- No contiene `insert into` sobre datos existentes.
- No contiene `update` sobre datos existentes.
- No contiene `delete from` sobre datos existentes.
- No contiene backfill.
- No toca Vercel.
- No requiere redeploy.
- No activa feature flag.
- No crea datos iniciales.

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
```

## 9. Plan de ejecucion propuesto

1. Abrir SQL Editor de Supabase Produccion.
2. Validar visualmente que el proyecto corresponde a Produccion.
3. Confirmar que no hay dudas de ambiente.
4. Confirmar que la feature flag productiva sigue false / no activa.
5. Confirmar baseline vigente.
6. Abrir el archivo versionado:
   `supabase/diagnostics/202606_training_cycles_isolated_production_script.sql`.
7. Pegar el script exacto en SQL Editor.
8. No modificar el script en consola.
9. Ejecutar una sola vez.
10. Capturar evidencia de salida.
11. Ejecutar postchecks.
12. No activar feature flag.
13. No tocar Vercel.
14. No hacer redeploy.

Nota:

```text
Los postchecks estan embebidos en el propio script como segundo bloque DO $$ y se ejecutan automaticamente dentro de la misma transaccion. El operador no debe ejecutar un bloque adicional; solo debe verificar que el script termino sin errores y conservar la evidencia de salida.
```

## 10. Postchecks esperados

Despues de ejecutar, validar:

- `public.training_cycles` existe.
- Columnas esperadas OK.
- Indices esperados OK.
- Unique partial index activo OK.
- RLS habilitado OK.
- Policies select / insert / update OK.
- Sin policy DELETE OK.
- Trigger `updated_at` OK.
- `public.set_updated_at()` disponible OK.
- `training_cycles_count = 0`.
- `training_sessions` mantiene baseline:
  - total 36
  - active 11
  - soft-deleted 25
- `exercise_entries` mantiene baseline:
  - total 78
  - distinct session count 11
- Feature flag sigue false / no activa.
- Vercel no fue tocado.
- No hubo redeploy.

## 11. Plan de reversa

La reversa DB solo puede ejecutarse con aprobacion separada de Arquitectura.

Antes de considerar reversa:

- Confirmar si existen filas en `public.training_cycles`.
- Si existen filas, no ejecutar DROP sin plan separado, backup y aprobacion explicita.
- Si no existen filas, usar la estrategia conceptual documentada en Fase 2.2N solo con autorizacion.

No ejecutar `drop table`, `drop policy`, `drop index` ni `drop trigger` sin aprobacion explicita.

Rollback funcional/UI:

- Mantener `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false`.
- Mantener fallback legacy.
- No tocar Vercel.
- No hacer redeploy de habilitacion.

## 12. Evidencia requerida

Guardar:

- Captura o resultado de prechecks.
- Confirmacion de proyecto Produccion.
- Confirmacion de feature flag false / no activa.
- Resultado de ejecucion del script.
- Resultado de postchecks.
- Confirmacion de `training_cycles_count = 0`.
- Confirmacion de baseline `training_sessions` sin cambios.
- Confirmacion de baseline `exercise_entries` sin cambios.
- Confirmacion de no cambios en tablas legacy.
- Confirmacion de no Vercel.
- Confirmacion de no redeploy.
- Confirmacion de no feature flag.

La evidencia debe estar sanitizada y no debe incluir secretos, tokens, passwords, connection strings, service role keys ni datos personales.

## 13. Criterios de aborto

Abortar si:

- `public.training_cycles` ya existe antes de ejecutar.
- Baseline no coincide.
- `public.set_updated_at()` no existe.
- El script local difiere del auditado/versionado en `eb5cfb1`.
- SQL Editor no corresponde claramente a Produccion.
- Aparece cualquier modificacion manual del script.
- Cualquier error ocurre durante ejecucion.
- Feature flag productiva esta activa.
- Hay duda de ambiente.
- Se requiere `supabase db push`.
- Se requiere `supabase migration repair`.
- Se requiere tocar Vercel.
- Se requiere redeploy.

Si el script falla por cualquier motivo, PostgreSQL hace rollback automatico de toda la transaccion. No queda estado parcial.

## 14. Solicitud explicita a Arquitectura

Solicitamos autorizacion final para ejecutar en Supabase Produccion, mediante SQL Editor y una sola vez, el script aislado:

```text
supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
```

Manteniendo:

```text
NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false
```

Sin:

- `supabase db push`
- `supabase migration repair`
- cambios en Vercel
- redeploy
- cambios en `training_sessions`
- cambios en `exercise_entries`
- insercion de datos iniciales
- backfill

## 15. Estado posterior esperado

Si Arquitectura autoriza y la ejecucion resulta exitosa:

- `public.training_cycles` existe.
- `training_cycles` esta vacia.
- `training_sessions` conserva baseline.
- `exercise_entries` conserva baseline.
- Feature flag sigue false / no activa.
- UI productiva sigue sin habilitar Training Cycles repository.
- Vercel sigue sin cambios.
- Fase 2.2Q queda pendiente para reconciliacion post-ejecucion del historial de migraciones.

Este documento no autoriza ejecucion por si mismo. La ejecucion requiere aprobacion final explicita de Arquitectura.
