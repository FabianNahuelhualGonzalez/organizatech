# Separación de Series lineales y Modificar por series

## Alcance aprobado — 2026-09-08

Referencia: instrucción prioritaria del dueño en el hilo coordinador de
Organizatech y confirmación de la transición antes de implementarla.
El dueño pidió que `Series lineales` muestre sólo la configuración común de
cantidad/reps/kg y `Aplicar a las X series`, sin selector de técnicas ni edición
individual. `Modificar por series` conserva las cinco técnicas y el detalle
editable. Abrir un ejercicio avanzado no debe normalizar sus datos.

Clasificación: **Cambio visual aprobado** sobre la pantalla de ejercicio ya
conectada. La aprobación de implementación no sustituye la auditoría ni la QA
visual/manual final del dueño.

Composición funcional del alcance indicado:

```text
[Series lineales] [Modificar por series]

Series lineales:
  Series [- X +]   Reps [ ]   Kg [ ]
  [Aplicar a las X series]

Modificar por series:
  Selector: lineal / ascendente / descendente / drop set / fallo
  Detalle editable por serie y acciones existentes
```

- **Button:** no se agregan Buttons. Las técnicas, fallo, acciones de cada
  serie, duplicar/eliminar/agregar serie y controles de descensos sólo se montan
  en `Modificar por series`. Los dos Buttons de modo y el de Aplicar se conservan.
- **Section:** no se agrega ninguna. El bloque común y el selector/detalle son
  mutuamente excluyentes. El detalle de descensos continúa dentro de su serie.
- **Card:** ninguna nueva ni modificada. Recomendación y video siguen siendo
  contenido común de la pantalla, fuera del bloque de configuración.
- **Modal/Drawer:** ninguno nuevo ni modificado.
- **Texto visible:** ninguno nuevo ni modificado. No se introduce confirmación
  ni copy de conversión.
- **CSS, composición productiva, Coach y navegación global:** sin cambios.

## Semántica y preservación

- Abrir/reabrir/rehidratar un ejercicio avanzado, con fallo/descensos o con
  valores heterogéneos elige `per_set`; conserva el draft, los IDs y su revisión.
- Sólo el gesto explícito `per_set → quick` convierte a `technique: linear`,
  igualando todas las series con reps/kg de la primera serie **actual** y
  eliminando fallo/descensos. No toma buffers rápidos obsoletos ni inventa
  valores cuando la referencia está vacía o es inválida.
- La conversión real genera una sola revisión para el autoguardado existente.
  Si el ejercicio ya es lineal uniforme, el cambio de vista no escribe.
- Un clic en el modo ya activo es no-op. `quick → per_set` no aplica buffers
  pendientes. `Aplicar` usa los buffers y deja metadata lineal coherente.
- Aceptar una recomendación resincroniza los buffers. Si produce valores
  heterogéneos desde el modo compacto, abre `per_set` sin homogeneizarlos; una
  elección previa explícita de `per_set` se conserva.
- El guard de plan activo bloquea conversiones reales, pero conserva los cambios
  puramente visuales de un ejercicio lineal uniforme. El bloqueo global de
  sincronización pendiente no cambia. `active_edit` conserva su write explícito.
- El recálculo previo de kg desde la primera serie y las reglas de técnicas
  avanzadas no se modifican. No se toca el controller de autoguardado, el contrato
  RPC, SQL, entorno, ownership ni fallback legacy.

## Verificación técnica

Base: `31e0c7a801679891ca3461f29a8e8d86cd60edf6`.
Branch: `codex/cycle-redesign-integration-01`.
Worktree: `/Users/fabiannahuelhual/Developer/organizatech-cycle-redesign-integration-01`.
Stash protegido intacto: `7e618d67efb4290082a4f6be258c1f75640856c8`.

- Frontend focal: PASS; 54 casos de reducer (45 previos y nueve nuevos), siete
  de autoguardado, cuatro de URL, dos de UI aislada y contratos/fixtures.
- La nueva prueba de autoguardado ejecuta el reducer, preparación de payload y
  owner reales con writes simulados en memoria: conserva single-flight,
  sustituye el snapshot intermedio y sólo confirma el último snapshot lineal.
- Los dos contratos de UI transpilan y ejecutan el TSX real con React en Node;
  usan sustitutos transparentes de Buttons y CSS y disparan handlers reales.
  Comprueban montaje excluyente, técnicas, edición/descensos y Aplicar. No son
  prueba de navegador, layout, foco, estilos ni QA visual/manual.
- `npm run lint`: PASS.
- `npm run build`: PASS, Next.js 15.5.18.
- `npm run typecheck`: PASS, repetido después del build.
- `git diff --check`: PASS; documento nuevo comprobado además con
  `git diff --no-index --check /dev/null`.
- `npm test` completo: PASS, incluidos `pretest` y `posttest`, salida cero.

Logs del implementador: `/tmp/organizatech-cycle-linear.EhmtMc/` (`frontend.log`,
`full-test.log`, `lint.log`, `build.log`, `typecheck.log`). El coordinador revisó
el diff, los hashes y la evidencia; no atribuye esas ejecuciones a Claude.

Resultado técnico local: **PASS**. Resultado de entrega integral:
**REQUIERE MÁS PRUEBAS**, por los gates independientes indicados abajo.

Las guías de Next.js/React mantuvieron la conversión en el reducer de la feature,
sin effects nuevos, sincronización por render ni cambios de boundaries.

## Riesgos y pendientes

La selección explícita de Series lineales descarta diferencias por serie,
marcas de fallo y descensos; es la intención aprobada, no una normalización al
abrir. Los buffers rápidos sin Aplicar siguen sin persistirse, como antes.

Auditoría independiente de Claude: **PASS**, sesión41612 terminada con salida
cero, informe `/tmp/organizatech-cycle-linear-mode-claude-audit.json` y artefacto
`/tmp/organizatech-cycle-linear-mode-audit.patch`. Revisión read-only del diff y
dependencias; sin correcciones requeridas. No ejecutó las pruebas del implementador.
Observaciones menores no bloqueantes: el harness UI sólo sustituye las primitives
necesarias para un ejercicio existente (no prueba el fallback de ejercicio ausente);
se conservan el guard global de sincronización y los defaults previos al abrir.
No se amplía el alcance del fix para cambiar esos comportamientos preexistentes.

Before/After, Preview del SHA que publique el dueño y QA iPhone 15 Pro Max:
**pendientes exclusivamente del dueño**. Debe revisar la exclusión de controles,
teclado/scroll, abrir un ejercicio avanzado sin alterarlo, editar la primera
serie, convertir/aplicar lineales, reabrir y verificar el guardado. No se abrió
Preview, QA ni PROD desde IA.

## Inventario exacto para commit manual

- `docs/product/training-cycle-redesign/series-linear-mode-qa-review.md`
- `src/features/training-cycle-builder/components/cycle-routine-screens.tsx`
- `src/features/training-cycle-builder/hooks/training-cycle-builder-state.check.ts`
- `src/features/training-cycle-builder/hooks/training-cycle-builder-state.ts`
- `src/features/training-cycle-builder/hooks/training-cycle-set-editing.ts`
- `src/features/training-cycle-builder/training-cycle-builder-frontend-contract.check.ts`

Código y auditoría técnica: **PASS; listo para commit/push manual del dueño a
la rama de Preview**. Sin commit ni push ejecutados por IA. Preview nuevo y QA
manual: pendientes; no listo para merge ni producción. No requiere migraciones.
Coach sigue en su worktree y seguimiento independientes; no forma parte de este commit.
