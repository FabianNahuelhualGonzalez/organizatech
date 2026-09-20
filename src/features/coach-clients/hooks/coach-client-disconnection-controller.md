# Confirmación de cancelación o desvinculación

Controller puro y acotado al handoff Coach. No monta confirmaciones visibles,
no define textos, no modifica listados ni envía correo. No tiene dependencias de
pagos, entrenamiento, data, SDK, Auth, storage o UI. Se crean cinco archivos nuevos;
ningún modelo/controller anterior se reutiliza por copia ni se modifica.

## API y frontera de integración

`createCoachClientDisconnectionController({ selection, source, isCurrent, createRequestId })`
retorna load/openConfirmation/cancelConfirmation/canConfirm/confirm/reconcile/retry,
getSnapshot/subscribe/dispose. La selección capturada es `{ kind, id }`: invitation
o relationship, con id opaco y sin lookup de cuentas. El adapter debe aportar un
destino autorizado y validar UUID/DTO/acción, consentimiento, ownership, Auth fijo,
idempotencia y deadline total. Nada de eso se deduce de un identificador frontend.

Source consumer-owned contiene exactamente readSelection, disconnect y
readOwnOperation, todos con options.signal. El adapter de MAIN proyecta cancel a
invitation y revoke a relationship: sólo puede proyectar completed:true para esa
acción correcta. No puede perder el discriminante de acción al convertir recibos.
Read devuelve exclusivamente kind/id y state o endedAt; no códigos, nombres, emails,
ownership o actividad. El controller copia allowlists y nunca lee campos extra.
endedAt se trata como marcador temporal opaco no vacío; su formato canónico es
responsabilidad del adapter, no de un nuevo parser/reloj local.

isCurrent debe estar ligado a cuenta, portal/generación y selección capturados.
No basta comparar userId. False observado o excepción invalidan permanentemente;
volver a true no reactiva el controller. MAIN debe llamar también dispose al
reemplazar selección o desmontar. La consulta/QA remota prevista por la skill
Supabase no forma parte del alcance offline; la integración conserva ese límite.

## Lectura y confirmación explícita

Construcción, subscribe, openConfirmation y cancelConfirmation no hacen I/O.
load es explícito y no fabrica ningún estado si falla. Un read fallido preserva
el hecho anterior, marca needsRefresh y bloquea una nueva confirmación.

Sólo pending/expired de invitation y relationship con endedAt:null son accionables.
Una invitation accepted nunca se convierte en revoke; cancelled o un vínculo
terminado tampoco se vuelven a cerrar. openConfirmation requiere hechos confirmados
y ningún intento sin resolver. Abrir dos veces no crea otra operación. confirm
es el único dispatch inicial y exige la apertura explícita previa.

Cada intento conserva selección/requestId inmutables. La factory se invoca una
sola vez por intento nuevo; ids vacíos o reutilizados se rechazan. Single-flight
se reserva antes de publicar o llamar a la factory. Se vuelve a comprobar la
identidad y la confirmación después de listeners/factory y antes de dispatch.
Un listener que cancele antes del primer dispatch evita la escritura.

## Recibos y resolución

El recibo debe coincidir exactamente en kind, id, requestId y completed:true.
No basta un id coincidente ni un flag truthy. Después se lee la selección actual:
invitation debe estar cancelled y relationship debe tener endedAt no nulo. Un
read pending/expired/accepted o todavía activo no resuelve aunque exista recibo;
queda phase:recorded con invalid_response, needsRefresh y pending:null. No se
fabrica el estado terminal desde el recibo ni se reemplazan hechos con datos
incoherentes. La siguiente reconcile sólo repite el read si el recibo ya se conoce.

La transición a attempt.phase:resolved, con receipt.requestId estable, es la señal
para que una futura composición invalide la cartera una sola vez. No se agrega
un event bus, caché, callback de listado o invalidación con efectos en este lote.
Ver un target cerrado mediante load sin recibo propio no crea esa señal.

Timeout/abort/unavailable/invalid_response conservan phase:uncertain; errores
desconocidos se sanitizan como unavailable. No hay auto-retry. Reconcile consulta
el mismo requestId y coteja su recibo. Null no demuestra que el primer envío no
pueda terminar: sólo activa retryAllowed para retry explícito del payload/id
original. No habilita un nuevo intento ni cambia invitation por relationship.
Load por sí solo nunca resuelve un intento incierto, incluso si ve el target cerrado.

State_conflict del primer dispatch deja rejected y refresca hechos, sin éxito
falso ni nuevo write. Si ocurre al reintentar un envío antes incierto, permanece
uncertain: ese rechazo no demuestra ausencia del primer envío. Forbidden y
operation_stale invalidan y limpian el controller; no producen completed.

## Cierre, datos malformados y concurrencia

CancelConfirmation cierra localmente, incluso durante dispatch/incertidumbre, pero
conserva attempt. No revierte el envío y no permite abrir otra confirmación hasta
resolverlo. El retry explícito puede usar el intento conservado aunque el diálogo
esté cerrado. Dispose aborta localmente, limpia hechos/intento/listeners e invalida
respuestas tardías; no demuestra rollback de una escritura remota.

Snapshots, reads, selección y recibos se copian por allowlist y congelan. Subscribe
no emite al registrarse y devuelve unsubscribe; getSnapshot mantiene referencia
hasta un cambio. Excepciones de listeners se aíslan del resultado de transporte.
Sanitizadores capturan getters/Proxies que lanzan, leen una sola vez cada campo
necesario y no propagan mensajes crudos. Excepciones al obtener/invocar métodos
source también limpian pending, conservando incertidumbre cuando corresponde.
Se revalida liveness después de sanitizar, por posibles accesores reentrantes.

El adapter sigue debiendo entregar Promises acotadas por su deadline. Un source
que no asienta nunca no obtiene timers ocultos aquí; dispose limpia el estado
local y la señal abortable. Las pruebas usan puertos sintéticos/deferred, no red.

## Entrega y validación

El contrato se congeló primero para el bridge paralelo de MAIN. La implementación
no modifica archivos de ROOT ni modelos/pagos previamente auditados. ROOT debe
registrar `src/features/coach-clients/hooks/coach-client-disconnection-controller.test.ts`
en su suite junto al runtime, sin cambios de package en DOMAIN.

Las pruebas cubren confirmación explícita, estados permitidos/no permitidos,
recibos/target/estado final, single-flight, cierre durante envío, timeout/retry,
cambio de cuenta/generación/selección, dispose, reentrancia, getters/Proxies y
allowlists. Gates locales no son auditoría independiente ni PASS del flujo
integrado; QA y cualquier conexión visible siguen bajo autorización del dueño.

## Integración ROOT cerrada

Los cinco archivos se transfirieron byte-idénticos desde el handoff DOMAIN final;
ROOT registró el test y añadió la composición SDK separada. Gates ROOT secuenciales:
invitaciones88 (32controller+16runtime+40regresión), pagos84, dominio144,
npmtestpre/main/post, lint/build/typecheck/diff PASS. Auditoría independiente
GPT-5.6 Sol medio READ-ONLY PASS, sin hallazgos verificables, con focal88/diff
propios y verificación de hashes/baseline/protegidos. Evidencias en
`/tmp/organizatech-coach-disconnection-root.OAcbOG/`. Sólo este documento y el
documento de integración se actualizan tras la auditoría; no cambia el código.
No equivale a flujo Coach completo, migración QA, prueba manual ni producción.
