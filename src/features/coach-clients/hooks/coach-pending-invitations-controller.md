# Controller local de invitaciones pendientes

## Alcance y consumidor

`createCoachPendingInvitationsController({ source, isCurrent, pageSize? })` compone una fuente de lectura validada y una identidad/generación/contexto capturados por su dueño. No monta UI ni contiene SDK, Auth, SQL, almacenamiento, reloj implícito, debounce, polling o writes. El runtime de `coach-clients` de ROOT es el consumidor concreto; debe adaptar `repository.listPendingInvitations(query, options)` al puerto estructural, sin importaciones entre worktrees. La autorización, DTO canónico, UUID, filtro y deadline total pertenecen a ese adapter/repositorio.

El contrato independiente se congela en `coach-pending-invitations-controller-contract.ts`. `pageSize` omiso es 25; un valor explícito que no sea entero entre 1 y 50 lanza `RangeError("invalid_input")` antes de I/O. La construcción no llama a la fuente ni al guard.

## Llamadas explícitas

- `setQuery(raw): boolean` guarda exactamente el string, cancela la lectura anterior y limpia hechos/cursor. No solicita datos, incluso para la misma consulta; si ya está limpia es un no-op. El caller sigue con `load()` cuando corresponda.
- Texto inválido conserva el raw string y expone `error/invalid_input`: más de 254 bytes UTF-8, NUL o surrogate aislado. Pares Unicode válidos se permiten; no hay trim, normalización ni conversión de mayúsculas. Un argumento runtime no string devuelve false sin modificar la consulta tipada anterior.
- `load(): Promise<boolean>` solicita primera página con cursor null; devuelve false si ya existe lectura activa. También sirve como relectura explícita después de error.
- `reload(): Promise<boolean>` reemplaza la lectura activa y solicita primera página. Conserva filas/hechos de la misma consulta mientras carga o falla, pero descarta el cursor anterior: no continúa una paginación obsoleta después de un reload fallido.
- `loadNext(): Promise<boolean>` requiere primera página confirmada, cursor y ausencia de otra lectura. Sólo agrega una página válida de la misma consulta/epoch. Error conserva filas, hechos y cursor anterior para otro `loadNext()` explícito; no hay reintentos invisibles.
- `invalidate(): boolean` cancela y purga hechos del servidor sin I/O; conserva texto raw y permite una futura lectura explícita si la identidad sigue actual. No revive una instancia dispuesta.
- `dispose()` invalida permanentemente, aborta la lectura y limpia snapshot, texto de búsqueda y suscriptores. El error fatal `forbidden` o `operation_stale` hace la misma purga y conserva sólo ese enum técnico.

Los booleanos de lectura significan que esa operación publicó su resultado todavía vigente; no son una garantía de vigencia remota posterior. Toda cancelación resuelve localmente la Promise pública a false, aunque la fuente ignore el signal y nunca termine. Sus resultados o rechazos tardíos quedan observados/descartados, sin cambiar otro epoch. El controller no añade timeout: corresponde a la fuente finalizar su propio transporte.

## Snapshot, orden y concurrencia

`getSnapshot()` retorna la misma referencia congelada hasta un cambio de estado; `subscribe` no emite inmediatamente. Items, array, cursor y queries salientes son copias congeladas con allowlists mínimas. No se copian código, nombre, ownership ni campos extra de la fuente. Los errores se reducen a enums; nunca se inspecciona ni publica el mensaje del error.

El guard se verifica antes/después de lectura y en las operaciones públicas. Un false observado, excepción o reentrada del guard invalida monotónicamente; aunque luego vuelva a true, esa instancia no revive. La lectura de snapshot puede purgar silenciosamente para no provocar recursión de notificaciones. Los listeners pueden invalidar/cambiar consulta antes del dispatch, y se vuelve a comprobar el destino. No se inician lecturas desde notificaciones síncronas reentrantes: devuelven false. El caller puede llamar después de salir de la notificación. Excepciones de listeners se aíslan, y una baja de suscripción se respeta durante el recorrido. Una mutación reentrante no vuelve a notificar recursivamente; los listeners pendientes leen el snapshot más reciente.

El controller rechaza páginas con ids duplicados o posiciones fuera de orden, incluso frente a filas ya acumuladas. El orden es DESC(createdAt, id), conservando microsegundos y offsets de timestamps ISO validados por la fuente. El helper interno sólo compara posiciones técnicas: usa `Date.parse` de la parte sin fracción con zona explícita más la fracción en `BigInt`; no usa hora actual ni reglas de fechas comerciales. La representación original del cursor se conserva. UUIDs canónicos/normalizados y validez civil completa son precondiciones del puerto. No se reevalúan email, estado de expiración ni matching Unicode en el cliente.

`serverNow`, `totalPending` y `matchingCount` describen la última llamada exitosa; las filas acumuladas pueden proceder de varias llamadas. Una cancelación concurrente puede reducir el conteo por debajo de las filas acumuladas o dejar vacía una página posterior. No se exige `accumulated.length <= matchingCount` ni se borran filas previas inferidas a partir de ese conteo. No es una cartera congelada ni detección instantánea de cambios remotos. Un error no produce ceros ni éxito vacío ficticio; conserva hechos anteriores cuando corresponda o null si aún no hay lectura confirmada.

El dueño del runtime debe invalidar/disponer ante logout, cambio de cuenta/generación, membership o contexto, y tras cancelación/revocación conocida que afecte esta lectura. No puede confiar en que un snapshot local detecte revocación remota por sí solo. Cambios remotos no observados requieren una nueva lectura autorizada, cuya política visible no se define aquí.

## Evidencia e integración

Inspección read-only de ROOT: `data/coach-pending-invitations-validation.ts:15` define el comparador microsegundos/UUID; `:24` conserva raw query para normalización SQL; `:60` mapea DTO mínimo; `:78` deja matching Unicode al servidor; `:84` coteja orden contra el cursor; `:94` permite página posterior vacía por cancelación concurrente. El módulo de DOMAIN no copia ni importa ese parser o el SDK.

La suite local determinista prueba cancelación con fuentes deferred que ignoran abort, búsquedas/reloads tardíos, microsegundos/offsets, cambios de conteos, errores y datos malformados, single-flight, monotonicidad de identidad, listeners y copias inmutables. Su registro en el runner/package global está reservado a MAIN en ROOT. Este lote no ejecuta suite global ni build, no cambia los 32 archivos previos y no representa auditoría independiente ni QA manual. Integración, gates ROOT y auditoría independiente siguen a cargo del coordinador.

### Integración ROOT posterior — 2026-09-09

MAIN integró los cuatro archivos congelados y un runtime con 16 pruebas del SDK.
R2 ROOT: 170 invitaciones, 84 pagos, 144 dominio, npm test completo, lint, build,
typecheck y diff PASS. Se corrigió un registro de migración omitido del incremento
SQL anterior; el SQL no cambió. Detalle en
`docs/data/coach-pending-invitations-controller-local.md`.

Auditor independiente GPT-5.6 Sol medio READ-ONLY: PASS sin hallazgos verificables;
170 pruebas propias y hashes/logs comprobados. No QA/SQL remoto ni montaje UI.
El contrato/controller/test conservan exactamente el handoff DOMAIN; este anexo
de documentación ROOT es posterior y no modifica el documento congelado DOMAIN.

### Extracción privada con segundo consumidor — 2026-09-09

El incremento Active posterior reutiliza la mecánica de listado en
`internal/coach-client-list-controller.ts`. Pending mantiene su contrato público,
allowlist de invitaciones y los 33 casos existentes; sólo cambia el test de imports
para verificar también el helper privado. Cada instancia conserva su propio
estado y cancelación. No se comparte identidad, cursor, cola o snapshot entre
invitaciones y vínculos activos. La validación ROOT de esta extracción y del
runtime Active se registra en `docs/data/coach-active-relationships-controller-local.md`;
no debe confundirse con el PASS histórico anterior.
