# Fase 2.2N - Reconciliacion de metodo de ejecucion Training Cycles

## 1. Contexto del problema

Arquitectura identifico dos lineas documentales y tecnicas para crear `public.training_cycles` en Produccion:

- Linea A: migracion original en `supabase/migrations/20260531_training_cycles.sql`.
- Linea B: script aislado en `supabase/diagnostics/202606_training_cycles_isolated_production_script.sql`.

La decision pendiente es definir cual debe ser el metodo oficial candidato para una ejecucion futura, sin ejecutar nada en esta fase.

Esta reconciliacion es solo revision local/documental. No autoriza ejecucion productiva.

## 2. Linea A - Migracion original

Archivo:

```text
supabase/migrations/20260531_training_cycles.sql
```

Estado:

```text
Existe.
```

Origen:

- Preparada como migracion QA aditiva en Fase 2.2C.
- Validada en QA.
- Revalidada localmente en Fase 2.2K-R.

Caracteristicas:

- Esta dentro de `supabase/migrations/`.
- Esta alineada con el flujo normal de migraciones del repositorio.
- Es mayormente idempotente por `create table if not exists`, `create index if not exists`, `drop trigger if exists` y `drop policy if exists`.
- No incluye prechecks de baseline.
- No incluye postchecks operativos.
- No abre transaccion explicita propia.

## 3. Linea B - Script aislado

Archivo:

```text
supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
```

Estado:

```text
Existe.
```

Origen:

- Preparado como alternativa para evitar `supabase db push`.
- Su objetivo es aplicar exclusivamente el contenido funcional de `20260531_training_cycles.sql`.
- Esta fuera de `supabase/migrations/`.

Caracteristicas:

- Es transaccional.
- Incluye `lock_timeout` y `statement_timeout`.
- Incluye prechecks abortivos.
- Incluye postchecks.
- Consulta `training_sessions` y `exercise_entries` solo para baseline.
- No participa del historial automatico de migraciones CLI.
- La auditoria Claude de Fase 2.2N y del Script B ya fue realizada.
- Veredicto Claude: APROBADO, sin observaciones bloqueantes pendientes.

## 4. Confirmacion de existencia

| Artefacto | Existe |
| --- | --- |
| `supabase/migrations/20260531_training_cycles.sql` | Si |
| `supabase/diagnostics/202606_training_cycles_isolated_production_script.sql` | Si |

## 5. Comparacion tecnica lado a lado

| Criterio | Linea A: migracion original | Linea B: script aislado |
| --- | --- | --- |
| Ubicacion | `supabase/migrations/` | `supabase/diagnostics/` |
| Metodo natural | `supabase db push` | Ejecucion controlada aislada |
| Riesgo de arrastrar migraciones antiguas | Alto mientras el historial siga desfasado | Bajo si se ejecuta solo el archivo |
| Trazabilidad CLI | Alta si el historial esta sano | No registra historial CLI por si mismo |
| Transaccion explicita | No | Si |
| Timeouts | No | Si |
| Prechecks abortivos | No | Si |
| Postchecks | No | Si |
| Idempotencia | Mayor, por `if not exists` / `drop if exists` | Menor por diseno: aborta si `training_cycles` ya existe |
| Rollback/reversa | Comentario conceptual | Documento operativo y rollback conceptual |
| Auditoria Claude | Revisada en fases previas | Fase 2.2N aprobada por Claude |
| Impacto sobre datos existentes | Esperado 0 | Esperado 0 |

## 6. Diferencias relevantes

### 6.1 Diferencias exactas de estructura operativa

La Linea A contiene el SQL de creacion de `training_cycles` como migracion aditiva.

La Linea B contiene ese mismo objetivo funcional, pero agrega:

- `begin` / `commit`.
- `set local lock_timeout = '10s'`.
- `set local statement_timeout = '120s'`.
- bloque `do $$` de prechecks.
- bloque `do $$` de postchecks.
- validacion de baseline productivo.
- abortos explicitos con `raise exception`.

### 6.2 Diferencias de tabla `training_cycles`

No hay diferencia funcional esperada en la tabla objetivo.

Ambas lineas crean `public.training_cycles` con:

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

Diferencia tecnica:

- Linea A usa `create table if not exists`.
- Linea B usa `create table` y aborta antes si la tabla ya existe.

### 6.3 Diferencias de indices

Ambas lineas crean:

- `training_cycles_user_status_idx`
- `training_cycles_user_created_idx`
- `training_cycles_user_deleted_at_idx`
- `training_cycles_one_active_per_user_idx`

Diferencia tecnica:

- Linea A usa `create index if not exists`.
- Linea B usa `create index` y depende del precheck de tabla inexistente.

### 6.4 Diferencias de unique partial index

Ambas lineas crean:

```text
training_cycles_one_active_per_user_idx
```

Condicion:

```text
status = 'active' and deleted_at is null
```

No hay diferencia funcional esperada.

### 6.5 Diferencias de RLS

Ambas lineas ejecutan:

```text
alter table public.training_cycles enable row level security
```

No hay diferencia funcional esperada.

### 6.6 Diferencias de policies

Ambas lineas crean policies para:

- select own rows
- insert own rows
- update own rows

Ambas omiten policy de delete.

Diferencia tecnica:

- Linea A hace `drop policy if exists` antes de crear.
- Linea B crea policies directamente, porque aborta si la tabla existe.

### 6.7 Diferencias de trigger `updated_at`

Ambas lineas crean:

```text
training_cycles_set_updated_at
```

Ambas usan:

```text
public.set_updated_at()
```

Diferencia tecnica:

- Linea A hace `drop trigger if exists` antes de crear.
- Linea B crea el trigger directamente, porque aborta si la tabla existe.

### 6.8 Diferencias de rollback/reversa

Linea A:

- Incluye rollback conceptual en comentarios.
- No incluye script de reversa ejecutable.

Linea B:

- Incluye documento operativo asociado con reversa conceptual.
- Aclara que la reversa DB requiere aprobacion explicita.
- Aclara que si hay datos productivos en `training_cycles`, no debe ejecutarse rollback DB sin plan separado.

### 6.9 Diferencias de idempotencia

Linea A:

- Mayor idempotencia.
- Puede reejecutarse sobre objetos existentes con menos fallas.
- Esa idempotencia es util en migraciones normales, pero puede ocultar un estado parcial si el historial esta desfasado.

Linea B:

- Menor idempotencia por diseno.
- Aborta si `public.training_cycles` ya existe.
- Esto es mas seguro para una ventana aislada, porque evita aplicar sobre un estado ambiguo.

## 7. Objetos creados por cada opcion

Ambas opciones crean funcionalmente:

- `public.training_cycles`
- primary key de `training_cycles`
- indices por usuario/status, usuario/created_at, usuario/deleted_at
- unique partial index de ciclo activo por usuario
- trigger `training_cycles_set_updated_at`
- RLS
- policies select/insert/update

Linea B adicionalmente ejecuta bloques de validacion, pero no crea objetos adicionales fuera de `training_cycles`.

## 8. Verificacion de tablas legacy y DML

| Punto | Linea A | Linea B |
| --- | --- | --- |
| Toca `training_sessions` | Solo comentario declarativo de no tocar | Solo SELECT de baseline y comentarios |
| Toca `exercise_entries` | Solo comentario declarativo de no tocar | Solo SELECT de baseline y comentarios |
| Contiene `INSERT` DML | No | No |
| Contiene `UPDATE` DML | No | No |
| Contiene `DELETE` DML | No | No |
| Contiene backfill | No | No |
| Modifica datos existentes | No | No |

Notas:

- En ambos archivos aparecen palabras como `insert`, `update` o `delete` asociadas a policies, trigger `before update`, FK `on delete cascade` o comentarios.
- No hay DML de datos `insert into`, `update public...` ni `delete from`.

## 9. Riesgos de usar `supabase db push`

Riesgo principal:

```text
supabase db push podria arrastrar migraciones antiguas locales sin registro remoto visible.
```

Migraciones locales involucradas:

- `20260513_add_exercise_day.sql`
- `20260527_legacy_training_diagnostics.sql`
- `20260527_training_sessions_source_of_truth.sql`
- `20260531_training_cycles.sql`

Aunque 2.2M concluyo que algunas migraciones antiguas parecen aplicadas de facto, el historial remoto sigue desfasado/no visible. Por tanto, `db push` no es el metodo recomendado para crear `training_cycles` en este momento.

## 10. Riesgos de usar script aislado

Riesgos:

- No registra automaticamente la migracion en historial CLI.
- Requiere una decision posterior sobre como reconciliar el historial.
- Debe ejecutarse con disciplina operacional para no convertirse en SQL manual no trazable.
- La auditoria Claude de Fase 2.2N ya fue realizada y aprobada.
- Si se modifica el script y diverge de la migracion original, puede crear una segunda fuente de verdad.

Mitigaciones:

- Mantener el script en repo.
- Auditar diff contra la migracion original.
- Guardar evidencia de ejecucion.
- Mantener `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false`.
- Registrar decision de Arquitectura.
- Planificar regularizacion de historial despues, si corresponde.
- Planificar una fase posterior especifica, por ejemplo Fase 2.2Q - Reconciliacion post-ejecucion del historial de migraciones, para definir como registrar, documentar o regularizar el estado historico despues de ejecutar el script aislado.
- Esa fase posterior no autoriza `supabase migration repair` ahora, no autoriza `supabase db push` y no autoriza modificar historial en Fase 2.2N.

## 11. Trazabilidad de cada opcion

Linea A:

- Mejor trazabilidad dentro del flujo normal Supabase CLI.
- Riesgo alto mientras el historial remoto no permita aislar 20260531.

Linea B:

- Trazabilidad por artefacto versionado, documento operativo, auditoria Claude y evidencia de ventana.
- No tiene trazabilidad automatica en `supabase_migrations`.
- Es mas compatible con el bloqueo actual de `db push`.

## 12. Recomendacion tecnica unica

Recomendacion:

```text
Usar como candidato oficial futuro la Linea B: script aislado
supabase/diagnostics/202606_training_cycles_isolated_production_script.sql
```

Condiciones:

- Debe pasar auditoria Claude.
- La auditoria Claude de Fase 2.2N ya fue realizada con veredicto APROBADO.
- Debe aprobarlo Arquitectura explicitamente.
- Debe ejecutarse solo en ventana controlada.
- Debe mantenerse `NEXT_PUBLIC_ENABLE_TRAINING_CYCLES_REPOSITORY=false`.
- Debe guardarse evidencia completa.
- Debe planificarse una fase posterior para reconciliar historial de migraciones.

Motivo:

La Linea A es el artefacto canonical de migracion, pero el metodo natural para aplicarla (`supabase db push`) esta bloqueado por riesgo de arrastrar migraciones antiguas. La Linea B reduce ese riesgo porque aisla la ejecucion a `training_cycles` y agrega prechecks/postchecks abortivos.

## 13. Criterios de aborto

Abortar si:

- Arquitectura no aprueba explicitamente el metodo final.
- Aparecen nuevas observaciones bloqueantes sobre el script aislado.
- `public.training_cycles` ya existe.
- `public.set_updated_at()` no existe.
- Cambia el baseline de `training_sessions`.
- Cambia el baseline de `exercise_entries`.
- Se requiere `supabase db push`.
- Se requiere `supabase migration repair` como parte de la ejecucion.
- El script intenta tocar `training_sessions` o `exercise_entries` fuera de SELECT.
- La feature flag productiva esta activa.
- Se requiere tocar Vercel o hacer redeploy.

## 14. Evidencia requerida antes de ejecucion

- Confirmacion de existencia de ambos artefactos.
- Diff revisado entre Linea A y Linea B.
- Auditoria Claude aprobada para Fase 2.2N y Script B.
- Aprobacion explicita de Arquitectura.
- Baseline vigente:
  - `training_sessions = 36`
  - activas = 11
  - soft-deleted = 25
  - `exercise_entries = 78`
  - distinct session count = 11
- Confirmacion de que `public.training_cycles` no existe.
- Confirmacion de que `public.set_updated_at()` existe.
- Confirmacion de feature flag productiva en false.
- Confirmacion de fallback legacy disponible.

## 15. Proximo paso recomendado para Arquitectura

La auditoria Claude de este informe y del Script B ya fue realizada.

Veredicto:

```text
APROBADO - Listo para Arquitectura
```

Arquitectura debe decidir si:

1. Mantiene bloqueo.
2. Solicita ajustes al script aislado.
3. Autoriza ejecucion futura usando la Linea B.
4. Exige regularizar historial antes de cualquier ejecucion.
5. Planifica Fase 2.2Q - Reconciliacion post-ejecucion del historial de migraciones.

No avanzar a ejecucion ni pedir autorizacion productiva todavia.

## 16. Confirmaciones

- No se ejecuto SQL.
- No se aplico migracion.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se toco Produccion.
- No se toco Supabase remoto.
- No se toco Vercel.
- No se hizo redeploy.
- No se activo feature flag.
- No se modifico base de datos.
- No se modifico `training_sessions`.
- No se modifico `exercise_entries`.
- No se hizo commit.
- No se hizo push.
- `supabase/.temp/` no debe versionarse.
