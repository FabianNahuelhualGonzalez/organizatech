# Dashboard Coach · componentes presentacionales controlados

Clasificación actual: **conectado en el portal Coach** mediante
`CoachWorkspaceBoundary` y su controller de feature. Incluye las cards del
primer lote y las hojas controladas de Tarifa/Chat del tercero, además del
detalle de renovación y su modal de fechas anidado del cuarto. Los componentes
siguen sin ejecutar llamadas remotas ni persistencia: reciben view-models y
callbacks desde la capa de integración.

`coach-dashboard-view.ts` es el contrato local. El integrador entrega todas las
fechas e importes ya formateados, la selección del mes y callbacks separados.
`value: null` representa información no disponible: no se convierte en cero.
Los únicos límites numéricos de UI están en `coach-chart-geometry.ts` y acotan
proporciones gráficas, no calculan métricas de negocio.

Secciones: bienvenida, ingresos estimados, cartera, alertas, accesos rápidos,
gráfico y detalle mensual, renovaciones y filas. Los accesos sin callback están
deshabilitados. Chat sólo representa el acceso al futuro panel “próximamente”.
Las capacidades de cartera son independientes por filtro (`onPortfolio.active`,
`.alert`, `.pending`, `.inactive`): habilitar clientes no habilita alertas.
En renovaciones, sólo ratios positivos dibujan segmentos. Cero y `null` no
reciben ancho mínimo ficticio; si no hay positivos tampoco se anuncia una barra
como imagen. Las etiquetas informativas de la leyenda pueden seguir presentes.

La composición mantiene el token global `--background`, hereda Roboto Mono y
usa CSS Modules con contenedor local de hasta 430px. A 320px los accesos se
reparten 2+1 y el gráfico reduce separación para conservar objetivos de 44px.
Se usa el tono secundario blanco/.55 del handoff como mínimo de texto legible,
en lugar del blanco/.38 de algunas microetiquetas del prototipo (contraste
insuficiente para texto pequeño sobre el fondo base). La aprobación visual
final sigue correspondiendo al dueño de producto.

## Tercer lote: Tarifa y Chat próximamente

`CoachFeeSheet` y `CoachChatComingSoonSheet` usan contratos controlados de
`coach-dashboard-sheet-view.ts`. `CoachDashboardSheet` conserva su nombre como
adaptador/reexport de `src/ui/coach-overlays/coach-overlay.tsx`; la envoltura se
comparte con Clientes desde el quinto lote y delega todo el motor de foco/Tab/Escape/return en
`useOverlayFocusManagement`. `ModalShell` no se reutiliza porque sus consumidores
no cierran por backdrop y su envoltura visual no corresponde a estas hojas.

La integración debe montar la hoja como hermana del contenido de fondo, dentro
de un canvas local con `position:relative` y altura acotada. No ponerla dentro
del nodo marcado como fondo: `backgroundRef` debe apuntar al hermano, nunca a
body ni a un ancestro del diálogo. Entregar `restoreFocusRef` al disparador real.
El fondo queda `inert` durante la apertura mediante leases acotados; se conserva
su estado previo y se libera antes de restaurar foco. No hay segundo stack de
teclado, listeners globales nuevos ni modificaciones a body.

- Tarifa: texto privado del Coach, input raw a 19px, presets exactos $25.000,
  $35.000 y $50.000. Tres líneas de preview recibidas del mapper; no se calculan
  ingresos ni se formatea dinero. El saneo de raw y la validación son del
  controlador. Vacío/null no habilitan guardar ni se convierten en cero.
- `canSave` es explícito; `isInvalid` sólo representa error del campo, no de red.
  El botón Guardar sólo despacha `onSave`; X/scrim/Escape sólo `onCancel`.
  Busy elimina handlers y deshabilita inputs, presets y acciones. El controlador
  conserva ownership de single-flight, resultados y persistencia.
- Chat conserva el contenido aprobado y la conversación ilustrativa `aria-hidden`.
  `isRegistered: true` sólo puede provenir de confirmación real; un clic no altera
  el estado ni produce un éxito optimista. Unknown/null no habilita registro.
- Mensajes de error/operación son copy recibido, con `StatusMessage` existente.
  No se envían emails, mensajes, interés ni tarifa desde esta UI.

Los contratos globales conservan una lista exacta de consumidores del motor de
overlays. El cierre técnico autorizado registra únicamente el nuevo consumidor
`src/ui/coach-overlays/coach-overlay.tsx`; no registra el alias Dashboard ni
introduce exclusiones o relaja esas barreras. El motor permanece intacto.

## Cuarto lote: detalle de renovación y fechas

`CoachRenewalDetailSheet` compone el detalle y `CoachRenewalDatesModal` como capas
hermanas. El detalle permanece montado al editar fechas, pero el fondo de esa
hoja queda `inert` y sus acciones se deshabilitan. El fondo de la aplicación
conserva su lease independiente. El mismo motor compartido entrega Escape sólo
a la capa superior y devuelve el foco primero al disparador de fechas y después
al disparador original del detalle. No se instala otro listener ni stack.

El contrato `coach-renewal-detail-view.ts` recibe todos los datos y capacidades:
identidad consentida, procedencia, hechos, fechas crudas/mínimos del período
pagado, validación, pausa y mensajes. No existen cálculos de fechas,
duraciones, dinero, constancia ni decisiones sobre el estado real en componentes.
Los desconocidos permanecen `null` y se representan como “—” o con el label
recibido; no se inventan entrenamientos, porcentajes ni atribuciones al alumno.

- Las tres opciones de renovación emiten sólo `onSelectState`. Flechas/Home/End
  navegan el radiogroup con foco y selección controlados; no guardan ni alteran
  localmente el estado o la procedencia.
- `Listo` emite sólo `onSave`; X/scrim/Escape del detalle sólo `onCancelDetail`.
  El controller conserva el baseline y descarta el borrador completo al cancelar.
- El modal recibe los inputs de inicio/término del período pagado. Sólo emite
  cambios de campo: el controller valida los valores que registra el coach.
  No hay presets de semanas ni renovación automática al crear un ciclo.
- `paidPeriodDates` es independiente de las fechas del ciclo de entrenamiento.
  Las opciones visibles son Pagado, Pago pendiente de confirmar y No sigue.
  Los identificadores internos renewed/pending/declined se conservan para no
  alterar los contratos existentes. Esto no registra ni cobra pagos por sí solo.
- `Confirmar fechas` emite sólo `onAcceptDates`; no persiste ni cierra la hoja
  inferior. X/scrim/Escape sólo `onCancelDates`. Confirmar exige capacidad,
  etiqueta coherente, ambos valores no vacíos y validación explícita `ok`.
- `canSave`/`canAccept`, etiquetas, indicadores invalid y fecha incompleta deben
  ser coherentes en el mapper. La UI bloquea acciones ante combinaciones
  contradictorias y elimina handlers en busy. El controller es dueño de las
  transiciones asíncronas, single-flight y del descarte/restauración de borradores.
- El modal se centra sobre la hoja sin sustituir el canvas. Inputs nativos a
  16px, min-width cero, scroll acotado y columnas apiladas bajo 360px evitan la
  superposición de fechas; la QA visual real sigue pendiente del dueño.

## Extracción compartida del quinto lote

La envoltura visual, CSS y leases de fondo se movieron a `src/ui/coach-overlays/`.
Tarifa, Chat y Renovación conservan sus APIs y variantes; no dependen de Clientes.
Los tests de foco apuntan al hook extraído y al mismo motor productivo sin modificar.
La nota de esa carpeta documenta la limitación del retorno de foco a una fila
reconstruida: requiere coordinación y prueba en el controlador de integración.

## Validación focal

El tsconfig de pruebas activa el runtime JSX automático de React, igual al
compilador de Next; no cambia el tsconfig ni las dependencias del proyecto.
El test sólo sustituye la carga de CSS Modules por sus nombres de clase. React,
los componentes, `useId`, el escape de texto y los callbacks son reales.

```bash
node_modules/.bin/tsx --tsconfig src/features/coach-dashboard/components/coach-dashboard.test-tsconfig.json --test src/features/coach-dashboard/components/coach-dashboard-render.test.ts src/features/coach-dashboard/components/coach-dashboard-contract.test.ts src/features/coach-dashboard/components/coach-dashboard-sheets-render.test.ts src/features/coach-dashboard/components/coach-dashboard-sheet-focus.test.ts src/features/coach-dashboard/components/coach-renewal-detail-render.test.ts
npm run typecheck
node_modules/.bin/eslint src/features/coach-dashboard/components --max-warnings=0
git diff --check
```

Los cinco archivos focales se ejecutan mediante `test:coach-dashboard-ui`, una
vez desde `posttest`. La conexión productiva conserva métricas sin fuente como
desconocidas y separa invitaciones pendientes de pagos. La auditoría del diff y
la QA manual del dueño siguen siendo gates obligatorios; no se afirma PASS
visual ni backend por el montaje de estos componentes.
Los tests de foco ejecutan el código real de los hooks con un harness determinista
de efectos/refs y un DOM mínimo simulado. No equivalen a QA real de Safari/VoiceOver.
