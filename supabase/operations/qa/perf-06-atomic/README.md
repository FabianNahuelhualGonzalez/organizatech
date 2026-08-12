# Runner atómico PERF-06 para QA

Este directorio contiene las consultas inspeccionables del runner nativo Node
[`scripts/perf-06-atomic-runner.mjs`](../../../../scripts/perf-06-atomic-runner.mjs).
No constituye autorización de ejecución remota. Los archivos `prechecks.sql`,
`scenarios.sql` y `postchecks.sql` se cargan como sentencias nombradas y no deben
ejecutarse por separado.

## Contrato operativo

- Destino futuro único: QA `organizatech-qa`, ref
  `fjjebhaqtrdbpxzxztmh`, host directo
  `db.fjjebhaqtrdbpxzxztmh.supabase.co:5432/postgres` y rol `postgres`.
- Una sola instancia `pg.Client` ejecuta la operación principal. No hay pool,
  procesos SQL externos, transmisión de SQL por streams ni herramientas de
  migración alternativas.
- QA exige `sslmode=verify-full`; el cliente fija `rejectUnauthorized: true` y
  SNI igual al host aprobado. No existe fallback TLS permisivo.
- La operación abre exactamente una transacción
  `BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE`; sin `--commit` termina en
  `ROLLBACK` aunque todos los gates pasen.
- Un COMMIT futuro exige `--commit` y un literal distinto para QA y validación
  local, ligado a ref, fingerprint baseline, hash del manifiesto y fingerprint
  final. No hay retry.
- Timeout, señal o pérdida de conexión bloquean nuevas consultas ordinarias. El
  runner intenta `ROLLBACK` sólo si la conexión sigue utilizable, cierra o
  destruye el socket y espera el cierre del backend. Si el resultado de COMMIT
  es incierto, informa `INDETERMINATE`, nunca ejecución nominal PASS.
- Sólo después de cerrar o inutilizar la conexión principal, un incidente puede
  abrir un segundo `pg.Client` de verificación. Éste usa una transacción
  `READ ONLY`, espera sin deadline global a que desaparezca el PID principal y
  clasifica exclusivamente baseline exacto, final exacto o estado indeterminado.
  Si no puede confirmar que el PID desapareció, permanece pendiente: nunca
  completa ni repara, ni devuelve mientras el backend pueda seguir activo.
- Cada operación del verificador tiene timeout cliente y server-side individual
  (`statement_timeout`, `lock_timeout` e
  `idle_in_transaction_session_timeout`). Un timeout de snapshot o un cierre
  no confirmado destruye el socket verificador y degrada el resultado a
  `INDETERMINATE`; no habilita un tercer flujo SQL.

## Secuencia y gates

El manifiesto canónico contiene 18 históricas/255 statements y seis
PERF-06/81 statements: 24/336, SHA-256
`2955e5eeb0e4b08060970803ac27c4811f76a304f75d99fded65642847a39848`.
Se deriva nuevamente desde los SQL con el port de `SplitAndTrim` de Supabase CLI
2.113.0 y cualquier diferencia aborta antes de conectar.

Dentro de la transacción, el runner configura timeouts locales y
`application_name`, toma el advisory lock, ejecuta prechecks read-only, adquiere
locks mínimos y repite los prechecks. Después crea el historial exacto de
Supabase, inserta sólo las 18 filas históricas y ejecuta A, C, B, invariant R,
compensatoria R y ACL R. Cada versión PERF se registra únicamente después de que
termina su último statement.

Los locks se toman en este orden:

1. `training_session_consolidation_audit` (`SHARE`);
2. `auth.users` (`SHARE`);
3. `exercises` (`SHARE ROW EXCLUSIVE`);
4. `routines`, `exercise_entries`, `training_cycle_exercises` y
   `training_exercise_lineages` (`SHARE ROW EXCLUSIVE`).

No existe prelock global `ACCESS EXCLUSIVE`. Los `SET LOCAL` incluidos en el
invariant y la compensatoria sustituyen desde ese punto los timeouts anteriores
de la misma transacción.

Antes del primer write se exige: identidad `postgres/postgres`, PostgreSQL
17.6, destino y TLS válidos, historial y PERF ausentes, fingerprint baseline
exacto, cardinalidad pendiente 0/2, marker global cero y tabla diagnóstica
presente, vacía, sin consumidores. La tabla diagnóstica queda bloqueada y se
revalida intacta; el lote no contiene `DROP`, `ALTER`, `TRUNCATE` ni DML sobre
ella.

El baseline sólo queda marcado como precheck completo después de la segunda
lectura bajo locks. Tanto los postchecks nominales como la recuperación usan el
mismo recolector de estado: fingerprint, las 24 filas de historial en orden con
`version`, `name` y arrays `statements` íntegros, catálogo parcial/completo,
lineages, marker global, fixtures, diagnóstico y hash, consumidores y conteos
laterales allowlisted. Sin ese precheck completo no existe clasificación
definitiva de rollback o commit.

Los escenarios A–I usan savepoints, parámetros para fixtures y comparación
exacta de `error.code`. Scenario F sólo admite `23514` para el rebind y Scenario
G espera cada consulta antes de enviar la siguiente. Los postchecks validan
historial 1:1, grants, RLS, policies, funciones, triggers, índice, lineages,
marker, segunda compensación no-op, ausencia de fixtures, conteos fuera de
alcance, diagnóstico intacto y fingerprint final
`833c2db78f0caeb776bf04b54d05e9c52c2adb0ee1e03cdbc0f479fe2ea76bc9`.

## Validación local

`scripts/perf-06-local-bootstrap.mjs` reconstruye el baseline en una base
desechable PostgreSQL 17.6 cuyo nombre comienza por `perf06_`. También usa el
cliente Node nativo: carga `schema.sql`, las 18 históricas en orden y los stubs
locales necesarios, y exige el fingerprint baseline aprobado. El archivo
`local-validation-bootstrap.sql` sólo contiene las fases SQL propias del entorno
local y no usa comandos de cliente.

El bootstrap manual de 18 filas es una reparación de historial equivalente en
efecto a `migration repair`, pero permanece dentro de la misma
transacción que todo PERF-06 para que un error revierta historial, DDL y DML.
Las propuestas anteriores de 19 históricas, cinco PERF, borrado de la tabla
diagnóstica, `SERIALIZABLE` o registro anticipado quedan fuera de este contrato.
