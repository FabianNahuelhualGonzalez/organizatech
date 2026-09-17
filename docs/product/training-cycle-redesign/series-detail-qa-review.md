# Detalle de series: nombres, forma, explicación y recálculo

## Alcance aprobado — 2026-09-08

El dueño pidió en este hilo y autorizó implementar como primera entrega:

- Buttons de modo: `Rápido` → `Series lineales`; `Por serie` → `Modificar por series`.
- Buttons de técnica rectangulares redondeados, misma forma que los de modo.
- Cuadro explicativo existente más colorido. Azul del producto, texto blanco;
  no alarma ni pantalla nueva.
- Editar el kg de la primera serie recalcula de inmediato las cargas siguientes,
  sin cambiar de técnica para refrescar las sugerencias.

Referencia previa: cuatro fotos aportadas por el dueño; en la cuarta aparece
pirámide ascendente con primera carga 200 y siguientes aún en 22/24/26.
El dueño priorizó esta entrega mientras los agentes siguen los diseños Coach.

Clasificación: **Cambio visual aprobado**, sobre UI ya conectada. No se crea otra
Card/Section/Modal/Drawer ni se conecta infraestructura nueva. Se modifican los
Buttons y el cuadro descritos; ninguna otra pantalla. Root intacto.

## Implementación acotada

Reusar la política piramidal existente, sin nuevos porcentajes ni recomendaciones:
ascendente 200 → 220/240/260; descendente 200 → 180/160/140.
Lineal y fallo mantienen la carga de referencia en las siguientes series.
Las otras filas siguen editables; un nuevo cambio de carga base vuelve a generar
las cargas correspondientes. No reescribir repeticiones, marcas de fallo, IDs,
orden ni el video. Drop set sigue calculando cada descenso respecto de su propia
serie; no convertirlo en pirámide ni alterar descensos manuales de otras series.

Conservar el texto de la casilla durante edición; vacío/inválido/fuera de límites
no propaga defaults. Una carga válida produce una única revisión del borrador y
el payload de autoguardado contiene esas cargas. No hay migración ni SQL remoto.

## Validaciones y entrega

**Código PASS y auditoría independiente de Claude PASS — 2026-09-08.**

- `npm run test:training-cycle-builder-frontend`: PASS; 45 casos de estado,
  siete de autoguardado, cuatro de URL y contratos/fixtures.
- `npm run lint`, `npm test` completo (incluidos pretest/posttest) y
  `npm run build`: PASS. Build Next.js 15.5.18.
- `npm run typecheck`: PASS al finalizar build. Una ejecución concurrente inicial
  encontró archivos `.next/types` transitorios ausentes mientras build los
  regeneraba; la repetición secuencial terminó con código cero.
- `git diff --check` y whitespace de ambos archivos nuevos: PASS.
- Claude revisó los siete archivos y dependencias en modo sólo lectura,
  sin shell, red, navegador ni escritura. Veredicto PASS, sin hallazgos
  bloqueantes. No volvió a ejecutar las pruebas; esas evidencias corresponden
  al coordinador. Forma y contraste renderizados requieren QA del dueño.

La guía de React se aplicó manteniendo el recálculo en la misma acción del
reducer, sin efectos adicionales ni revisiones duplicadas del borrador.

Base auditada: `b3224ecd76113986451fe98eb30e9a43f9b3f676`, branch
`codex/cycle-redesign-integration-01`. Cinco archivos tracked modificados y dos
nuevos; sin package/root/SQL/env ni cambios Coach en este lote.
Después del veredicto sólo se actualiza este registro documental de validación.

Commit/push pendientes, sólo dueño. Preview debe corresponder al SHA publicado
exacto; el Preview anterior no contiene estas correcciones todavía.

QA visual/mobile y Before/After finales: pendientes exclusivamente del dueño.
No navegador por IA. No declarar disponibilidad en Preview antes de publicación
verificada, ni producción PASS. Coach continúa en sus entornos separados.
