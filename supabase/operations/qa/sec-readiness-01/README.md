# SEC-READINESS-01 — paquete QA

Estado: preparado localmente y **no ejecutado**. Este paquete es exclusivo de QA. No autoriza SQL remoto, no autoriza Production y no debe copiarse a una carpeta de operaciones Production.

## Artefacto único de aplicación

- Migración: `supabase/migrations/20260824011330_sec_readiness_01_bound_workout_readiness_writes.sql`
- SHA-256 esperado: `bea5294e991d1368200e8b712d0f829b2449a33e414433f0c1568dae435bbb95`
- CLI usada sólo para crear el archivo local: Supabase CLI `2.115.0`

No existe un bundle SQL duplicado: la migración anterior es la única fuente autorizable. Antes de una futura aplicación QA, recalcular el hash desde un checkout limpio y exigir igualdad byte a byte. No editar SQL en Dashboard, no aplicar fragmentos y no marcar manualmente historial de migraciones.

## Orden obligatorio futuro

1. Confirmar visualmente que el destino es el proyecto **QA** de Organizatech y que no es Production. Un project ref no puede verificarse de forma confiable desde SQL; es un gate humano.
2. Confirmar checkout, branch, HEAD, árbol limpio y hash de migración. Confirmar también que el stash protegido sigue intacto.
3. Ejecutar `01_precheck_readonly.sql` una sola vez. Continuar únicamente si devuelve `SEC_READINESS_01_QA_READY` y todos los checks son `true`.
4. Revisar los conteos agregados. `historical_payloads_outside_new_contract` es informativo: la defensa `BEFORE INSERT` fue elegida precisamente para no bloquear el link de filas históricas fuera del contrato.
5. Obtener autorización separada y explícita para aplicar **exactamente** la migración identificada arriba mediante el mecanismo de migraciones QA aprobado. QA primero; nunca Production en esta fase.
6. Detenerse ante cualquier error de aplicación. No reintentar, no ejecutar fragmentos y no intentar “reparar” el historial desde SQL Editor.
7. Ejecutar `02_functional_transaction.sql` una sola vez. Debe devolver `SEC_READINESS_01_FUNCTIONAL_VERIFIED`, todos los checks `true` y terminar físicamente en `ROLLBACK`.
8. Confirmar que los únicos cambios temporales de contexto fueron `status/deleted_at` del ciclo candidato y `deleted_at` de su día. El script no escribe `training_sessions`, `exercise_entries`, readiness legacy, Auth ni ownership; todo queda dentro del rollback.
9. Ejecutar `03_postcheck_readonly.sql`. Exigir `SEC_READINESS_01_QA_VERIFIED` y todos los checks `true`.
10. Guardar outputs agregados, hash de migración y timestamps como evidencia de QA, sin UUIDs, payloads, JWT, cookies ni credenciales.
11. Solicitar auditoría independiente Claude y completar el probe real de concurrencia descrito abajo. Hasta entonces el cambio no está listo para Production.

## Qué demuestra la transacción funcional

- Los dos payloads TypeScript legítimos siguen funcionando.
- Claves adicionales, payload >1024 bytes, nulls, tipos incorrectos, fracciones y valores fuera de `1..7` fallan.
- El mismo UUID sigue siendo idempotente incluso con cuota llena.
- El intento 32 se permite y el 33 se rechaza.
- El backend retiene advisory locks distintos para dos usuarios materiales.
- Ciclo ajeno/inactivo/eliminado y día ajeno/eliminado fallan.
- RLS mantiene aislamiento Usuario A/B.
- Los writes directos de tabla siguen revocados.
- El primer link y su retry idempotente siguen operativos.
- `training_sessions`, `exercise_entries` y readiness legacy no cambian.

## Concurrencia material pendiente

El contrato local y los mutation probes demuestran que `pg_advisory_xact_lock` derivado de `auth.uid()` ocurre antes del recheck, conteo acotado e insert. La transacción QA demuestra que el lock queda retenido y que A/B usan claves distintas. Eso no sustituye una carrera real entre dos conexiones.

Una carrera completa desde 31 intentos no puede ser simultánea y, a la vez, quedar globalmente revertida por un único `ROLLBACK`: cada conexión tiene su propia transacción. Para cerrar esta evidencia se requiere una autorización QA adicional y un harness de dos conexiones en un entorno QA desechable:

1. Preparar una identidad QA dedicada con exactamente 31 filas recientes y un ciclo/día válidos.
2. Abrir dos conexiones `READ COMMITTED` autenticadas como la misma identidad.
3. Liberar simultáneamente dos RPC con UUID distintos.
4. Verificar que una sola llamada inserta el intento 32 y la otra recibe el límite; el total debe permanecer en 32.
5. Repetir con el mismo UUID en ambas conexiones y verificar un único row más dos respuestas idempotentes.
6. Repetir con usuarios A/B y verificar que no se bloquean entre sí salvo una improbable colisión de hash, que sólo puede sobreserializar.
7. Destruir el entorno QA desechable completo en vez de borrar filas selectivamente de una base compartida.

No usar `dblink`, `service_role` ni una limpieza destructiva en QA compartida. No ejecutar ninguna variante en Production.

## Criterio de salida

Incluso con checks locales y QA en verde, la salida máxima de esta fase es “candidato auditado para evaluación posterior”. Production requiere, en orden: auditoría Claude, QA Supabase material PASS, carrera real de dos conexiones PASS, revisión de riesgos y autorización de despliegue separada.
