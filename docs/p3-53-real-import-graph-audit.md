# P3-53 — Auditoría del grafo real y módulos potencialmente huérfanos

## 1. Resumen ejecutivo

La auditoría reconstruyó el grafo de imports de TypeScript/TSX desde los entrypoints reales de
Next.js, separó producto, QA, tests, scripts, contratos source-based y CSS, y verificó los resultados
contra `typecheck`, la suite completa y el build productivo.

Conclusiones:

1. No se detectaron módulos clasificables como `CANDIDATO_HUÉRFANO` en la base analizada.
2. No se detectaron imports internos no resueltos, ciclos, tests sin registrar ni tests duplicados.
3. Tres módulos de implementación están alcanzados sólo por tests. Se clasifican `TEST_ONLY`; no se
   infiere que sean código muerto y se recomienda investigar dos de ellos antes de cualquier tarea
   futura.
4. `ShareWorkoutCard`, su CSS y la infraestructura `workout-share-*` no tienen ruta desde runtime
   productivo ni QA. Sus tests y contratos demuestran que el aislamiento es deliberado. Se
   clasifican `INFRAESTRUCTURA_AISLADA_INTENCIONAL`, no como huérfanos.
5. `TrainingCompletionSummaryScreen` no importa, monta ni ejecuta sharing. El contrato registrado de
   Active Workout prohíbe explícitamente esa integración.
6. P3-39C1 permanece cancelada. El hardening P3-39H endureció el pipeline aislado sin añadir wiring.
7. No existe evidencia suficiente en los archivos rastreados ni en los asuntos de commits de
   `origin/main` para definir P3-51 o P3-52. Ambas deben permanecer bloqueadas por falta de evidencia;
   el próximo paso permitido es recuperar su especificación.

Este trabajo es exclusivamente documental. No se modificó código, CSS, paquetes, Supabase, entorno
ni comportamiento visual.

## 2. Base y alcance

| Dato | Evidencia |
|---|---|
| Fecha | 2026-08-03 |
| Rama | `audit-p3-53-import-graph` |
| `HEAD` | `484f88facd2ddfe7206eee79b2706fe785b7276b` |
| `origin/main` | `484f88facd2ddfe7206eee79b2706fe785b7276b` |
| Relación | `HEAD == origin/main`, base exacta solicitada |
| Árbol inicial | Limpio |
| Stash protegido | `stash@{0}: On fix/workout-readiness-active-reentry: preserve pre-carousel dirty reentry test file` |
| Tratamiento del stash | Sólo inspeccionado; no aplicado, eliminado ni modificado |
| Archivo creado | `docs/p3-53-real-import-graph-audit.md` |

Unidades clasificadas: 334.

- 327 archivos TypeScript/TSX autorales o de configuración: `next.config.ts` y 326 bajo `src/`.
- 6 archivos CSS, analizados como dimensión separada.
- `next-env.d.ts`, separado como declaración generada de Next.js.

`public/sw.js`, `public/manifest.json` y `public/icon.svg` no se incorporaron a los totales TS/CSS,
pero sí se inspeccionaron como assets literales productivos. `organizatech-app.tsx` registra
`/sw.js`; el service worker incluye `/`, `/manifest.json` y `/icon.svg` en su app shell.

No se leyó `.env`, no se consultó Supabase remoto y no se ejecutaron escrituras externas.

## 3. Metodología y reglas de clasificación

Se parseó el AST de todos los TS/TSX en alcance y se resolvieron:

- imports estáticos runtime;
- imports dinámicos con literal;
- imports y specifiers type-only;
- re-exports/barrels;
- CSS imports;
- rutas relativas con resolución `.ts`, `.tsx`, `.css` e `index`;
- alias `@/*` conforme a `tsconfig.json` → `./src/*`;
- imports externos, distinguidos de imports internos no resueltos.

La alcanzabilidad se calculó desde cada conjunto de roots por separado. Los contratos source-based
se auditaron además mediante referencias literales a archivos, incluidas las guardadas en arrays o
variables. La clasificación usó esta precedencia:

1. La decisión explícita `INFRAESTRUCTURA_AISLADA_INTENCIONAL` prevalece para todo Workout Share,
   incluidos sus tests.
2. Alcance desde roots producto y QA determina `RUNTIME_PRODUCTIVO`, `RUNTIME_QA` o
   `COMPARTIDO_PRODUCTO_QA`.
3. Archivos de test registrados y módulos alcanzados únicamente por ellos son `TEST_ONLY`.
4. Una referencia source-based sin import ni otro root sería `SOURCE_CONTRACT_ONLY`.
5. La ausencia de toda evidencia anterior habilita `CANDIDATO_HUÉRFANO`; no basta con tener cero
   importadores.
6. Convenciones generadas o no comparables se mantienen `NO_CONCLUYENTE`.

Las aristas type-only se conservaron en el grafo de dependencia de compilación, pero se excluyeron de
la segunda pasada de alcanzabilidad ejecutable. CSS se contabilizó como arista de bundling, no como
módulo JavaScript ejecutable.

Limitación: la auditoría demuestra alcanzabilidad estática, registro y contratos; no prueba que cada
branch funcional se ejecute en una sesión real de usuario. Por eso ninguna conclusión de eliminación
se basa sólo en este informe.

## 4. Roots reales

### 4.1 Runtime productivo

| Root | Motivo |
|---|---|
| `next.config.ts` | Configuración ejecutada por Next; carga headers y política CSP |
| `src/app/layout.tsx` | Convención App Router: root layout |
| `src/app/page.tsx` | Ruta `/` |
| `src/app/login/page.tsx` | Ruta `/login` |
| `src/app/website-preview/page.tsx` | Ruta `/website-preview` |

El build confirmó esas rutas y la ruta implícita `/_not-found` generada por Next.js.

### 4.2 Runtime QA

| Root | Motivo |
|---|---|
| `src/app/qa/training-cycle-history/page.tsx` | Ruta QA dinámica; carga su client por `import()` |
| `src/app/qa/training-cycles/page.tsx` | Ruta QA dinámica; carga su client por `import()` |

Estas páginas siguen siendo roots aunque no tengan importadores de código: Next.js las descubre por
convención. Ambas aplican un gate server-side antes de importar dinámicamente el cliente QA.

### 4.3 Tests registrados y no registrados

| Métrica | Total |
|---|---:|
| Archivos `*.test.ts`/`*.test.tsx` | 127 |
| Referencias a archivos de test en `package.json#scripts.test` | 127 |
| Referencias únicas | 127 |
| Duplicados | 0 |
| Tests no registrados | 0 |
| Invocaciones `tsx` encadenadas | 122, porque dos invocaciones agrupan varios tests con `--test` |

### 4.4 Scripts

`package.json` define `dev`, `build`, `start`, `lint`, `typecheck`, `test` y `extract:excel`.

- `test` aporta los 127 roots de test anteriores.
- `extract:excel` apunta a `scripts/extract_excel.py`; es un root de script explícito fuera del grafo
  TS/TSX y no importa módulos del producto.
- `dev`, `build` y `start` delegan en Next.js; `lint` en ESLint y `typecheck` en TypeScript.

### 4.5 Referencias source-based

El inventario conservador encontró 293 pares únicos `(test, ruta literal)` hacia 166 targets. No se
usan como equivalentes a imports runtime. Incluyen lectura de TS/TSX, CSS, `package.json`,
`next.config.ts`, documentación y artefactos SQL contractuales.

Tres literales apuntan intencionalmente a rutas inexistentes:

- `public/diagramas/index.html` y `public/limpiar-cache.html`: el contrato exige que no sean públicos
  y confirma sus copias bajo `docs/internal/`.
- `src/app/page.backup.tsx`: el contrato exige que el backup obsoleto no exista.

Por tanto, hay 0 rutas literales rotas. Las tres ausencias son assertions negativas que pasaron en la
suite.

## 5. Totales por clasificación

| Clasificación | Total | Interpretación |
|---|---:|---|
| `RUNTIME_PRODUCTIVO` | 149 | Alcanzado sólo desde roots productivos |
| `RUNTIME_QA` | 9 | Alcanzado sólo desde roots QA |
| `COMPARTIDO_PRODUCTO_QA` | 39 | Alcanzado desde ambos tipos de runtime |
| `TEST_ONLY` | 126 | Tests o implementación alcanzada sólo desde tests |
| `SOURCE_CONTRACT_ONLY` | 0 | Ningún target queda únicamente en esta condición después de aplicar precedencia |
| `INFRAESTRUCTURA_AISLADA_INTENCIONAL` | 10 | Workout Share: UI, CSS, módulos y tests |
| `CANDIDATO_HUÉRFANO` | 0 | No se encontró evidencia suficiente para esta clasificación |
| `NO_CONCLUYENTE` | 1 | `next-env.d.ts`, archivo generado y root de tipos por `tsconfig` |
| **Total** | **334** | 327 TS/TSX + 6 CSS + 1 declaración generada |

Los 126 `TEST_ONLY` incluyen 123 archivos de test y tres módulos auxiliares. Los cuatro tests
`workout-share-*.test.ts` están contados en la categoría especializada de infraestructura, de modo
que no existe doble conteo.

## 6. Resultados estructurales del grafo

### 6.1 Aristas internas

| Tipo de arista | Total |
|---|---:|
| Import estático runtime | 489 |
| Type-only | 220 |
| CSS | 13 |
| Dynamic import interno | 2 |
| Re-export/barrel | 7 |
| **Total interno** | **731** |

Además existen 272 imports externos resueltos por paquetes o built-ins. Los ocho `import()` del
repositorio se descomponen en dos internos QA y seis externos de `jspdf`/`jspdf-autotable` en renderer
y tests.

### 6.2 Imports no resueltos y ciclos

- Imports internos no resueltos por el analizador: 0.
- Errores de resolución detectados por TypeScript: 0.
- Errores de resolución detectados por el build: 0.
- Componentes fuertemente conexos de tamaño mayor que uno: 0.
- Self-cycles: 0.

### 6.3 Alcance type-only

La pasada con todas las aristas encontró 188 unidades asociadas a producto y 48 a QA. Al excluir
type-only quedaron 182 unidades ejecutables/producto y 27 ejecutables/QA. Seis módulos son alcanzados
desde runtime exclusivamente para compilación de tipos:

- `src/lib/dashboard/dashboard-types.ts`
- `src/lib/notifications/notification-types.ts`
- `src/lib/progress/types.ts`
- `src/lib/training/cycle-history/cycle-history-types.ts`
- `src/lib/training/training-plan-model.ts`
- `src/lib/training/training-routine-draft.ts`

No son falsos huérfanos: participan en el contrato de tipos del producto. Mantienen la clasificación
del root consumidor, con la anotación de que no generan carga runtime por esa ruta.

### 6.4 Módulos alcanzados sólo por barrels

Sólo un módulo tiene todos sus importadores de código a través de un barrel:

| Ruta | Importador directo | Root real | Arista | Confianza | Recomendación |
|---|---|---|---|---|---|
| `src/components/training/cycle-history/CycleHistoryProductiveContainer.tsx` | `src/components/training/cycle-history/index.ts` | Producto: `organizatech-app.tsx` importa `@/components/training/cycle-history` | re-export + import runtime | Alta | CONSERVAR |

El test registrado `cycle-history-app-controller.test.ts` verifica tanto el import desde el barrel
como el montaje de `CycleHistoryProductiveContainer`.

### 6.5 Módulos sin importadores de código

Excluyendo tests, aparecen ocho archivos sin importador directo:

- `next.config.ts`;
- `src/app/layout.tsx`;
- `src/app/page.tsx`;
- `src/app/login/page.tsx`;
- `src/app/website-preview/page.tsx`;
- `src/app/qa/training-cycle-history/page.tsx`;
- `src/app/qa/training-cycles/page.tsx`;
- `src/features/progress/components/share-workout-card.tsx`.

Los siete primeros son entrypoints convencionales/configurados y el build confirma su uso. El último
está cubierto por un contrato source-based y por la decisión explícita de aislamiento de Workout
Share. `next-env.d.ts` tampoco tiene importador normal: `tsconfig.json` lo incluye expresamente y
Next.js lo genera, por eso queda `NO_CONCLUYENTE`, no huérfano.

## 7. Código alcanzado sólo por tests

| Ruta | Importadores y arista | Roots/tests | Contratos | Side effects | Confianza | Recomendación |
|---|---|---|---|---|---|---|
| `src/lib/progress/exercise-history.ts` | `progress.test.ts`, import runtime | Test registrado | Pruebas funcionales de helpers de historial | Ninguno al importar; funciones puras sobre arrays/fechas | Alta | INVESTIGAR: confirmar si es helper legado o reserva deliberada antes de una tarea futura |
| `src/lib/training/cycle-scoped-planned-date.ts` | `cycle-scoped-planned-date.test.ts`, import runtime | Test registrado | Casos de fecha planificada cycle-scoped | Ninguno al importar; funciones deterministas UTC | Alta | INVESTIGAR: recuperar intención funcional antes de conectar o retirar |
| `src/lib/training/cycle-history/cycle-history-pdf-test-fixtures.ts` | Tres tests PDF, imports runtime | Tests registrados de action, presentation y renderer | Fixture compartida del pipeline PDF | Ninguno al importar; construcción de datos sólo al invocar funciones | Alta | CONSERVAR como fixture de tests |

Ninguno es `CANDIDATO_HUÉRFANO`: cada uno tiene importadores y roots de test reales. La ausencia de un
importador productivo no autoriza borrarlo.

## 8. CSS como dimensión separada

| Ruta | Importadores | Root/clasificación | Tipo de arista | Contrato/observación | Recomendación |
|---|---|---|---|---|---|
| `src/app/globals.css` | `src/app/layout.tsx` | `RUNTIME_PRODUCTIVO` | CSS | También leído por contratos visuales | CONSERVAR |
| `src/app/page.module.css` | home page y `src/app/mobile-menu.tsx` | `RUNTIME_PRODUCTIVO` | CSS Module | Dos consumidores productivos | CONSERVAR |
| `src/app/website-preview/page.module.css` | preview page y su mobile menu | `RUNTIME_PRODUCTIVO` | CSS Module | Dos consumidores productivos | CONSERVAR |
| `src/app/qa/training-cycle-history/training-cycle-history-qa.module.css` | client QA de cycle history | `RUNTIME_QA` | CSS Module | Import dinámico desde page QA | CONSERVAR |
| `src/components/training/cycle-history/cycle-history.module.css` | Seis componentes de cycle history | `COMPARTIDO_PRODUCTO_QA` | CSS Module | Contrato source-based registrado | CONSERVAR |
| `src/features/progress/components/share-workout-card.module.css` | `share-workout-card.tsx` | `INFRAESTRUCTURA_AISLADA_INTENCIONAL` | CSS Module + source-read | Contrato Progress verifica aislamiento y límites visuales | CONSERVAR |

No hay CSS sin importador. El CSS de Share Workout no es productivo: depende de un componente no
montado y su lectura por contrato no lo incorpora a un bundle.

## 9. Auditoría especial de Workout Share

### 9.1 Grafo interno y roots

| Ruta o grupo | Importadores | Roots | Tipo de arista | Tests/contratos | Side effects | Confianza | Recomendación |
|---|---|---|---|---|---|---|---|
| `src/features/progress/components/share-workout-card.tsx` | Sin importadores de código | Contrato Progress registrado, source-based | source-read; importa CSS y primitives UI | `progress-visual-integration-contract.test.ts` valida API allowlisted, pureza y ausencia en root/Comparison | Ninguno al importar; componente presentacional por props | Alta | CONSERVAR aislado |
| `src/features/progress/components/share-workout-card.module.css` | `share-workout-card.tsx` | Contrato Progress, source-based | CSS + source-read | Valida CTA, wrapping, `min-width` y ausencia de clase global `.card` | Ninguno | Alta | CONSERVAR aislado |
| `src/lib/training/workout-share-model.ts` | Tests y módulos action/image; sin consumidor productivo | Tests registrados de Workout Share | runtime y type-only | Test propio source-based; sanitización, redacción y límites | Inicializa `Intl.Segmenter`; sin I/O, DOM, storage ni red al importar | Alta | CONSERVAR aislado |
| `src/lib/training/workout-share-action.ts` | Sólo `workout-share-action.test.ts` | Test registrado | Import runtime desde test; type-only hacia model | Boundary tests de share/copy/cancel/failure | I/O sólo mediante ports inyectados al invocar | Alta | CONSERVAR aislado |
| `src/lib/training/workout-share-image.ts` | Sólo `workout-share-image.test.ts` | Test registrado | Import runtime desde test; type-only hacia model | Layout, PNG y boundary tests | Canvas/Blob sólo mediante ports al invocar; sin autoejecución | Alta | CONSERVAR aislado |
| `src/lib/training/workout-share-image-action.ts` | Sólo `workout-share-image-action.test.ts` | Test registrado | Import runtime desde test; runtime hacia filename del model | Share/download/fallback/revoke y registro de tests | I/O sólo mediante ports al invocar | Alta | CONSERVAR aislado |
| Cuatro `src/lib/training/workout-share-*.test.ts` | Sin importadores; son roots | Grupo `tsx --test` registrado una vez | roots de test | Los cuatro pasaron; verifican runtime y límites source-based | Assertions/console sólo durante tests | Alta | CONSERVAR |

El subsistema contiene dos clusters todavía desconectados entre sí:

1. `ShareWorkoutCard` + CSS + primitives UI.
2. Modelo, acción de texto, renderer de imagen y acción de imagen.

No existe import que proyecte `WorkoutShareCardModel` hacia `ShareWorkoutCard`, ni handler que conecte
acciones con la UI. Esa ausencia es coherente con la decisión de aislamiento; no es evidencia de un
defecto que esta tarea deba corregir.

### 9.2 Ausencia de importador productivo

La alcanzabilidad desde los cinco roots productivos y los dos roots QA es falsa para los diez
archivos Workout Share. La única arista del componente a su CSS tampoco vuelve productivo al cluster,
porque el componente raíz no está montado. Los módulos `workout-share-*` son importados por tests y
entre sí sólo dentro de su cluster.

### 9.3 Ausencia de sharing en `TrainingCompletionSummaryScreen`

`src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx`:

- no importa `ShareWorkoutCard`;
- no contiene `buildWorkoutShareCardModel`, `buildWorkoutShareTextPayload`,
  `executeWorkoutShareAction`, `handleShareWorkout` ni `shareModel`;
- no usa `navigator`, hooks de estado/efecto ni texto de sharing;
- sólo presenta el resumen recibido por props y el botón para volver al dashboard.

`active-workout-visual-integration-contract.test.ts`, test registrado, lee esa pantalla y prohíbe
explícitamente todos esos símbolos. El contrato pasó en esta auditoría.

### 9.4 Contratos de aislamiento

- El contrato Progress lee `ShareWorkoutCard`, su CSS, el root y `ComparisonScreenV2`; exige que el
  componente no esté integrado en ninguna de las dos superficies.
- El contrato Active Workout exige que Completion no monte un segundo resumen ni acciones de share.
- Los cuatro tests de módulos leen sus fuentes y prueban límites de dominio, sanitización, APIs
  inyectadas, fallbacks y registro único en `package.json`.
- `workout-share-image-action.test.ts` confirma que los tests de model/image/image-action pertenecen
  al mismo grupo registrado y aparecen una sola vez.

### 9.5 P3-39H y P3-39C1

El commit `3a941ee` (`fix: harden workout share unicode handling`) es ancestro de `origin/main` y
modificó únicamente:

- `src/lib/training/workout-share-model.ts` y su test;
- `src/lib/training/workout-share-image.ts` y su test.

No modificó `ShareWorkoutCard`, `TrainingCompletionSummaryScreen`, roots, rutas ni handlers. Esto
demuestra P3-39H como hardening del pipeline aislado, sin wiring.

P3-39C1 está cancelada por decisión explícita de alcance y esa decisión está corroborada en
`docs/p3-40-global-state-audit.md`. No existe dependencia pendiente que autorice reactivarla.
`ShareWorkoutCard` no debe montarse en `TrainingCompletionSummaryScreen`.

### 9.6 Clasificación final

Los diez archivos se clasifican:

`INFRAESTRUCTURA_AISLADA_INTENCIONAL`

Recomendación: **CONSERVAR** sin conectar ni retirar. Cualquier integración o retiro futuro requiere
ticket separado y aprobación explícita; P3-53 no autoriza ninguno de esos cambios.

## 10. P3-51 y P3-52

| Ticket | Evidencia encontrada | Decisión | Próximo paso permitido |
|---|---|---|---|
| P3-51 | Sin referencias en archivos rastreados; sin asunto de commit en `origin/main`; sin aceptación, alcance ni archivos objetivo | MANTENER BLOQUEADA POR FALTA DE EVIDENCIA | RECUPERAR ESPECIFICACIÓN |
| P3-52 | Sin referencias en archivos rastreados; sin asunto de commit en `origin/main`; sin aceptación, alcance ni archivos objetivo | MANTENER BLOQUEADA POR FALTA DE EVIDENCIA | RECUPERAR ESPECIFICACIÓN |

No corresponde `DEFINIR TICKET CON APROBACIÓN` todavía: primero debe recuperarse evidencia que permita
distinguir intención, dependencia y criterios de aceptación. No se implementó ni se inventó contenido
para P3-51/P3-52.

## 11. Falsos positivos controlados

| Fuente de falso positivo | Control aplicado | Resultado |
|---|---|---|
| Next.js file conventions | `page`, `layout` y config tratados como roots aunque tengan cero importadores | Siete entrypoints/config legítimos, confirmados por build |
| Alias `@/*` | Resolución conforme a `tsconfig.json` | 0 alias internos no resueltos |
| Type-only | Pasadas separadas de compilación y ejecución | Seis módulos sólo de tipos asociados al runtime; no huérfanos |
| Dynamic import | AST de `import()` con literal | Dos edges QA internos y seis imports externos válidos |
| Barrels | Re-export como arista explícita | Un módulo alcanzado sólo vía barrel, con montaje contractual |
| CSS | Grafo separado de bundling | Seis CSS con importador; ninguno huérfano |
| Source-read | Referencia contractual no tratada como import runtime | Workout Share sigue aislado aunque sus fuentes sean leídas |
| Literales inexistentes | Revisión de assertions positivas/negativas | Tres ausencias intencionales; 0 rutas rotas |
| Public assets | Revisión de URLs y registro de service worker | `sw.js`, manifest e icon son runtime productivo fuera de TS |
| Tests roots | Registro en `package.json`, no importadores entrantes | 127/127 registrados; 0 duplicados y 0 omitidos |

## 12. Validaciones ejecutadas

| Validación | Resultado |
|---|---|
| Base `HEAD`/`origin/main` | PASS — ambos `484f88facd2ddfe7206eee79b2706fe785b7276b` |
| Árbol inicial | PASS — limpio |
| Stash | PASS — stash protegido presente e intacto |
| Imports internos no resueltos, AST | PASS — 0 |
| Ciclos, SCC | PASS — 0 |
| Tests registrados/duplicados | PASS — 127 únicos de 127; 0 duplicados; 0 no registrados |
| Rutas source-based | PASS — 0 rotas; 3 assertions negativas intencionales |
| `npm run lint` | PASS — exit 0, sin warnings |
| `npm run typecheck -- --incremental false` | PASS — exit 0 |
| `npm test` | PASS — exit 0, suite completa y contratos Workout Share incluidos |
| `npm run build` | PASS — exit 0; compilación y generación de 6 rutas completadas |
| Marcadores de conflicto | PASS — 0 |
| Patrones fuertes de secretos en archivos rastreados, excluyendo `.env*` y lock | PASS — 0 hallazgos |
| Residuos `.orig`, `.rej`, backups de editor y `.DS_Store` en alcance | PASS — 0 |
| `git diff --check` | PASS — diff rastreado limpio; archivo nuevo validado además con `git diff --no-index --check` |
| Status/stash final | PASS — único cambio: este documento nuevo; stash protegido presente e intacto |

## 13. Riesgos, QA y disposición

- Riesgo funcional/visual de este cambio: bajo; se añadió sólo documentación.
- Riesgo de la conclusión: el análisis es estático. Un módulo `TEST_ONLY` podría representar una
  intención futura no documentada; por eso se recomienda investigar, no retirar.
- Riesgo Workout Share: conectarlo por accidente rompería decisiones de producto y contratos
  negativos. Este informe preserva el aislamiento.
- QA manual: no requerida para el cambio documental. Sería obligatoria en cualquier tarea futura que
  conecte, mueva o retire UI/runtime.
- Supabase/PROD/QA remoto: no tocados.
- Listo para commit: sí; el gate final mantiene sólo este archivo y no detecta errores de whitespace.
  No se realizó commit ni push.

VEREDICTO: PASS
