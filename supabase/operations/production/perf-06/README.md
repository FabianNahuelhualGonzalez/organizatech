# PERF-06 — Producción · Preflight READ-ONLY

Destino exclusivo: `organizatech` PROD, project ref `lzycxltqbrtsnwfdotqw`.

## Estado

El archivo `01_preflight_readonly.sql` está preparado localmente. **No ejecutarlo todavía**:
primero debe recibir una auditoría independiente y después una autorización explícita del
dueño de producto para copiarlo manualmente al SQL Editor de PROD.

Este paquete no contiene autorización para aplicar PERF-06, registrar migraciones, hacer
bootstrap, modificar datos, hacer merge ni tocar Vercel.

## Alcance

La consulta:

- abre una transacción `REPEATABLE READ READ ONLY` y termina siempre con `ROLLBACK`;
- exige `current_user = session_user = postgres` para un resultado positivo;
- calcula el fingerprint determinista de catálogo sin leer payloads personales;
- detecta historial ausente, parcial o final exacto sin crear `schema_migrations`;
- inventaría las 12 relaciones, el estado PERF-06 y conteos allowlisted;
- informa sólo cantidades agregadas de lineages, ownership, referencias y conflictos;
- clasifica la tabla diagnóstica sin mostrar sus filas;
- informa tamaño/estadísticas agregadas de `exercise_entries`, locks y transacciones largas;
- no devuelve UUID, email, teléfono, avatar, JWT, cookies ni credenciales.

## Resultados posibles

- `PASS_READY_FOR_PROD_BUNDLE_DESIGN`: baseline estructural compatible; permite diseñar
  localmente un bundle PROD específico a partir de los conteos observados.
- `ALREADY_APPLIED`: catálogo e historial final coinciden exactamente; detenerse y auditar
  por qué PERF-06 ya aparece instalado.
- `BLOCKED_IDENTITY_OR_TRANSACTION`: rol o modo transaccional incorrecto.
- `BLOCKED`: cualquier drift, aplicación parcial, historial inesperado o anomalía de datos.

Incluso un `PASS_READY_FOR_PROD_BUNDLE_DESIGN` no autoriza ninguna escritura. El resultado
completo debe volver a la tarea existente `PERF-06R — NORMALIZACIÓN DE HISTORIAL Y
RECONCILIACIÓN` para diseñar y auditar el siguiente paquete antes de cualquier aplicación
manual.

## Ejecución futura, sólo tras autorización

1. Confirmar visualmente proyecto `organizatech` y ref `lzycxltqbrtsnwfdotqw`.
2. Abrir una consulta nueva en SQL Editor.
3. Pegar el archivo completo y ejecutarlo una sola vez.
4. Ante error, timeout, desconexión o veredicto distinto de
   `PASS_READY_FOR_PROD_BUNDLE_DESIGN`, no reintentar.
5. Copiar únicamente la fila agregada de resultado; no compartir datos o credenciales.

## Diagnóstico de drift 347 vs 346

`02_drift_diagnostic_readonly.sql` se prepara únicamente después de que el
preflight haya devuelto `BLOCKED` con la fotografía aprobada
`347 / 1fefc787…903a5`. También usa `REPEATABLE READ READ ONLY` y termina con
`ROLLBACK`.

El diagnóstico:

- compara los conteos de las nueve categorías del fingerprint con el baseline;
- lista sólo claves de objetos y SHA-256 individuales en categorías cuyo conteo
  difiere;
- no devuelve definiciones de funciones, ACL completas ni filas de aplicación;
- consulta la tabla diagnóstica excluida exclusivamente mediante catálogos;
- se bloquea con `DRIFT_SNAPSHOT_CHANGED` si PROD cambia antes de ejecutarlo.

No ejecutarlo sin auditoría independiente y autorización manual específica.

## Clasificación de `rls_auto_enable()`

`03_rls_auto_enable_classification_readonly.sql` clasifica el único objeto adicional
detectado por el diagnóstico `347 vs 346`. Es una consulta READ-ONLY separada que:

- no devuelve el cuerpo de la función, sólo su SHA-256 y banderas semánticas;
- informa firma, propietario, lenguaje, `SECURITY DEFINER` y `search_path`;
- resume los ACL directos sin utilizar ni mostrar credenciales;
- verifica por catálogo el event trigger `ensure_rls`, sus tags y su estado;
- agrega dependencias únicamente por catálogo y tipo;
- termina siempre con `ROLLBACK`.

No autoriza eliminar, recrear, excluir ni modificar la función o el event trigger.

## Bundle PROD específico con `ROLLBACK`

El primer `04_prod_rollback.sql` fue retirado después de abortar en su gate inicial sin
persistir cambios. El reemplazo `08_prod_rollback_capture.sql` reproduce la operación
PERF-06 completa en una única transacción que termina con `ROLLBACK`, y después verifica
en una transacción `READ ONLY` que el baseline de PROD haya quedado intacto.

El reemplazo trata el drift legítimo de PROD de forma explícita:

- excluye únicamente `public.rls_auto_enable()` del fingerprint canónico `346 → 377`;
- valida por separado y preserva byte/estado de `public.rls_auto_enable()` y el event
  trigger `ensure_rls` mediante hashes, wiring, tags, propietario y dependencias;
- bloquea `public.training_session_consolidation_audit` durante la operación;
- exige exactamente tres registros con estado `executed` y compara un SHA-256 de su
  esquema y filas antes/después;
- no contiene DML ni DDL dirigido a la tabla diagnóstica, la función adicional o el
  event trigger;
- contiene cero `COMMIT` ejecutables y termina con `ROLLBACK_VERIFIED` sólo si el
  historial PERF-06 vuelve a estar ausente y el catálogo baseline permanece intacto.

Además exige el baseline PROD observado `346 / 4216b822…0b210`. El gate final valida el
estado semántico completo y devuelve el fingerprint final específico de PROD para poder
congelarlo antes de preparar cualquier bundle persistente. Este archivo no autoriza PROD
persistente, no crea un bundle COMMIT y no autoriza commit/push/merge Git.

Como SQL Editor no expone de forma fiable resultados intermedios, el reemplazo operativo
es `09_prod_final_fingerprint_capture.sql`: ejecuta los mismos gates y termina mediante
un error controlado `P0001` cuyo mensaje contiene únicamente el fingerprint final. Ese
error es el mecanismo esperado que aborta y revierte la transacción. Inmediatamente
después, `10_post_capture_readonly.sql` verifica en otra transacción read-only que el
baseline `346 / 4216b822…0b210` quedó restaurado y no existen sesiones ni locks residuales.

## Diagnóstico posterior al fallo del primer gate

`05_post_failure_readonly.sql` existe exclusivamente para verificar el estado posterior
al fallo `55000` observado en la primera y única ejecución de `04_prod_rollback.sql`.
No reintenta la operación y no contiene ninguna parte de las migraciones.

La consulta abre `REPEATABLE READ READ ONLY`, termina con `ROLLBACK` y exige:

- baseline canónico intacto `346 / ebd6b8bb…105f1`;
- `public.rls_auto_enable()` y `ensure_rls` íntegros mediante el guard PROD completo;
- los tres registros diagnósticos originales, todos con estado `executed`;
- historial PERF-06, funciones, triggers e índice PERF-06 ausentes;
- cero lineages pendientes o markers de reconciliación;
- cero sesiones o locks residuales identificables de la ejecución fallida.

El resultado esperado es `PASS_POST_FAILURE_STATE_VERIFIED`. Cualquier otro resultado,
error o desconexión mantiene el estado bloqueado. Un PASS confirma únicamente que el
fallo fue atómico; **no autoriza reintentar el bundle**, aplicar PROD ni hacer merge.

El resultado real conservó todos los controles anteriores pero devolvió el fingerprint
canónico `346 / 4216b822…0b210`, distinto del checkpoint `346 / ebd6b8bb…105f1`.
Esto confirma ausencia de aplicación parcial y revela un drift de contenido con el mismo
conteo. `06_post_failure_drift_readonly.sql` identifica las categorías divergentes y
devuelve únicamente claves allowlisted y SHA-256 de sus objetos. No devuelve definiciones,
ACL completas ni filas; es `READ ONLY` y termina con `ROLLBACK`.

Un `PASS_POST_FAILURE_DRIFT_CAPTURED` sólo completa el diagnóstico. No autoriza modificar
el drift, reintentar `04_prod_rollback.sql`, crear un bundle COMMIT ni aplicar PROD.

## Clasificación final de funciones y ACL

`07_acl_function_classification_readonly.sql` separa las dos categorías divergentes
detectadas por `06`: las ocho funciones canónicas y los ACL directos de las doce tablas.
Devuelve únicamente propiedades de catálogo, hashes SHA-256 de definiciones y matrices
rol/privilegio; nunca devuelve cuerpos de funciones, filas de aplicación ni credenciales.

El archivo exige la fotografía exacta `346 / 4216b822…0b210`, los hashes observados de
`function` y `table_acl`, el guard PROD, los tres diagnósticos y ausencia total de PERF-06
parcial. Es `REPEATABLE READ READ ONLY` y termina con `ROLLBACK`.
