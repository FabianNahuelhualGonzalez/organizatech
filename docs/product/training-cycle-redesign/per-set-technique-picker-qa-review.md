# QA — Quitar Lineal del selector Modificar por series

## Alcance aprobado

El dueño pidió retirar la opción `Lineal` de `Modificar por series`, porque ya
dispone del botón exclusivo `Series lineales`. Confirmó con `OK` la eliminación
de esa opción y su explicación, sin convertir los valores al abrir el detalle.
Referencia visual: captura del dueño de las 20:22 del 2026-09-08.

Cambio visual aprobado sobre la pantalla de ejercicio existente:

```text
[Series lineales] [Modificar por series]

Modificar por series:
  Pirámide ascendente / Pirámide descendente / Drop set / Fallo muscular
  Ayuda sólo de una técnica avanzada seleccionada
  Tabla y acciones por serie existentes
```

- Button: se retira únicamente la opción `Lineal` del selector de técnicas.
  Se conservan los dos botones superiores de modo y las otras cuatro técnicas.
- Texto: se retira la ayuda de Lineal; las otras cuatro ayudas no cambian.
- Section/Card/Modal/Drawer: ninguna nueva. Tabla, recomendación y video intactos.
- CSS, reducer, cálculo de cargas, persistencia y composición: sin cambios.
- No se elige una técnica alternativa automáticamente ni se alteran reps/kg.
  Un ejercicio con metadata `linear` puede abrir el detalle sin técnica avanzada
  seleccionada; sigue editable. La opción superior Series lineales conserva su
  conversión explícita y su configuración común ya aprobadas.
- El tipo persistido `linear` permanece válido. No es una migración ni retira
  compatibilidad con borradores o rutinas anteriores.

## Inventario y base

Worktree: `/Users/fabiannahuelhual/Developer/organizatech-cycle-redesign-integration-01`.
Branch: `codex/cycle-redesign-integration-01`.
Base: `21d6137b8bd689e07ea2923ea693822359a3da32`.
Stash protegido: `7e618d67efb4290082a4f6be258c1f75640856c8`, no modificado.

- `src/features/training-cycle-builder/components/cycle-routine-screens.tsx`
- `src/features/training-cycle-builder/training-cycle-builder-frontend-contract.check.ts`
- `docs/product/training-cycle-redesign/per-set-technique-picker-qa-review.md`

## Validación técnica

Dos regresiones reproducidas antes del fix: el selector contenía cinco opciones
y un ejercicio lineal reabierto mostraba la ayuda retirada. La prueba existente
de Aplicar seguía pasando. Son pruebas del TSX real con React en Node, primitives
y CSS sustituidos; no prueban layout, foco ni persistencia remota.

Las pruebas cubren las cuatro opciones exactas, ausencia de Lineal/ayuda,
preservación del draft y revisión al entrar, ayudas/selección avanzada,
descensos, conversión explícita al modo lineal, edición decimal y reapertura.

Frontend focal: PASS (54 reducer, siete autoguardado, cuatro URL y tres UI,
además de fixtures y contratos). `npm test` completo, incluidos pretest/posttest:
PASS, salida cero. Lint, build, typecheck y diff: PASS, salida cero.

El primer build se ejecutó en paralelo con la suite y leyó la mutación temporal
`shouldPrefetch` del test preexistente `perf-03-root-wiring-contract.test.ts`.
Ese test restaura el root en finally; se verificó idéntico a HEAD. El build
inicial fallido no se contabiliza como PASS. Tras terminar la suite se repitieron
lint → build → typecheck → diff en secuencia y todos pasaron. No se cambió código
ajeno ni se eliminaron pruebas para resolverlo.

Evidencia local: `/tmp/organizatech-cycle-technique-picker.ZRpWE5/`;
`frontend.log`, `full-test.log`, `lint-sequential.log`, `build-sequential.log`,
`typecheck.log` y `diff-check.log`. `build.log` conserva el primer fallo.

Auditoría independiente: **PASS**, GPT-5.6 Sol con razonamiento medio, autorizado
expresamente por el dueño en «Haz las auditoria con chatgpt 5.6 sol medio».
Agente `/root/cycle_technique_picker_sol_audit`, revisión read-only del delta;
sin hallazgos funcionales ni correcciones de código requeridas. No es un resultado
de Claude ni un PASS heredado del commit base. Informe local `sol-audit.md` en
el directorio de evidencia. El auditor inspeccionó los logs, sin ejecutar gates.

Su única observación documental era reconciliar el estado preauditoría «Claude
pendiente» con el auditor elegido por el dueño; este registro lo corrige.

## Gate de entrega y QA del dueño

Código, gates locales y auditoría independiente: **PASS**, listo para commit/push
manual del dueño a Preview. QA alojada y cierre: **REQUIERE MÁS PRUEBAS** hasta
publicar/verificar el SHA y completar la QA visual/manual del dueño.
No requiere migraciones. Sin cambios remotos, SQL, Supabase, Coach ni producción.
La guía de Next.js mantuvo el ajuste de presentación dentro del editor cliente,
sin efectos de sincronización ni cambios de boundaries.

Después de gates y auditoría PASS, commit/push manual del dueño y verificación
del Preview de ese SHA, el dueño comprueba:

1. Modificar por series ofrece sólo las cuatro técnicas avanzadas, sin Lineal
   ni su explicación. Abrirlo conserva los valores y no aplica otra técnica.
2. Seleccionar cada técnica conserva su ayuda coloreada y comportamiento.
3. Series lineales mantiene el bloque común y Aplicar; volver al detalle y
   reabrir el ejercicio conserva los valores según los gestos explícitos.

Before/After y QA móvil siguen pendientes del dueño. No se abrió navegador.
