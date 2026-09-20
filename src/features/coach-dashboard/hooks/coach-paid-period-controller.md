# Controller de períodos pagados: contrato de integración

Controller puro por identidad/generación y episodio seleccionado. No monta UI,
no define textos, estados comerciales, reloj, pagos automáticos ni entrenamiento.
Usa el único draft/undo de `../model/coach-renewal-draft.ts` y el tipo de hecho
`CoachPaidPeriod` de `../model/coach-payment-period.ts`, sin modificar esos módulos.

## Composición y responsabilidades

`createCoachPaidPeriodController(input)` recibe `selection: { renewalId, episodeId }`,
`isCurrent`, `source`, `validation` y `createRequestId`. Construirlo no lee ni guarda,
no llama a la factory y no fabrica un baseline. `load()` es una lectura explícita.

El caller aporta un mapping renovación → episodio ya autorizado y un guard ligado
a cuenta, portal/generación y selección capturados. No basta comparar sólo userId.
Tras observar `isCurrent() === false` —o que el guard lance— el controller queda
invalidado permanentemente, aunque después el callback vuelva a true. Debe
llamarse también `dispose()` al desmontar o reemplazar esa identidad/selección.

El port estructural consumer-owned conserva cuatro métodos y las allowlists del
contrato: readPeriod(episodeId), confirmPeriod(payload5), correctPeriod(payload6) y
readOwnOperation(requestId), con `{ signal?: AbortSignal }`. Confirm/correct retornan
`{ status: "recorded", operation }`; no se duplica un repositorio o cliente SDK.
La futura integración ROOT adapta su repositorio validado. Ese adapter/servidor
siguen siendo autoridad para UUID/DTO, consentimiento, ownership, captura Auth,
deadline total, idempotencia y CAS. Un port que nunca termina no adquiere un
timeout oculto aquí; el controller no introduce timers ni credenciales.

`validation` debe ser el parser civil estricto de la integración. Los tests usan
un adaptador del modelo civil de esta misma feature; producción no importa otro
feature de calendario. Los helpers de read-facts validan fechas con el validador
existente sin un límite previo, porque el DTO no contiene vecinos: eso no modifica
ni pone a null el término pagado del baseline comercial.

## Apertura y único borrador

`open(baseline, target)` requiere un read exitoso y no obsoleto, sin otro detalle
abierto, operación pendiente o intento sin resolver. Comprueba baseline.id contra
selection.renewalId, versión contra read.version y último término contra el período
leído. Fechas presentes del baseline deben coincidir con ese read; correct exige
además fechas presentes y el periodId exacto. Sólo se corrige el período conocido
por esta lectura, no se deduce acceso a períodos históricos que no fueron leídos.
El source/state/provenance comercial sigue siendo dato tipado del caller, nunca
se inventa a partir del DTO. Un id de fila no se trata como episodeId.

Abrir/editar/aceptar/cancelar fechas y elegir pending/declined sólo cambian el draft
existente. `acceptDates()` no guarda. `canSave()` y `save()` usan exclusivamente
`prepareCoachRenewalPeriodCommand`, su contexto y el binding confirmado. Pending y
declined no se despachan como pago ni revocación. Confirm/correct mantienen las
reglas auditadas del modelo, fechas manuales y versión opaca sin incrementarla.

## Guardado, incertidumbre y reconciliación

`save()` representa Listo explícito. Reserva single-flight antes de publicar o
generar el requestId; crea un snapshot allowlisted e inmutable de acción, destino,
fechas, versión e identidad lógica. La factory se llama una vez por nuevo intento;
valores vacíos/repetidos se rechazan. Reconcile/retry nunca la llaman. El adapter
valida la forma UUID: este dominio no asume un formato para los ids opacos.

El estado técnico separa `confirmed` (último read), `draft`, `pending` y `attempt`.

| Fase de attempt | Significado y siguiente paso permitido |
| --- | --- |
| in-flight | Dispatch en curso; ningún segundo write. |
| uncertain | No hay recibo coincidente; sólo reconciliación explícita. |
| recorded | Recibo coincidente conocido, pero falta refrescar hechos actuales. |
| resolved | Recibo y read actual comprobados; operación terminal. |
| rejected | Rechazo definitivo del primer dispatch; edición no guardada. |

Timeout/abort/unavailable/invalid_response conservan el intento uncertain; errores
desconocidos se tratan conservadoramente como unavailable. No hay auto-retry ni
UUID nuevo. Una lectura normal puede refrescar hechos pero nunca resuelve por sí
sola un intento incierto. `canSave` continúa bloqueado mientras no sea terminal.
El código técnico se toma sólo de un descriptor propio de datos, dentro de
try/catch. Getters, propiedades heredadas y Proxy que fallen no se ejecutan como
lecturas de code ni propagan mensajes: el fallback es unavailable y termina el
pending correspondiente, conservando la incertidumbre de escrituras enviadas.

`reconcile()` sin recibo conocido consulta el mismo requestId. Coteja request,
acción, episodio, fechas y periodId conocido (correct debe mantenerlo; confirm no
puede reutilizar el período anterior). Un mismatch sigue uncertain. Si devuelve
null, **no** demuestra ausencia definitiva: mantiene uncertain y únicamente activa
retryAllowed. Sólo `retry()` explícito puede reenviar la solicitud original exacta,
sin incorporar ediciones posteriores ni permitir otro intento lógico.

Un recibo coincidente queda separado de los hechos: siempre se pide readPeriod
actual después. Puede devolver otro período/versión más reciente; no se reemplaza
por el recibo histórico ni se infiere vigencia actual de un prepago futuro. Si
falla esa lectura, el intento permanece recorded y la siguiente reconciliación
reutiliza el recibo ya comprobado, solicitando sólo readPeriod. Nunca vuelve a
despachar esa operación por ese fallo de lectura.

El ledger actual cambia su versión al escribir y no elimina períodos mediante
RPC. Por eso el recibo debe tener una versión distinta de la enviada, y el read
posterior debe contener un período y no repetir la versión anterior al envío.
Un resultado con esas inconsistencias no se publica como confirmed ni resuelve
el intento: conserva recorded para nueva lectura explícita. No se ordenan UUID
lexicográficamente ni se exige igualdad con el recibo si existe un write posterior.

CAS en el primer dispatch deja rejected, refresca hechos y conserva la edición
y versión anteriores; no hay rebase ni reenvío. El caller necesita una decisión
explícita y nueva apertura desde los hechos actualizados. Un rechazo del retry
de una operación antes incierta no prueba que el primer dispatch falló: sigue
uncertain y exige reconciliar. Forbidden/inactive_relationship/operation_stale
invalidan el controller y limpian datos de la selección.

## Cancelación, concurrencia y snapshots

Cancelar detalle se permite durante dispatch/incertidumbre: cierra únicamente el
draft, no borra attempt ni habilita otro write. Antes del primer dispatch se
revalida identidad y el mismo snapshot tras publicaciones/factory; si un listener
lo canceló o editó, no se envía. Después de despachar, cerrar no revierte el write.

Un resultado correcto sólo cierra el mismo objeto draft enviado. Ediciones o
cancelaciones posteriores no se reemplazan; sus versiones no se actualizan
silenciosamente. `getSnapshot()` mantiene identidad referencial hasta un cambio,
retorna objetos congelados y no expone objetos crudos del source o formulario.
`subscribe` no emite al registrarse; devuelve unsubscribe. Excepciones de listeners
se aíslan y no cambian el resultado de transporte ni generan falsa incertidumbre.

`dispose` aborta la señal en curso, limpia datos, tracking y listeners e invalida
todos los resultados tardíos. Eso no demuestra rollback de una escritura remota;
la siguiente selección debe leer hechos autoritativos, no asumir que no se guardó.

## Gates y límites

Las pruebas deterministas cubren bindings, confirm/correct/undo, single-flight,
guardas pre/post publicación, cambios de generación, cancel/edición concurrentes,
recibos incompatibles/históricos/null, retry estable, CAS, dispose e inmutabilidad.
No hay browser, filas reales, Auth real ni SQL. La validación Supabase remota de la
skill queda excluida por el alcance offline; estas pruebas no son QA del backend.

ROOT registró el test del controller y el runtime en la suite de pagos existente;
package.json de DOMAIN permanece intacto. Tras las correcciones de frescura ROOT,
31 pruebas puras + 13 SDK y todos los gates locales pasaron inicialmente. La
auditoría R1 encontró un LOW al inspeccionar metadatos de error malformados; el
fix suma dos regresiones puras (33 + 13 SDK) y los gates finales completos volvieron
a PASS. La revisión independiente R2 con GPT-5.6 Sol medio también terminó PASS:
LOW cerrado,84pruebas focales propias ydiffPASS, sin hallazgos nuevos. QA del dueño
y conexión visible siguen siendo gates distintos;
este documento no declara PASS del flujo completo.
