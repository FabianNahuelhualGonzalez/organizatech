# Clientes Coach · lista, detalle y vinculación controlados

Clasificación actual: **conectado en el portal Coach** mediante
`CoachWorkspaceBoundary` y su controller de feature. Los componentes conservan
un contrato presentacional y no consultan ni persisten por sí mismos. Fuente visual:
`handoff-vinculacion/reference.html`, secciones de cabecera, búsqueda, pestañas,
filas y los cuatro estados vacíos aprobados por el dueño de producto.

## Alcance

`CoachClientsView` compone `CoachClientsHeader`, `CoachClientsSearch`,
`CoachClientsTabs` y `CoachClientsList`. La lista usa `CoachClientRow`,
`CoachClientsEmpty` y la primitive productiva `StatusMessage`. El único botón
Volver es `AppBackButton`, y sólo se muestra si recibe navegación contextual real.
No se recrean topbar, menú, notificaciones ni rutas.

Los Buttons preparados son Agregar, Limpiar búsqueda, las tres pestañas y cada
fila para abrir detalle. Cada vacío usa exactamente su CTA del handoff.
El quinto lote agrega `CoachClientDetailSheet`, `CoachClientCodeCard` y
`CoachClientUnlinkConfirmation`: hoja de detalle, tarjeta de código pendiente y
confirmación anidada. Volver a vincular pertenece al detalle de una baja, nunca
a la fila/cabecera. El sexto lote agrega `CoachAddClientSheet` en dos pasos,
sin perfil del alumno, generación de códigos,
envío de correo, clipboard real, apertura de WhatsApp ni mutaciones remotas.

## Contrato

`coach-clients-view.ts` contiene exclusivamente props locales. El controlador
entrega pestaña, búsqueda, contadores, filas ya autorizadas/filtradas y etiquetas
de resultado/fechas. La UI no busca, cuenta, consulta, formatea ni persiste datos.
Los eventos llevan identificadores estables o el texto de búsqueda sin modificar;
no aceptan ni escriben ownership. Las acciones sin callback quedan deshabilitadas
y el buscador queda read-only si falta `onQueryChange`.

- `null` significa desconocido, nunca cero. El mapper entrega también la etiqueta
  correspondiente para contadores. Un ciclo ausente no transforma activo en pendiente.
- Una fila pendiente sólo admite correo y metadato de invitación: no nombre,
  iniciales, progreso ni detalles del alumno antes de consentimiento. El render
  ignora nombres adicionales incluso si un consumidor no tipado los entrega.
- Activos y bajas sólo reciben identidad que la proyección de consentimiento
  permita. El backend sigue siendo responsable de autorizar datos, no esta UI.
- Los ratios sólo son geometría suministrada: se acotan para dibujar; desconocidos
  no generan progreso. Pendiente usa rayado ámbar decorativo, no una barra de avance.
- `content` distingue filas, vacío y mensaje controlado de carga/error. No usar
  un vacío para esconder un error o un resultado todavía no obtenido. Los textos
  de error/carga provienen del mapper y se presentan con `StatusMessage` existente.

## Quinto lote: detalles y confirmación

`coach-client-detail-view.ts` discrimina activo / pendiente / baja. Pendiente
sólo admite correo, solicitud, espera y código/capacidades: no nombre/iniciales
ni actividad, tampoco en títulos ARIA. Activo sigue activo sin ciclo; `Ver su
ciclo y rutinas` exige tanto capacidad como callback y no inventa una ruta.
Una baja sólo consume identidad/hechos históricos autorizados por la proyección.

- Todos los hechos/fechas/procedencia, estado correo, vencimiento, ayuda y labels
  llegan del mapper. No se reutilizan nombres ni fixtures del prototipo en runtime.
- Copiar/WhatsApp/reenviar son eventos: no acceden al clipboard ni a la red.
  `isCopied` y `isResent` son confirmaciones reales externas, nunca efectos del
  clic. Labels y flags deben ser coherentes. No se confunde una solicitud creada
  con la entrega efectiva del email; `deliveryLabel` conserva esa distinción.
- `canResend` representa elegibilidad autoritativa: regla aprobada de código 7d,
  3 reenvíos/24h y espera 60s resueltas fuera de UI. Un reenvío confirmado no
  impone el antiguo bloqueo por sesión del prototipo; no se calculan cuotas aquí.
- Si reenvío/regeneración queda incierto, la ficha conserva la intención y ofrece
  revisar estado o reintentar según el controller. Cerrar y cancelar quedan
  bloqueados hasta resolverla; nunca se cambia requestId ni generación en UI.
- Ayuda de activación es un label inyectado: no se promete el destino `Mi perfil`
  del prototipo porque esa pantalla de alumno está aplazada.
- Abrir confirmación emite id + estado. Sólo se monta sobre el mismo id/estado
  del detalle; una confirmación ajena/obsoleta no ofrece acción destructiva.
  Confirmar emite otro callback; cerrar/cancelar no altera el vínculo.
- Activo y pendiente conservan textos distintos. El botón destructivo contorneado
  va arriba; el seguro azul va debajo y recibe foco inicial. No se promete acceso
  futuro al historial del alumno.
- Volver a vincular emite únicamente el correo exacto de la fila; el futuro
  controlador abrirá HojaAgregar y gestionará la nueva solicitud.

Se reutiliza `src/ui/coach-overlays/` sin imports Dashboard↔Clientes ni segundo
motor de foco. La confirmación permanece como hermana del detalle montado; cada
capa tiene fondo inert independiente y Escape sólo alcanza la superior. La
restauración al disparador inferior está probada. El retorno a una fila
reconstruida por mutación necesita coordinación del controller integrado: el
motor actual captura el nodo al abrir y no relee la ref al cerrar. Está registrado
en el README del overlay compartido y no se afirma PASS de ese escenario integrado.

## Sexto lote: agregar cliente

`coach-add-client-view.ts` define borrador y comprobante discriminados. La hoja
compone `CoachClientInviteEmailStep`, `CoachClientInviteReceiptStep` y
`CoachClientInvitationSteps`. `CoachClientCodeButton` se extrae de la tarjeta
de código ya existente y tiene dos consumidores reales (detalle y comprobante),
sin importar código de otra feature ni duplicar comportamiento.

- El correo crudo, hint, elegibilidad y validación vienen del mapper. Escribir no
  consulta perfiles ni crea invitaciones. El tono neutral no muestra un error de
  formato al escribir la primera letra. Duplicados pendientes sólo pueden usar
  correo; nombres de activos sólo si la identidad ya está autorizada.
- Los tres pasos coloreados conservan el diseño, pero sus instrucciones se
  reciben como copy aprobado. No se promete `Mi perfil` ni una pantalla de alumno
  todavía no implementada. El prefill de revinculación es únicamente `emailRaw`.
- Enviar sólo emite intención. El controlador valida, controla single-flight y
  entrega `isBusy`. Mientras envía, input, X, scrim y submit quedan bloqueados.
  No hay cambio optimista de paso, generación de códigos ni solicitudes de red.
- Paso 2 exige un comprobante `source: server`, id, correo y código concretos y
  estado `provider-accepted` o `delivered`. El correo del comprobante prevalece
  aunque el borrador haya cambiado. La guardia es presentacional, no autorización.
  `queued`/reserva sin confirmación no muestra éxito ni permite otro envío.
- Aceptación del proveedor no equivale a entrega al buzón. `deliveryLabel`, título
  y explicación deben describir fielmente el comprobante. El controlador debe
  mantener paso 1/busy/error hasta contar con ese resultado, sin usar el prototipo
  como prueba de envío. La confirmación real se anuncia con `role=status`.
- Copiar y WhatsApp emiten sólo id de la invitación; el controlador resuelve su
  contenido confirmado y realiza la acción. `Copiado` exige `isCopied === true`.
  `Ir a mi lista` emite exactamente `onOpenPendingClients("pending")`.
- X/scrim/Escape sólo cancelan; no crean invitaciones ni alteran vínculos. El
  controlador debe distinguir cierre de un comprobante existente de una mutación.
  Ninguna acción se habilita sin su callback/capacidad y fuera de busy.
- Una incertidumbre conserva la misma intención y ofrece conciliación explícita;
  sólo una conciliación sin operación habilita reintentar el mismo requestId/email.
  Tras cerrar un resultado resuelto se rota la instancia para admitir otra
  invitación, sin descartar jamás un intento incierto.
- La hoja usa el mismo overlay durante correo → busy → comprobante. Su ownership,
  inert y captura del disparador no se reinician al cambiar contenido. El foco
  permanece en el diálogo durante busy y Tab recorre los nuevos controles; el
  comprobante se anuncia sin un segundo motor de foco ni remontar la hoja.

## Accesibilidad y responsive

Se conserva fondo global `--background` y fuente heredada, CSS Modules y un
contenedor nombrado de máximo 430px. El contenedor padre deberá proporcionar
altura flex acotada al conectar; sólo la lista tiene scroll vertical, con
`min-height:0`. Cabecera, buscador y tabs permanecen fuera de ese scroll.
Los tabs permiten flechas, Home/End y activación nativa Enter/Espacio; la selección
sigue siendo controlada. Al limpiar se devuelve foco al input sin abrir/cerrar
teclados programáticamente. Los nombres y correos largos usan elipsis.

Todo target tiene al menos 44px; se resuelve así la contradicción del prototipo
que dibujaba Limpiar a 36px. Inputs a 16px, foco visible y reduced motion.
El tono secundario blanco/.55 evita reducir contraste con opacity en filas bajas.
No se ha realizado revisión visual en navegador ni QA mobile; corresponde al dueño.
Las listas activas y pendientes muestran `Cargar más` sólo cuando el cursor
autoritativo ofrece otra página; busy bloquea dobles solicitudes y conserva filas.

## Validación local

Los tests usan React real/SSR y callbacks reales; sólo se sustituye el loader de
CSS Modules en Node. Los datos sintéticos se limitan al archivo de tests.

```bash
node_modules/.bin/tsx --tsconfig src/features/coach-clients/components/coach-clients.test-tsconfig.json --test src/features/coach-clients/components/*.test.ts src/ui/coach-overlays/*.test.ts
npm run typecheck
node_modules/.bin/eslint src/features/coach-clients/components --max-warnings=0
git diff --check
```

Los cuatro tests de Clientes y el contrato shared de overlays se ejecutan mediante
`test:coach-clients-ui`, una vez desde `posttest`. Junto con los cinco de Dashboard
son diez rutas literales registradas exactamente una vez. El controller productivo
conecta listas, creación reservada, reenvío/regeneración y desvinculación con los
RPC públicos acotados. Auditoría independiente y QA visual/funcional manual del
dueño siguen pendientes; estos gates no equivalen a QA del producto.
