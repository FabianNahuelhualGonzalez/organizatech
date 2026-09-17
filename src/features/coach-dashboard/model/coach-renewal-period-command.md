# Comandos de período pagado desde el borrador comercial

Incremento puro, sin montaje de UI ni persistencia. Reutiliza el único
`CoachRenewalDraft`, su override y el undo del modal. No incorpora estados
comerciales, textos de producto, reloj, duración automática ni entrenamiento.

## API y compatibilidad

- `openCoachRenewalDraft(baseline)` mantiene la apertura legacy: contexto ausente
  significa confirmar un próximo período, nunca inferir una corrección.
- `openCoachRenewalPeriodDraft(baseline, target)` permite elegir explícitamente
  `{ action: "confirm" }` o `{ action: "correct", periodId }`. Devuelve `null` si
  el target es inválido, si confirm trae `periodId` (incluso undefined), o si
  `baseline.id`, `baseline.version` o el `periodId` requerido no son cadenas con
  contenido. No normaliza esos valores ni los convierte en UUID.
- El contexto copia por allowlist el target y fija `renewalId`/`expectedVersion`
  desde el snapshot del baseline. Baseline, contexto, fechas y undo son inmutables.
  Campos adicionales de entrada, incluido ownership, no entran en el comando.
  El resto del baseline mantiene el contrato tipado existente; esta apertura no
  es un parser universal de respuestas o formularios desconocidos.
- `prepareCoachRenewalDraftSave` conserva los resultados legacy de confirmación
  y las intenciones comerciales pending/declined. Bloquea un contexto correct
  mediante `period-command-required`: un consumidor anterior no puede ignorar
  accidentalmente la acción y convertir una corrección en una confirmación.
- El nuevo caller de persistencia usa `prepareCoachRenewalPeriodCommand`.
  `unchanged` y `blocked` no generan operaciones. Un `ready` contiene exactamente
  `command: { action, renewalId, expectedVersion, dates: { start, end } }`, con
  `periodId` adicional **sólo** cuando `action === "correct"`. Comando y fechas
  están congelados; no contiene estado comercial, episodeId, requestId ni owner.

## Validación y transiciones

Confirmar conserva la regla existente: fechas civiles canónicas y reales,
`end > start` y, si existe último término pagado, `start > currentPaidPeriodEndsOn`.
El primer período admite `currentPaidPeriodEndsOn === null`, sin generar fechas.

Corregir exige el target explícito, fechas civiles estrictas y `end > start`.
No compara el inicio con el propio término registrado: corregir no es anexar.
`currentPaidPeriodEndsOn` y las fechas del baseline permanecen intactos, incluso
cuando no intervienen en esa validación. No se inventa `previousEnd` ni se
declara que las fechas estén libres de solapamientos: vecinos y concurrencia
siguen siendo responsabilidad del servidor. Ambos caminos requieren el mismo
puerto de parser civil estricto; un fallo del parser bloquea la edición.

Aceptar el modal sólo retiene el override y cierra ese modal. Cancelarlo restaura
exactamente su override anterior; cancelar el detalle descarta override y undo,
cierra el detalle y conserva el snapshot/contexto técnico sin habilitar guardado.
Abrir o editar fechas nunca cambia de target. Volver de pending/declined a renewed
mantiene buffer y contexto. La preparación de períodos bloquea esas dos marcas
manuales con `unsupported-commercial-state`; un draft intacto sigue `unchanged`.
No son pagos ni revocación y este backend no las persiste.

Los guards existentes de detalle cerrado/modal abierto siguen vigentes. Un
contexto explícito malformado produce `invalid-period-context`; un contexto cuyo
renewalId o versión no coincide con el baseline produce `invalid-period-binding`.
No se degrada un contexto inválido a confirm. Esa comprobación es consistencia
local, no autorización: no demuestra que periodId pertenezca al episodio/Coach.

## Contrato para el futuro caller y evidencia de integración

El caller debe abrir a partir de una lectura autorizada, elegir confirm/correct
explícitamente y obtener el periodId real de esa lectura para correct. `baseline.id`
es un identificador opaco de renovación: **no** equivale por contrato a episodeId
ni periodId. La versión se preserva exactamente y el puerto de datos la validará
otra vez. No debe modificar el baseline o eliminar el contexto para cambiar de
acción; una operación distinta requiere una apertura deliberada y otro snapshot.

El consumidor concreto es la futura conexión de `onAcceptDates` y `onSave` del
detalle existente; hoy están separados en
`src/features/coach-dashboard/components/coach-renewal-detail-view.ts:44` y `:50`
(ROOT, inspección read-only). Este incremento no modifica ese contrato ni decide
cómo presentar confirm/correct, validación o errores.

En ROOT, `src/features/coach-clients/data/coach-paid-periods-contract.ts:51`
requiere episodeId, start, end, expectedVersion y requestId para confirm; `:58`
agrega periodId para correct. La lectura y el recibo exponen el período y acción
en `:28` y `:40`. El repository valida sus allowlists y UUID en
`src/features/coach-clients/data/coach-paid-periods-repository.ts:115`, y selecciona
las operaciones distintas en `:124` y `:130`. Estos son contratos inspeccionados,
no imports o dependencias de otro worktree.

La futura composición debe resolver el binding autorizado renewalId → episodio,
capturar identidad/generación y mantener un requestId estable por operación fuera
del formulario. Debe conservar el mismo draft/contexto/comando ante timeout o CAS,
sin rebase, reemplazo del borrador ni reintento automático con versión nueva.
Leer/reconciliar un resultado no autoriza sobrescribir una edición posterior;
el caller debe cotejar operación, acción, target y snapshot, y descartar resultados
de otra cuenta/generación. Nada de ese lifecycle asíncrono se implementa aquí.

## Verificación acotada

Las pruebas del archivo existente cubren regresión legacy, targets/bindings
malformados, corrección del mismo período, fechas civiles y bisiestos, undo/cancel,
detalle cerrado, pending/renewed, allowlists e inmutabilidad. No se agrega una
suite nueva que requiera registro: ROOT ya registra `coach-renewal-draft.test.ts`.
ROOT integró este patch de tres archivos y completó gates globales secuenciales.
Auditoría independiente GPT-5.6 Sol medium READ-ONLY del lote ROOT13: PASS, sin
hallazgos. El auditor ejecutó 35/35 de este borrador dentro de sus 83 focales.
Evidencia: /tmp/organizatech-coach-paid-runtime.EK8A5O/. La integración del caller,
montaje y QA siguen pendientes; este resultado no constituye PASS del flujo completo.
