# Overlays Coach · envoltura presentacional compartida

Clasificación actual: **primitive visual compartida montada en el portal Coach**.
La consumen hojas del Dashboard y detalle/confirmación de Clientes desde su
boundary productiva. No es un motor nuevo ni un store global.

`CoachOverlay` contiene sólo la envoltura visual de hoja/modal, scrim, pie y la
composición del hook de fondo con `useOverlayFocusManagement` existente. El motor
productivo `src/ui/overlays/use-overlay-focus-management.ts` no se modifica:
conserva ownership topmost, Tab/Escape, foco inicial y restauración.

Se extrajeron desde Dashboard `coach-dashboard-sheet.tsx`, su CSS y
`use-coach-sheet-background.ts`. El Dashboard conserva un reexport de compatibilidad
`CoachDashboardSheet`; sus cinco consumidores de estilos apuntan al CSS compartido.
`CoachOverlayFocusProps` y `CoachOverlayMessageView` también viven aquí para evitar
dependencias cruzadas entre Dashboard y Clientes. Ningún módulo compartido importa
features, controllers, datos ni servicios.

## Contrato de montaje

- Montar capas como hermanas del fondo dentro de un canvas local de altura acotada
  y `position:relative`; no usar body ni colocar el diálogo dentro de su fondo.
- Un modal anidado usa como fondo la capa inferior, que permanece montada; el
  contenido de la app conserva su lease `inert` independiente.
- El hook `useCoachOverlayBackground` es sólo un contador acotado de leases por
  nodo. Preserva inert previo y libera antes de que el motor restaure foco.
- Busy u ocultamiento por otra capa deshabilitan el scrim; el motor compartido
  sigue aislando Escape de los demás overlays. No hay segundo stack/listener.
- Las variantes nuevas `client-detail` y `client-confirm` no alteran las variantes
  previas. Confirmación centrada de borde rojo en capa 30/31; hoja en 20/21.

## Retorno por identidad: pendiente del controlador integrado

El motor existente captura `restoreFocusRef.current` **al abrir**, no al cerrar.
Es válido para disparadores que siguen conectados (incluido el detalle bajo el
modal). Si una mutación reconstruye/elimina la fila, actualizar sólo `.current`
no cambia el nodo capturado. El motor evita enfocar nodos desconectados, pero no
resuelve por sí mismo el requisito del handoff de volver a la fila por identidad.

La integración debe resolver el destino vigente por identidad después del cierre
o usar un destino estable aprobado, con prueba de la mutación/lista reconstruida.
Esa coordinación no se inventa en estos componentes ni se modifica el motor fuera
del alcance. No se afirma PASS integrado de ese escenario.

El cierre técnico autorizado registra únicamente
`src/ui/coach-overlays/coach-overlay.tsx` (no el alias Dashboard) en las dos listas
exactas de consumidores del motor. El contrato de esta carpeta se ejecuta desde
`test:coach-clients-ui` en `posttest`; no cambia el root, el motor ni dependencias.
`npm test` completo, typecheck, lint global, build y diff checks se conservan como
gates de integración. Los tests del Dashboard ejecutan los hooks extraídos y el
motor original con DOM mínimo determinista; no equivalen a QA de Safari/VoiceOver.
La QA manual del dueño sigue pendiente.
