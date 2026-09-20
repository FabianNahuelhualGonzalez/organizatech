# Acciones de invitación por generación — integración vigente

Controller puro feature-local para reservar un reenvío vigente o regenerar una
invitación vencida. No monta UI, no cancela/desvincula, no crea invitaciones ni
envía correo. Sus nombres corresponden a comandos técnicos del backend; true
nunca significa correo enviado, proveedor aceptado ni consentimiento del alumno.

## Contrato obligatorio de la fuente

`createCoachInvitationActionsController({selection:{invitationId}, source,
isCurrent, createRequestId})` captura la selección y referencias del caller.
No asume que una fila paginada contiene generación: ésta viene de load explícito.

La fuente validada de nueva generación debe implementar exactamente:

- resend/regenerate con {invitationId,expectedGeneration,requestId}.
- readOwnOperation(requestId): operation7 o null; conflicto con operación legacy
  es error, nunca null ni operación sin expectedGeneration.
- readInvitation(invitationId): sólo {id,generation,state}.
- operation7: requestId/action/state/invitationId/expectedGeneration/generation/
  reservedAt; action resend|regenerate y state reserved|cancelled.
- result: recorded {serverNow,operation} o rate_limited {serverNow,retryAt}.

El bridge MAIN usará los métodos generation-bound del repository nuevo, no las
RPC antiguas. No puede descartar expectedGeneration ni volver a v1 como fallback.
La comparación atómica en servidor es requisito: un preflight cliente o una
comprobación posterior no evita que un write se aplique a otra generación.
El backend correspondiente se implementa/audita aparte; este lote no demuestra
su implementación, autorización ni ejecución.

El source/runtime valida Auth, owner, UUID canónicos, DTO completos, timestamps,
serverNow/retryAt y deadline total. Aquí se verifica el binding con la intención
y se copian allowlists. Los timestamps no vacíos no sustituyen su validación
temporal en el adapter. No hay parser email, reloj cliente ni código compartido
con otra feature. Generaciones se admiten de1 a INT_MAX (2147483647), sin coerción.
Regenerate en MAX conserva el comando y deja el conflicto al servidor; no inventa
otra generación ni se transforma a resend.

## Lecturas y acciones explícitas

Construir/suscribirse/getSnapshot no invoca source ni factory. Load es la única
lectura inicial, no escribe. Pending habilita sólo resend; expired sólo regenerate;
accepted/cancelled no habilitan ninguna. La caducidad la determina el estado
servidor; no Date.now, timers, reintentos invisibles o expiración calculada.

Load puede reemplazar otro load: lo aborta y resuelve false su promesa incluso si
la fuente ignora abort. Un fallo no publica vacío, cero ni cierre. No reemplaza
un intento incierto/recorded/rate-limited. Después de resolved/rejected, sólo un
load exitoso descarta ese tracking terminal y habilita una intención nueva.
Un load fallido conserva el intento anterior pero no autoriza otro write.

Cada nueva acción consume una única llamada a createRequestId y congela
action/invitationId/expectedGeneration/requestId. UsedRequestIds por instancia
impide reciclar el id tras un rechazo o nuevo load. Doble toque y acciones
simultáneas comparten single-flight; ni listeners ni factory pueden reentrar
para iniciar un segundo write. No se impone un límite comercial por sesión:
backend y futuro caller visual conservan sus responsabilidades existentes.

## Binding, receipt y read fresco

Resend requiere operación con expectedGeneration=G y generation=G.
Regenerate requiere expectedGeneration=G y generation=G+1. Siempre se comparan
requestId, action e invitationId exactos. No se acepta operación create/cancel/
revoke, legacy sin binding ni generación distinta.

Una operación recorded exige read fresco antes de resolver:

- Misma generación del operation + reserved/pending: resolución reserved.
- Misma generación + expired/cancelled/accepted: resolución inactive, sin otra
  acción. Esto no es estado global de cartera ni declaración de envío.
- Read de generación mayor: resolución inactive de la intención antigua;
  confirmed=null, no se adopta la nueva generación.
- Read menor, binding distinto o cancelled con pending de la misma generación:
  issue seguro y tracking retained, nunca falso éxito.

Reconcile siempre vuelve a leer el operation porque reserved puede pasar a
cancelled. No permite volver cancelled a reserved. Con operación conocida, null
es inconsistencia: no elimina evidencia ni habilita retry. Con operación aún
desconocida, null habilita retry EXPLÍCITO del mismo comando; no demuestra ausencia
definitiva ni autoriza nuevo UUID/rebase/otra acción.

Timeout/aborted/unavailable/invalid_response/request_conflict conservan intención
incierta. Lecturas fallidas también mantienen tracking, incluso si el error
señala conflicto legacy. Un rechazo técnico/negocio definitivo antes de toda
incertidumbre deja rejected; no es éxito. Tras incertidumbre, un rechazo posterior
no elimina el posible write original.

## Rate limits y ciclo de vida

Primer rate_limited validado: no reservó esa llamada; permite retry explícito del
mismo id/generación para revalidación backend. Metadata sólo serverNow/retryAt.
Tras incertidumbre previa, rate_limited no prueba ausencia de reserva anterior:
se conserva tracking, se deshabilita retry hasta reconciliación explícita. No
cuenta regresiva, sleep/poll ni uso del reloj del dispositivo.

No existe estado de modal ni método close: el controller del portal impide cerrar
el detalle o cancelar la invitación mientras haga falta reconciliar una intención
enviada/incierta. La UI ofrece `reconcile` y, sólo tras ausencia autoritativa,
`retry` con el mismo requestId y payload congelado.
Dispose sí purga/aborta permanentemente y resuelve false todo trabajo público
pendiente aunque la fuente ignore abort. No deshace el write remoto ni conserva
un ledger de recuperación después de descartar la instancia.

isCurrent captura owner/generación de sesión/portal/selección; la generación de
sesión NO es invitation generation. False/throw observado invalida de forma
monótona, incluso si luego vuelve true. El owner debe invalidar en logout,
membership o cambio contextual; no hay detección mágica de revocaciones remotas.

Snapshots y nested records son copias congeladas; input/source originales no se
congelan. getSnapshot puede purgar por contexto obsoleto sin notificar
recursivamente. Subscribe no emite estado inicial. Excepciones de listeners,
métodos/accessors/Proxies no publican datos privados ni dejan pending colgado.
Errores expuestos: sólo el enum técnico, nunca message/cause/DTO ajeno.

## Entrega y límites

Cinco archivos nuevos propios. Reconciliation separa copia/binding de DTO del
ciclo concurrente del controller; no se cambia helper compartido ni controller
creación/cancelación/listados. No code, email, nombre, provider flags, copy/share
o receipt visual en contrato/snapshot.

Pruebas locales deterministas cubren40 casos: load/epochs, dos acciones, G/G+1/MAX,
conflicto atómico simulado, replay cancelled, null conocido/desconocido, v1 error,
rate limits e incertidumbre, identidad/dispose, fuente que ignora abort,
reentrancia y datos malformados. La fuente sintética no prueba SQL real.
Registro package, bridge SDK, gates globales ROOT, auditoría independiente y
eventual QA del dueño se ejecutan aparte. No declarar integración lista antes
del PASS backend y sus gates; ninguna reserva habilita un receipt de correo.
