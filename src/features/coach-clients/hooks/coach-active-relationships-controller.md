# Listado activo: controller puro y mecánica privada compartida

## Límite del incremento

`createCoachActiveRelationshipsController({source,isCurrent,pageSize?})` es el segundo consumidor real de la paginación local, junto con pending. La mecánica se extrae a `hooks/internal/coach-client-list-controller.ts`; no es un store universal, una caché de cartera ni un registro de endpoints. Cada llamada a la factory crea su propio snapshot, listeners, epoch, solicitud y guard monótono. Sólo se comparten funciones y constantes inmutables sin identidad.

Los wrappers tienen codecs estáticos de campos, no políticas arbitrarias de ciclo de vida. Pending conserva `{createdAt,id}`, `totalPending` y su allowlist de invitación; active conserva `{linkedAt,id}`, `totalActive` y exclusivamente `{id,studentName,studentEmail,linkedAt}`. El tipo privado del total permite esos dos campos concretos y construye el snapshot directamente: no hay una segunda copia del estado ni caché de proyecciones. El contrato público pending no cambia. El cambio de su test de imports permite únicamente el módulo privado y mantiene los casos funcionales anteriores.

## Puerto y API

La fuente validada implementa `list(query,{signal}) -> Promise<Page>`. El futuro runtime MAIN adapta `repository.listActiveRelationships`; no se importa SDK, DTO Data o código de otro worktree. El repositorio es responsable de autorización, token fijado, UUID canónicos, validación civil completa del DTO y deadline total. `pageSize` omitido es 25; explícito debe ser entero entre 1 y 50 o la factory lanza `RangeError("invalid_input")` antes de I/O.

- Construcción, `subscribe`, `getSnapshot`, `setQuery` e `invalidate` no solicitan páginas.
- `setQuery(raw)` es síncrono: conserva el string exacto, cancela la lectura y limpia filas/cursor. También reinicia una consulta idéntica cuando había hechos o trabajo activo. Rechaza NUL, surrogates aislados o más de 254 bytes UTF-8; conserva el raw inválido para corrección y no lo envía. Un argumento runtime no string devuelve false sin sustituir la consulta tipada anterior.
- `load()` solicita primera página con cursor null, salvo que ya haya solicitud activa. `reload()` reemplaza/aborta cualquier solicitud y vuelve a primera página: conserva filas previas de la misma consulta mientras carga/error, pero descarta el cursor antiguo.
- `loadNext()` exige primera página, cursor y ausencia de solicitud activa. Un error conserva filas/hechos/cursor y sólo otra llamada explícita puede reintentarlo. No hay retry, debounce ni polling automáticos.
- `invalidate()` cancela y purga hechos, conservando raw query si sigue vigente. `dispose()` borra también la búsqueda y hace terminal la instancia. Ninguna escribe en backend.

Las Promises públicas de lectura resuelven false al cancelar aunque el source ignore abort o nunca termine. Éxito significa publicación todavía vigente de esa operación, no vigencia remota futura. Una respuesta/rechazo tardío no cambia otra consulta/epoch. El guard de owner/generación/contexto se comprueba antes/después y al leer el snapshot: false, excepción o reentrada observados disponen permanentemente la instancia, sin revivir cuando el callback vuelve a true.

Los listeners pueden invalidar antes del dispatch. Una lectura solicitada desde notificación síncrona devuelve false; excepciones de listeners no se convierten en fallo de transporte y unsubscribe se respeta durante el recorrido. `getSnapshot` puede purgar silenciosamente para evitar recursión. Los listeners, solicitudes y guards de una instancia no bloquean ni disponen otra, incluso si ambas filas tienen el mismo UUID.

## Datos, cursor y revocación

El `id` es el episodio de vínculo, no el alumno ni una nueva prueba de identidad. Los nombres/correos consentidos se copian sin normalización o lookup. No salen `createdAt`, expiración, estado de invitación, ownership, `cycle:null`, sesiones cero ni progreso inventado, aunque el objeto fuente incluya campos extra.

El source entrega ISO finito válido, microsegundos y UUID normalizado. La mecánica compara timestamps con zona explícita más su fracción de microsegundos y después UUID, preservando el string original del cursor. No usa reloj implícito ni trunca a milisegundos; rechaza orden imposible y duplicados dentro de la página o frente al acumulado. La validez temporal completa y rango UTC 1..9999 son responsabilidad del repositorio validado. No impone `linkedAt <= serverNow`: un futuro finito admitido por ese contrato sigue siendo un snapshot autorizado.

Los conteos y `serverNow` corresponden a la última llamada exitosa, mientras las filas pueden proceder de distintas llamadas. Una página posterior puede quedar vacía tras revocación y los acumulados superar el nuevo `matchingCount`; no se mezcla eso con corrupción ni se infiere qué filas desaparecieron. Los errores mantienen enum seguro y datos anteriores sólo en la misma identidad/consulta, o null si no hubo lectura confirmada; no se convierten en cartera vacía ficticia. `forbidden`/`operation_stale` purgan permanentemente.

El dueño del runtime debe invalidar/disponer al cambiar cuenta, generación, portal o membership y al conocer una desvinculación. La lectura no detecta mágicamente cambios remotos posteriores. No se decide aquí cómo presentar ni cuándo solicitar una relectura visible.

## Integración y evidencia

Contrato ROOT inspeccionado read-only: `data/coach-active-relationships-contract.ts:4` define cursor y DTO; `data/coach-active-relationships-validation.ts:21` ordena por microsegundos/UUID, `:26` conserva raw query y `:87` permite páginas vacías posteriores. `docs/data/coach-active-relationships-adapter-local.md:22` conserva identidad consentida, `:25` permite fechas futuras y `:50` exige invalidación del consumidor. Ninguno de esos archivos se modifica en este incremento.

Las suites focales conservan los 33 casos pending y añaden los de active, incluidos aislamiento de ambos consumidores, identidad allowlisted, límite UTF-8, futuro finito, cursor preciso, errores, cancelación y reentrancia. No se expone un API público del mecanismo privado ni se conecta UI. MAIN registra la suite active, compone runtime/SDK y actualiza su apéndice documental pending después de la integración; package y documentación pending DOMAIN permanecen intactos.

Este incremento comprende cinco archivos nuevos y sólo controller/test pending modificados. Los hashes de los dos originales se conservan en el handoff antes de generar el delta. Los gates locales no sustituyen auditoría independiente, integración ROOT o QA manual; no se ejecuta suite global/build en DOMAIN ni se consulta remoto.
