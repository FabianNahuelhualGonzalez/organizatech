# Reserva local de invitación: contrato de integración

Controller puro y específico de `coach-clients`. No importa UI, SDK, persistencia,
correo ni proveedor; la composición productiva lo consume mediante su runtime.
Cada instancia captura un contexto autorizado
(account/generation/portal) y conserva una única intención de reserva. Un rechazo
definitivo permite una intención nueva; una reserva conocida o una incertidumbre
no se descartan al editar, cerrar o volver a abrir.

## Puertos y responsabilidades

`createCoachInvitationCreationController({ source, isCurrent, createRequestId,
prepareRecipientEmail })` captura las referencias suministradas al construir.
La construcción no invoca esos callbacks ni la fuente.

- `prepareRecipientEmail(raw): string` es síncrono, puro y sin lookup de cuentas.
  El runtime debe inyectar el normalizador canónico del repository; el controller
  no reutiliza el validador legacy del formulario ni redefine sus límites.
- `createRequestId()` debe producir un UUID válido nuevo, validado por el runtime.
  Se invoca una vez por nuevo submit admitido, nunca desde retry/reconcile/close.
  La instancia impide reutilizar un id ya consumido para otra intención.
- `isCurrent()` debe comprobar la identidad/generación/portal capturados. Un
  false o una excepción observada invalida permanentemente la instancia.
- `source.create({ recipientEmail, requestId }, { signal })` devuelve
  `recorded { serverNow, operation }` o `rate_limited { serverNow, retryAt }`.
- `source.readOperation(requestId, { signal })` devuelve la operación create o
  null. La operación contiene únicamente requestId/action/state/invitationId/
  generation/reservedAt.
- `source.readInvitation(id, { signal })` proyecta exclusivamente
  id/recipientEmail/generation/state. Nunca transporta código ni identidad de una
  cuenta descubierta, flags de entrega o receipt del proveedor.

La fuente está validada por el adapter/repository: autorización, UUID, email,
DTO completos, timestamps y relaciones de metadata, reloj servidor, token
capturado y deadline total siguen siendo su responsabilidad. Este controller
verifica el binding de la respuesta con su intención y copia allowlists; no
reimplementa SQL ni supone que un timestamp no vacío sea validación de servidor.
No congela objetos originales del caller o de la fuente.

## API local

`open/close/setEmail/canSubmit/getSnapshot/subscribe/dispose` son síncronos.
`submit/reconcile/retry` retornan `Promise<boolean>`. True significa que esa
ejecución verificó una reserva exacta todavía pending, no envío, consentimiento
ni vinculación activa. Un cierre resuelto inactivo devuelve false sin inventar
un error. Repetir submit mientras existe una reserva no crea otra operación.

`setEmail(raw)` conserva el texto crudo y calcula su validez mediante el callback
capturado. Una validación que falla no expone su excepción ni reemplaza el texto.
La intención enviada congela separadamente el email canónico y requestId. Editar
después de dispatch no altera esa intención ni borra su resultado.

`close()` antes del primer dispatch cancela esa preparación sin write. Después
del dispatch sólo cambia isOpen: mantiene el intento, la promesa y su tracking.
No aborta una reserva ya enviada ni permite un segundo submit. Reabrir no escribe.
La composición productiva representa estos hechos sin descartarlos: conciliación
y retry permanecen explícitos y un resultado resuelto rota sólo tras el cierre.

## Reserva y reconciliación

La respuesta recorded debe ser action=create con el requestId exacto. El detalle
fresco debe corresponder al invitationId y email canónico originales:

- Misma generación + operación reserved + detalle pending: resolved/reserved.
- Misma generación + detalle expired/cancelled/accepted: resolved/inactive; no
  cancela, regenera, revoca ni acepta nada.
- Generación mayor: la intención anterior queda inactive; confirmed permanece
  null y no se adopta la nueva generación.
- Generación menor, binding distinto o cancelled + misma generación pending:
  no éxito; se conserva la evidencia y se informa un enum seguro.

Una operación de reserva puede cambiar de reserved a cancelled. Por eso
reconcile vuelve a leerla aunque ya se conozca. No permite cambiar id/generación
de esa operación ni regresar cancelled a reserved. Un null posterior a una
operación conocida no elimina evidencia ni habilita retry.

Timeout/aborted/unavailable/invalid_response/request_conflict conservan el
intento incierto. Reconcile es explícito y no escribe. Sólo null cuando aún no
se conoce operación habilita retry del MISMO email/requestId congelado; no
demuestra ausencia definitiva, no crea otro id y no incorpora ediciones nuevas.

Excepción explícita: el primer rate_limited validado no reservó en esa llamada,
por lo que permite retry explícito del mismo comando para revalidación backend.
No usa Date.now, espera, polling ni cuenta regresiva. Tras una incertidumbre
previa, rate_limited no prueba que el intento original nunca reservó: conserva
tracking y exige nueva reconciliación antes de retry. `rateLimit` expone sólo
serverNow/retryAt; no otorga capacidad de enviar.

## Concurrencia y consumo de snapshots

Hay un solo vuelo por instancia, sin estado global, cola, caché o reintentos
automáticos. Guards antes/después de callbacks, listeners, accesos a métodos y
await impiden continuar con un contexto invalidado. Los listeners no pueden
iniciar writes reentrantes; sus excepciones no se convierten en incertidumbre de
transporte. Unsubscribe no cambia el resultado comercial.

Los snapshots y sus objetos anidados son copias congeladas. `getSnapshot()`
observa el guard y puede purgar silenciosamente; `subscribe` no emite el valor
inicial. El consumidor debe leer un snapshot al suscribirse. `pending` queda
limpio al terminar, fallar o invalidarse una operación. Errores/getters/Proxies
malformados no publican mensajes privados ni convierten fallo en reserva.

`needsRefresh` marca reconciliación local pendiente, no una suscripción remota.
El dueño debe disponer/invalidate por logout, cambio de membership o contexto:
una lectura no descubre revocaciones posteriores por magia. `dispose()` aborta,
purga datos, invalida resultados y resuelve false las promesas públicas pendientes
aunque la fuente ignore abort. No revierte un write ya enviado ni permite
recuperarlo desde la instancia descartada.

## Verificación y límites de entrega

La suite determinista propia cubre alias canónicos, allowlists y ausencia de
código/provider, null y operaciones cambiantes, generaciones, rate limits,
single-flight, cierre pre/post dispatch, factory/normalizador/listeners
reentrantes, cambio de cuenta/generación/portal, getters/Proxies, errores seguros,
dispose con fuente que ignora abort y resultados tardíos.

Los gates focales y la regresión de modelos/controllers son locales. El bridge
SDK y la conexión productiva viven en la integración del portal Coach; los gates
globales y la auditoría independiente corresponden al cierre coordinado. No se
ejecuta QA manual ni remoto, no se publica nada y una reserva no puede usarse
como `CoachClientInvitationReceiptView`.
