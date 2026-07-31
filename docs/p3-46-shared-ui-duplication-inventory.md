# P3-46 — Inventario de componentes visuales duplicados

## 1. Resumen ejecutivo

Organizatech tiene hoy **35 componentes** bajo `src/features/**/components/`, **13** bajo `src/components/`
y **3 primitives** ya compartidas en `src/ui/data-display/`. El trabajo de extracción P3-07 a P3-32
movió pantallas completas fuera del root, pero **no** consolidó las piezas visuales pequeñas que esas
pantallas repiten entre sí.

Hallazgos principales, todos verificados contra el código y no inferidos por nombre de clase:

1. **Los 4 modales de la app no gestionan foco ni teclado.** Ninguno implementa focus trap, foco
   inicial, restauración de foco al cerrar, ni cierre con `Escape`. En contraste,
   `src/app/mobile-menu.tsx` (página de marketing, fuera del producto) sí implementa `Escape` +
   restauración de foco. Es la brecha de accesibilidad más concreta del inventario → **P0**.
2. **Los mensajes dinámicos de estado/error no son anunciados.** `role="alert"`, `role="status"` y
   `aria-live` existen **únicamente** en el módulo `cycle-history` (3 ocurrencias). El resto de la
   app —`notice-banner`, `profile-form-status`, `profile-avatar-status`, errores de readiness—
   renderiza texto sin semántica de live region → **P0**.
3. **Tres modales de confirmación comparten un shell estructuralmente idéntico** (backdrop + card +
   título + párrafos + fila de acciones), con diferencias sólo de contenido y variante de botón →
   **P1**, el candidato de mayor relación beneficio/riesgo.
4. **Dos envoltorios de campo de formulario independientes** (`TextField` en el root con `.field`,
   `ProfileField` en Profile con `.profile-field`) comparten la misma estructura
   `<label><span>…</span>…</label>` pero difieren en capacidad (sólo uno soporta error) → **P1**.
5. **`src/ui/` ya funciona como patrón correcto**: `RoutineMetricGrid`/`MetricGrid`, `IndexDots` y
   `TrendValue` se consumen desde Dashboard, Active Workout y Progress sin duplicación. Es el modelo
   a replicar, no a reinventar.

El inventario clasifica **18 candidatos**: 2×P0, 6×P1, 5×P2, 3×P3 y 2×NO UNIFICAR, más
**5 falsos positivos** descartados explícitamente.

**Este documento no implementa nada.** No se modificó código, CSS ni componentes.

---

## 2. Base Git analizada

| Dato | Valor |
|---|---|
| Worktree | `/Users/fabiannahuelhual/Developer/organizatech-p3-46-shared-ui-inventory` |
| Rama | `refactor/p3-46-shared-ui-inventory` |
| HEAD | `c15c1914808c4efdd5c85258709fd7e0be8b862b` |
| `origin/main` | `c15c1914808c4efdd5c85258709fd7e0be8b862b` (idéntico) |
| Árbol previo | limpio, sin untracked |
| Stash protegido | `stash@{0}` intacto, no manipulado |

## 3. Fecha del inventario

2026-07-31.

## 4. Metodología

Para cada candidato se compararon **estructura JSX, semántica HTML, props, comportamiento, estados,
eventos, clases CSS, accesibilidad, dependencias, dominio funcional y diferencias legítimas** — no
sólo coincidencia de `className`. Los cuatro modales, por ejemplo, se leyeron completos antes de
clasificarlos, lo que permitió separar los 3 de confirmación (shell idéntico) del de éxito
(estructura distinta: `h3`, icono, botón único, sin `modal-actions`).

Cada candidato se etiqueta como: duplicación real · similitud visual con comportamiento diferente ·
patrón ya compartido · candidato a primitive · debe permanecer específico · falso positivo.

**Limitación declarada:** el análisis es estático sobre el código fuente. No se ejecutó el navegador
ni se hicieron capturas, por lo que **no se verificó contraste de color, comportamiento real de foco
en runtime ni lectura efectiva con lector de pantalla**. Las observaciones de accesibilidad se basan
en la presencia/ausencia de atributos y manejadores en el código, que es evidencia suficiente para
priorizar pero no para certificar conformidad.

## 5. Comandos read-only utilizados para producir conteos

```bash
find src/ui src/components src/features src/app -type f
grep -rhoE 'className="[^"]*\bbutton\b[^"]*"' --include='*.tsx' src/components src/features src/app | sort | uniq -c | sort -rn
grep -rc "<button" --include='*.tsx' src/components src/features src/app
grep -rhoE 'type="(text|number|password|email|checkbox|radio|date|range)"' --include='*.tsx' src
grep -rn "modal-backdrop\|role=\"dialog\"\|aria-modal" --include='*.tsx' src
grep -rn "autoFocus\|\.focus()\|onKeyDown\|Escape\|tabIndex" --include='*.tsx' src
grep -rhoE 'aria-[a-z]+' --include='*.tsx' src | sort | uniq -c | sort -rn
grep -rhoE 'role="[a-z]+"' --include='*.tsx' src | sort | uniq -c | sort -rn
grep -rn 'role="alert"\|role="status"\|aria-live' --include='*.tsx' src
grep -rhoE 'className="[^"]*\bcard\b[^"]*"' --include='*.tsx' src
grep -rhoE 'size=\{[0-9]+\}' --include='*.tsx' src | sort | uniq -c | sort -rn
wc -l src/app/globals.css
```

Todos son de sólo lectura. No se ejecutó `npm`, navegador, Supabase ni comandos de escritura Git.

## 6. Mapa actual de carpetas visuales

```
src/ui/                                    ← única capa compartida hoy (3 archivos)
└── data-display/  index-dots · metric-grid (RoutineMetricGrid + MetricGrid) · trend-value

src/components/
├── organizatech-app.tsx                   ← root; contiene TextField inline (línea ~4374)
├── profile/       ProfileAvatarEditor · ProfileMenuHeader · ProfileScreen · UserAvatar
└── training/cycle-history/                ← único módulo con CSS Modules
                  CycleHistoryCompactCycle · CycleHistoryList · CycleHistoryProductiveContainer
                  CycleHistoryScreen · CycleHistorySelectedCycle · CycleHistoryStates
                  CycleHistorySummary · cycle-history.module.css

src/features/
├── active-workout/components/   ExerciseLastPerformancePanel · GuidedTrainingScreen · SeriesResult
│                                TrainingCompletionSummaryScreen · TrainingReadinessScreen · TrainingStartScreen
├── app-shell/components/        app-menu-button · app-navigation-drawer · app-screen-header
│                                app-shell-layout · app-topbar
├── dashboard/components/        dashboard-coach-card · dashboard-day-dots · dashboard-screen
│                                dashboard-training-card-content · empty-dashboard · weekly-progress-svg
├── notifications/components/    NotificationGroup · NotificationIcons · NotificationPanel
├── progress/components/         comparison-screen-v2 · weekly-metric-progress-card
│                                weekly-metric-summary-view · weekly-results-panel · weekly-series-column
├── routine-builder/components/  ConfirmRoutineUpdateModal · RoutineBuilderDayCard
│                                RoutineBuilderNameCard · RoutineExerciseBuilderCard · RoutineSuccessModal
└── training-plan/components/    ConfirmDeleteCycleModal · ConfirmNewCycleModal · CycleManagementScreen
                                 CycleScopedPlanBlocker · TrainingPlanSetupCard

src/app/    globals.css (5.244 líneas, ~740 selectores de clase) · layout · page · login
            mobile-menu · website-preview/ · qa/ (2 pantallas + page.module.css)
```

**Contratos visuales estáticos existentes (9):** app-shell, dashboard, progress, active-workout,
training-plan, routine-builder, notification-group, notification-panel, cycle-history-components.
Todos leen fuentes con rutas hardcodeadas; cualquier migración deberá actualizarlos deliberadamente.

## 7. Tabla completa de candidatos

Prioridades: **P0** riesgo funcional/a11y actual · **P1** alta duplicación y migración segura ·
**P2** duplicación moderada · **P3** baja prioridad · **NO UNIFICAR**.

---

### UI-001 · Modales sin gestión de foco ni teclado
| Campo | Detalle |
|---|---|
| **Categoría** | Modales / Accesibilidad |
| **Prioridad** | **P0** |
| **Ubicaciones** | `features/training-plan/components/ConfirmDeleteCycleModal.tsx`, `ConfirmNewCycleModal.tsx`, `features/routine-builder/components/ConfirmRoutineUpdateModal.tsx`, `RoutineSuccessModal.tsx` |
| **Implementaciones** | 4 |
| **Similitudes** | Los 4 declaran `role="dialog"`, `aria-modal="true"` y `aria-label` descriptivo — la base semántica es correcta. |
| **Diferencias** | Ninguna relevante: los 4 comparten la misma carencia. |
| **Evidencia** | `grep "autoFocus\|.focus()\|onKeyDown\|Escape\|tabIndex"` sobre los 4 archivos → **0 coincidencias**. `src/app/mobile-menu.tsx` (marketing, fuera del producto) sí implementa `Escape` + `buttonRef.current?.focus()` + foco al primer enlace. |
| **Riesgo de unificación** | Medio: introducir focus trap cambia comportamiento de teclado real (no visual). Debe validarse manualmente. |
| **Recomendación** | Corregir **dentro** de la primitive UI-002, no como parche por modal. |
| **Objetivo sugerido** | `src/ui/modals/ModalShell` con foco inicial, restauración al cerrar y `Escape`. |
| **Tarea** | **P3-48** (shell) + **P3-50** (auditoría) |
| **Dependencias CSS** | `.modal-backdrop`, `.confirm-modal` (`globals.css:4389,4399`) |
| **Requisitos a11y** | Foco inicial al abrir; trap mientras está abierto; `Escape` cierra; foco restaurado al disparador; `aria-labelledby` apuntando al título si se adopta título visible. |
| **Estrategia** | Implementar shell → migrar **un** modal → validar con teclado → migrar los otros tres. |

---

### UI-002 · Shell de modal de confirmación duplicado
| Campo | Detalle |
|---|---|
| **Categoría** | Modales |
| **Prioridad** | **P1** |
| **Ubicaciones** | `ConfirmDeleteCycleModal.tsx:9-21`, `ConfirmNewCycleModal.tsx:9-20`, `ConfirmRoutineUpdateModal.tsx:8-19` |
| **Implementaciones** | 3 (+1 variante en `RoutineSuccessModal`) |
| **Similitudes** | Estructura **idéntica**: `div.modal-backdrop[role=dialog][aria-modal][aria-label]` › `div.card.confirm-modal` › `h2` › 1-2 `p` › `div.modal-actions` › 2 `button`. |
| **Diferencias** | Nº de párrafos (2 en delete, 1 en los otros); variantes de botón (`secondary`+`danger-solid`, `danger-solid`+`success-solid`, `secondary`+`success-solid`); `ConfirmRoutineUpdateModal` **no** recibe `isBusy` y por tanto no deshabilita ni muestra label de progreso. |
| **Riesgo de unificación** | **Bajo** — son componentes puros de presentación, sin lógica de negocio, ya extraídos y cubiertos por contratos. |
| **Recomendación** | **Duplicación real.** Unificar el shell; mantener contenido y variantes como props. |
| **Objetivo sugerido** | `src/ui/modals/ModalShell` (backdrop + card + a11y) y `src/ui/modals/ConfirmDialog` (título + cuerpo + acciones) sobre el shell. |
| **Tarea** | **P3-48** |
| **Dependencias CSS** | `.modal-backdrop`, `.confirm-modal`, `.confirm-modal p`, `.modal-actions` |
| **Requisitos a11y** | Heredados de UI-001. No degradar los `aria-label` actuales, que son específicos por modal. |
| **Estrategia** | `ConfirmDialog` con props `title`, `children`, `actions[]`; migrar primero `ConfirmNewCycleModal` (el más simple con `isBusy`); actualizar `training-plan` y `routine-builder` visual contracts. |

---

### UI-003 · Mensajes de estado/error sin live region
| Campo | Detalle |
|---|---|
| **Categoría** | Feedback / Accesibilidad |
| **Prioridad** | **P0** |
| **Ubicaciones** | `GuidedTrainingScreen.tsx:190` (`notice-banner`); `ProfileScreen.tsx:195,369,389,396,397` (`profile-avatar-status`, `profile-form-status`, `profile-inline-notice`); `ProfileAvatarEditor.tsx:170` |
| **Implementaciones** | ≥8 puntos de render de mensaje dinámico |
| **Similitudes** | Todos renderizan texto que **aparece como consecuencia de una acción del usuario** (guardar, error de carga, aviso de entrenamiento duplicado). |
| **Diferencias** | Clases y tono distintos por feature; `notice-banner` alterna modificador `warning` por contenido del string. |
| **Evidencia** | `role="alert"`/`role="status"`/`aria-live` aparecen **sólo** en `CycleHistoryStates.tsx:21,41` y `CycleHistorySelectedCycle.tsx:70`. Ninguna de las ubicaciones anteriores los declara. |
| **Riesgo de unificación** | Bajo-medio: añadir `role` no altera el layout, pero un `aria-live` mal ubicado puede producir anuncios duplicados. |
| **Recomendación** | **Duplicación real con defecto de a11y.** `CycleHistoryStates` es el patrón de referencia interno ya correcto. |
| **Objetivo sugerido** | `src/ui/feedback/StatusMessage` (`tone: info\|success\|warning\|error`) con `role="status"`/`role="alert"` según tono. |
| **Tarea** | **P3-48** (primitive) + **P3-50** (auditoría) |
| **Dependencias CSS** | `.notice-banner`, `.profile-form-status`, `.profile-avatar-status`, `.profile-inline-notice` |
| **Requisitos a11y** | Errores → `role="alert"` (assertive); estados neutros/éxito → `role="status"` + `aria-live="polite"`. No anunciar contenido estático. |
| **Estrategia** | Crear primitive → migrar Profile (mayor densidad) → validar → migrar `notice-banner`. **Nota:** `notice-banner` vive en `GuidedTrainingScreen`, en conflicto potencial con P3-33; ver §14. |

---

### UI-004 · Envoltorio de campo de formulario duplicado
| Campo | Detalle |
|---|---|
| **Categoría** | Formularios |
| **Prioridad** | **P1** |
| **Ubicaciones** | `organizatech-app.tsx:4374` (`TextField`, clase `.field`); `ProfileScreen.tsx:~405` (`ProfileField`, clase `.profile-field`) |
| **Implementaciones** | 2 envoltorios + campos ad-hoc en `RoutineExerciseBuilderCard` (4 `<input>`), `GuidedTrainingScreen` (2), `TrainingReadinessScreen` (1), `RoutineBuilderNameCard` (1) |
| **Similitudes** | Misma estructura semántica: `<label>` envolvente › `<span>{label}</span>` › control. Ambos usan label implícito (sin `htmlFor`/`id`). |
| **Diferencias** | `TextField` **posee** el `<input>` y expone `type`/`autoComplete`/`required`; `ProfileField` recibe `children` (soporta select/date/readonly) y **sí** renderiza `error` en `<small>`. Clases y estilos distintos (`.field` en `globals.css:3195`, `.profile-field` en `:586`). |
| **Riesgo de unificación** | **Medio.** Los estilos difieren de forma no trivial; unificar la clase cambiaría la apariencia. Debe unificarse la **estructura**, manteniendo la clase por variante. |
| **Recomendación** | **Candidato a primitive**, con cuidado: unificar el wrapper, no forzar una sola clase CSS. |
| **Objetivo sugerido** | `src/ui/forms/FormField` (label + control + ayuda + error) y `src/ui/forms/TextInput`. |
| **Tarea** | **P3-47** |
| **Dependencias CSS** | `.field`, `.profile-field` y sus descendientes (`input`, `select`, `:focus`, `[readonly]`, `small`) |
| **Requisitos a11y** | Migrar a label explícito (`htmlFor` + `id`) para que el control sea referenciable; asociar el error vía `aria-describedby`; marcar inválido con `aria-invalid`. |
| **Estrategia** | Crear `FormField` con `variant`; migrar **sólo** Profile primero (tiene error y mayor variedad); dejar `TextField` del root para el final por estar dentro de `organizatech-app.tsx`. |

---

### UI-005 · Variantes de botón repetidas
| Campo | Detalle |
|---|---|
| **Categoría** | Botones |
| **Prioridad** | **P1** |
| **Ubicaciones** | 31 archivos con `<button>`; concentración en `organizatech-app.tsx` (11), `GuidedTrainingScreen` (6), `ProfileScreen` (6), `app-navigation-drawer` (5) |
| **Implementaciones** | `button secondary` ×11 · `button` ×8 · `start-button compact` ×3 · `profile-edit-button` ×3 · `button success-solid` ×3 · `button danger-solid` ×3 · `start-button` ×2 · más 6 clases de uso único |
| **Similitudes** | Casi todos: `<button type="button">` + `className` de variante + `onClick` + a veces `disabled`. El patrón "label cambia mientras `isBusy`" se repite literalmente (`"Eliminando..."`, `"Finalizando..."`, `"Guardando..."`). |
| **Diferencias** | `type="submit"` en formularios de login/perfil; algunos incluyen icono lucide; `icon-button` es icon-only y requiere `aria-label`. |
| **Riesgo de unificación** | **Medio.** Es la superficie más amplia (31 archivos). Un cambio de firma global rompería muchos contratos a la vez. |
| **Recomendación** | **Duplicación real**, pero migrar **por variante**, nunca de una sola vez. |
| **Objetivo sugerido** | `src/ui/buttons/Button` (`variant: primary\|secondary\|danger\|success`, `isBusy`, `busyLabel`) e `src/ui/buttons/IconButton` (obliga `aria-label` por tipo). |
| **Tarea** | **P3-47** |
| **Dependencias CSS** | `.button`, `.button.secondary`, `.button.success-solid`, `.button.danger-solid`, `.icon-button` (3 reglas), `.start-button` |
| **Requisitos a11y** | `IconButton` debe exigir `aria-label` en el tipo (no opcional); `disabled` real, no sólo estilo; no perder foco al alternar label por `isBusy`. |
| **Estrategia** | Empezar por los botones **dentro de modales** (ya tocados por UI-002, alcance acotado y contratos ya en revisión). No tocar `organizatech-app.tsx` hasta que el root esté estable. |

---

### UI-006 · Encabezado de sección (`section-heading` + `eyebrow`)
| Campo | Detalle |
|---|---|
| **Categoría** | Layout / Patrones transversales |
| **Prioridad** | **P1** |
| **Ubicaciones** | `section-heading` ×12 ocurrencias; `eyebrow` ×39 ocurrencias, repartidas en Dashboard, Active Workout, Routine Builder, Training Plan, Progress |
| **Implementaciones** | ~12 bloques `div.section-heading > div > h3 + p.eyebrow` |
| **Similitudes** | Estructura repetida casi literal: contenedor › título `h3` › descripción `p.eyebrow`. |
| **Diferencias** | Algunos añaden una acción a la derecha; `eyebrow` también se usa **suelto** (fuera de `section-heading`) como texto secundario — son dos usos distintos de la misma clase. |
| **Riesgo de unificación** | Bajo para `section-heading`; **el `eyebrow` suelto no debe absorberse** en la primitive. |
| **Recomendación** | **Candidato a primitive** sólo para el bloque compuesto. |
| **Objetivo sugerido** | `src/ui/layout/SectionHeading` (`title`, `description?`, `action?`) |
| **Tarea** | **P3-49** |
| **Dependencias CSS** | `.section-heading` (2 reglas), `.eyebrow` (2 reglas) |
| **Requisitos a11y** | Mantener jerarquía de encabezados coherente; no degradar `h3` a `div`. |
| **Estrategia** | Migrar 2 consumidores representativos (uno con acción, uno sin) → validar → resto. |

---

### UI-007 · Contenedor `card` y sus variantes
| Campo | Detalle |
|---|---|
| **Categoría** | Layout |
| **Prioridad** | **P2** |
| **Ubicaciones** | `card form-grid` ×4, `card wide` ×3, `card confirm-modal` ×3, más ~12 variantes de uso único (`card wide day-switcher-card`, `card wide cycle-management-card`, `setup-card …`, `weekly-results-card`, `training-completion-card`, …) |
| **Implementaciones** | ~20 combinaciones distintas |
| **Similitudes** | Todas son `<div>` contenedor con clase base `card` o `setup-card` y un modificador por feature. |
| **Diferencias** | **Los modificadores llevan estilos propios reales** (`day-switcher-card`, `cycle-management-card`, etc.), no son decorativos. Unificar la base no elimina la variedad. |
| **Riesgo de unificación** | **Medio-alto**: el beneficio es bajo (un `<div>` con clase) y el riesgo de romper layout es real. |
| **Recomendación** | **Similitud visual con comportamiento diferente.** Unificar sólo `card`/`card wide`; **no** absorber los modificadores por feature. |
| **Objetivo sugerido** | `src/ui/layout/Card` (`wide?: boolean`, `className?` para el modificador de feature) |
| **Tarea** | **P3-49** |
| **Dependencias CSS** | `.card`, `.card.wide`, `.setup-card` y ~15 modificadores |
| **Requisitos a11y** | Ninguno específico; no convertir en `section` sin encabezado asociado. |
| **Estrategia** | Baja prioridad. Migrar sólo si P3-49 termina antes de lo previsto. |

---

### UI-008 · Tamaños de icono inconsistentes
| Campo | Detalle |
|---|---|
| **Categoría** | Patrones transversales |
| **Prioridad** | **P2** |
| **Ubicaciones** | 20 archivos importan `lucide-react` |
| **Implementaciones** | 12 tamaños distintos: `17`(×12), `18`(×9), `16`(×7), `28`(×5), `24`(×2), y `30/22/20/19/14/13/12` con una ocurrencia cada uno |
| **Similitudes** | Misma librería, mismo uso decorativo junto a texto de acción. |
| **Diferencias** | El tamaño responde al contexto (botón, header, hero). Los valores únicos (`13`, `19`, `30`) parecen ajustes puntuales, no una escala. |
| **Riesgo de unificación** | Bajo técnicamente, **pero es un cambio visual**: normalizar `17→16` altera la interfaz, y el ticket prohíbe rediseñar. |
| **Recomendación** | **No unificar tamaños en P3-47/48/49.** Documentar la escala de facto y proponer normalización sólo como decisión de producto explícita. |
| **Objetivo sugerido** | Constantes de escala (`ICON_SM/MD/LG`) sin cambiar los valores existentes en la primera pasada. |
| **Tarea** | **P3-50** (sólo documentar/decidir) |
| **Dependencias CSS** | Ninguna (prop del componente) |
| **Requisitos a11y** | Iconos decorativos deben mantener `aria-hidden="true"` — hoy hay 57 usos de `aria-hidden`, buen indicio. |
| **Estrategia** | Inventario y decisión; **sin** cambio automático. |

---

### UI-009 · Estados vacíos
| Campo | Detalle |
|---|---|
| **Categoría** | Feedback |
| **Prioridad** | **P2** |
| **Ubicaciones** | `weekly-comparison-empty` ×7 (+1 `compact`), `empty-dashboard`/`empty-hero`, `notification-empty`, `drawer-empty`, `dashboard-empty-progress`, `weekly-progress-empty-copy`, `CycleHistoryEmptyState` |
| **Implementaciones** | ~7 tratamientos distintos |
| **Similitudes** | Todos comunican "no hay datos" con un texto breve. |
| **Diferencias** | Muy variados en composición: `empty-dashboard` es un hero con logo y CTA; `weekly-comparison-empty` es una línea dentro de una tabla; `CycleHistoryEmptyState` es un `<p>` de una línea. **No son el mismo componente.** |
| **Riesgo de unificación** | Alto si se fuerza uno solo. |
| **Recomendación** | **Falso positivo parcial.** Unificar únicamente el caso "texto simple de vacío"; dejar `empty-dashboard` como componente de feature. |
| **Objetivo sugerido** | `src/ui/feedback/EmptyState` (`message`, `action?`) sólo para los casos de texto simple |
| **Tarea** | **P3-48** |
| **Dependencias CSS** | Múltiples clases por feature |
| **Requisitos a11y** | Un estado vacío tras una búsqueda/carga debería ser anunciado (`role="status"`), como ya hace cycle-history. |
| **Estrategia** | Migrar sólo `notification-empty` y `drawer-empty`; evaluar el resto después. |

---

### UI-010 · Skeletons / loading
| Campo | Detalle |
|---|---|
| **Categoría** | Feedback |
| **Prioridad** | **P2** |
| **Ubicaciones** | `exercise-performance-skeleton` ×2 (Active Workout); `CycleHistoryLoadingState` (`skeletonLine` ×2, con `role="status"`) |
| **Implementaciones** | 2 enfoques |
| **Similitudes** | Ambos muestran barras de carga placeholder. |
| **Diferencias** | cycle-history usa CSS Modules + live region correcta; Active Workout usa clase global sin live region. |
| **Riesgo de unificación** | Medio: cycle-history está aislado por CSS Modules; unificarlo implicaría migrar su estilo a global o el resto a módulos. Decisión arquitectónica mayor. |
| **Recomendación** | **Candidato a primitive** con la reserva anterior. cycle-history es el patrón correcto a11y. |
| **Objetivo sugerido** | `src/ui/feedback/SkeletonLines` (`lines`, `label`) |
| **Tarea** | **P3-48** |
| **Dependencias CSS** | `.exercise-performance-skeleton` (global) vs `cycle-history.module.css` |
| **Requisitos a11y** | `role="status"` + `aria-live="polite"` + label textual; barras con `aria-hidden`. |
| **Estrategia** | Definir primero la política global-vs-módulos (§16, riesgo R4). |

---

### UI-011 · `aria-hidden` en iconos — patrón ya correcto
| Campo | Detalle |
|---|---|
| **Categoría** | Patrones transversales / a11y |
| **Prioridad** | **P3** |
| **Evidencia** | 57 usos de `aria-hidden` frente a 57 de `aria-label` — proporción sana. |
| **Recomendación** | **Patrón ya compartido correctamente.** Sólo verificar cobertura en P3-50, sin refactor. |
| **Tarea** | **P3-50** |

---

### UI-012 · Pills / chips / badges
| Campo | Detalle |
|---|---|
| **Categoría** | Visualización de datos |
| **Prioridad** | **P3** |
| **Ubicaciones** | `routine-day-pills`/`routine-day-pill`, `dashboard-day-pill`, `weekly-series-pill`, `cycle-chip-grid days`, `notification-badge` |
| **Implementaciones** | 5 |
| **Similitudes** | Etiqueta compacta con fondo. |
| **Diferencias** | **Comportamiento distinto**: `routine-day-pill` es un `<button>` interactivo con estado `configured/active`; `notification-badge` es un contador no interactivo; `weekly-series-pill` es dato puro. |
| **Riesgo de unificación** | Alto — mezclaría interactivo con no interactivo. |
| **Recomendación** | **Similitud visual con comportamiento diferente.** No unificar en una sola primitive. |
| **Objetivo sugerido** | A lo sumo `src/ui/data-display/Badge` para los **no** interactivos. |
| **Tarea** | **P3-49** (opcional) |

---

### UI-013 · Barras de progreso
| Campo | Detalle |
|---|---|
| **Categoría** | Visualización de datos |
| **Prioridad** | **P3** |
| **Ubicaciones** | `mini-progress-track`/`mini-progress-fill`, `routine-build-progress`, `weekly-progress-*` (SVG) |
| **Implementaciones** | 3 |
| **Diferencias** | El de Progress es un **SVG con interacción de teclado** (`tabIndex={0}`, `onKeyDown`, `Escape`); los otros son barras CSS estáticas. |
| **Recomendación** | Unificar sólo las dos barras CSS. El SVG **no**. |
| **Tarea** | **P3-49** |
| **Requisitos a11y** | Si se hace interactivo, `role="progressbar"` + `aria-valuenow/min/max`. |

---

### UI-014 · Tablas de datos
| Campo | Detalle |
|---|---|
| **Categoría** | Visualización de datos |
| **Prioridad** | **P3** |
| **Ubicaciones** | `TrainingCompletionSummaryScreen` (`training-completion-table` con `role="table"`), cycle-history |
| **Evidencia** | `role="table"` ×3, `role="row"` ×6, `role="cell"` ×12, `role="columnheader"` ×12, `role="rowgroup"` ×4 |
| **Similitudes** | Ambas usan roles ARIA de tabla explícitos. |
| **Diferencias** | Dominios y columnas totalmente distintos; una está en CSS Modules. |
| **Recomendación** | **Falso positivo.** El uso de roles ARIA es correcto y ya consistente; no hay componente común que extraer sin inventar una tabla genérica. |
| **Tarea** | Ninguna |

---

### UI-015 · `src/ui/data-display` — patrón ya compartido
| Campo | Detalle |
|---|---|
| **Categoría** | Visualización de datos |
| **Prioridad** | **P3** (referencia) |
| **Ubicaciones** | `metric-grid.tsx` (`RoutineMetricGrid`, `MetricGrid`), `index-dots.tsx`, `trend-value.tsx` |
| **Consumidores** | `dashboard-screen`, `GuidedTrainingScreen`, `TrainingStartScreen`, `dashboard-day-dots`, y `metric-grid` → `trend-value` |
| **Recomendación** | **Patrón ya compartido correctamente.** Es el modelo a replicar: primitive pequeña, props limitadas, consumida por varias features, protegida por contrato (`dashboard-visual-integration-contract` verifica una única definición exportada). |
| **Tarea** | Ninguna — usar como referencia de estilo para P3-47/48/49. |

---

### UI-016 · Drawer y panel lateral
| Campo | Detalle |
|---|---|
| **Categoría** | Modales / Layout |
| **Prioridad** | **NO UNIFICAR** |
| **Ubicaciones** | `app-navigation-drawer.tsx` (`role="dialog"` sin `aria-modal`), `NotificationPanel.tsx` (`role="dialog"` sin `aria-modal`), `ProfileAvatarEditor.tsx` (`role="dialog"` + `aria-modal`) |
| **Similitudes** | Los tres usan `role="dialog"`. |
| **Diferencias** | Son **tres cosas distintas**: drawer de navegación deslizante, panel de notificaciones anclado, y editor de avatar con recorte por gesto (usa `previewRef`, arrastre). Comportamiento, layout y ciclo de vida diferentes. |
| **Recomendación** | **Debe permanecer específico de su feature.** Sólo podrían compartir la utilidad de foco de UI-001, no el shell. |
| **Tarea** | **P3-50** (revisar sólo foco/`aria-modal`) |

---

### UI-017 · `mobile-menu` duplicado app vs website-preview
| Campo | Detalle |
|---|---|
| **Categoría** | Layout / Navegación |
| **Prioridad** | **NO UNIFICAR** |
| **Ubicaciones** | `src/app/mobile-menu.tsx`, `src/app/website-preview/mobile-menu.tsx` |
| **Similitudes** | Estructura casi idéntica (`menuRef`, `buttonRef`, `firstLinkRef`, `Escape`, foco). |
| **Diferencias** | Pertenecen a **superficies distintas**: la landing pública y la vista de preview del sitio. Ninguna forma parte del producto autenticado. |
| **Recomendación** | Duplicación real **pero fuera del alcance del producto**. Unificarlas no mejora la app y acopla marketing con preview. |
| **Tarea** | Ninguna en P3-47..P3-50 |

---

### UI-018 · Pantallas QA
| Campo | Detalle |
|---|---|
| **Categoría** | Transversal |
| **Prioridad** | **NO UNIFICAR** |
| **Ubicaciones** | `src/app/qa/training-cycles/`, `src/app/qa/training-cycle-history/` |
| **Recomendación** | Herramientas internas de QA, con su propio `.module.css` y política (`training-cycles-qa-policy.ts`). **Excluir de toda migración de UI compartida.** |
| **Tarea** | Ninguna |

---

## 8. Componentes ya compartidos correctamente

| Componente | Ubicación | Consumidores | Nota |
|---|---|---|---|
| `RoutineMetricGrid` / `MetricGrid` | `src/ui/data-display/metric-grid.tsx` | Dashboard, GuidedTrainingScreen, TrainingStartScreen | Protegido por contrato: una sola definición exportada |
| `IndexDots` | `src/ui/data-display/index-dots.tsx` | `dashboard-day-dots` | — |
| `TrendValue` | `src/ui/data-display/trend-value.tsx` | `metric-grid` | Composición de primitives |
| `CycleHistoryStates` | `src/components/training/cycle-history/` | cycle-history | **Referencia de a11y**: `role="status"`, `aria-live`, `role="alert"` |
| `NotificationIcons` | `src/features/notifications/components/` | NotificationGroup, NotificationPanel | Compartido dentro de su feature |
| `UserAvatar` | `src/components/profile/` | ProfileScreen, ProfileMenuHeader | Compartido correctamente |

## 9. Falsos positivos descartados

1. **Tablas ARIA (UI-014)** — roles idénticos, dominios incompatibles. No hay componente extraíble.
2. **Clase `eyebrow`** — 39 ocurrencias, pero cumple **dos** funciones (descripción de sección y texto secundario suelto). Contar las 39 como una duplicación sería un error de método.
3. **Estados vacíos (UI-009)** — comparten intención, no estructura. Sólo un subconjunto es unificable.
4. **`card` + modificadores (UI-007)** — los modificadores llevan estilo real; no son ruido.
5. **`role="dialog"` ×7** — sólo 4 son modales; drawer, panel de notificaciones y editor de avatar son patrones distintos (UI-016).

## 10. Observaciones de accesibilidad

**Fortalezas reales:** 57 `aria-label` y 57 `aria-hidden`; roles de tabla completos y correctos;
`aria-expanded`(6)/`aria-controls`(4) en controles desplegables; `aria-readonly` en el email de perfil;
`cycle-history` con live regions correctas; `weekly-progress-svg` con `tabIndex` + `Escape`.

**Brechas concretas:**
1. **Foco no gestionado en los 4 modales** (UI-001) — sin trap, sin foco inicial, sin `Escape`, sin restauración. **P0.**
2. **Mensajes dinámicos sin live region** fuera de cycle-history (UI-003). **P0.**
3. **Labels implícitos** en `TextField`/`ProfileField`: `<label>` envolvente sin `htmlFor`/`id`. Funciona, pero impide `aria-describedby` para errores. **P1** (UI-004).
4. **Errores no asociados al control**: `ProfileField` pinta `<small>` sin `aria-describedby` ni `aria-invalid`. **P1.**
5. **`icon-button`** (6 ocurrencias) — debe garantizarse `aria-label` por tipo, no por convención. **P1** (UI-005).
6. **Un solo `aria-live` y un solo `aria-labelledby`** en toda la base: confirma que el feedback dinámico es el punto más débil.

**No verificado** (requiere navegador, excluido del alcance): contraste, orden de tabulación real,
comportamiento con lector de pantalla, `prefers-reduced-motion`.

## 11. Dependencias con `globals.css`

`src/app/globals.css`: **5.244 líneas**, ~**740** selectores de clase. Es la fuente de estilo de casi
toda la UI; sólo `cycle-history`, `page.module.css`, `website-preview` y QA usan CSS Modules.

Clases que las primitives propuestas heredarán (no deben renombrarse en P3-47..P3-49):

| Primitive | Clases acopladas |
|---|---|
| `Button` / `IconButton` | `.button`, `.secondary`, `.success-solid`, `.danger-solid`, `.icon-button`(3), `.start-button` |
| `FormField` / `TextInput` | `.field` (`:3195`), `.profile-field` (`:586`) + descendientes `input/select/:focus/[readonly]/small` |
| `ModalShell` / `ConfirmDialog` | `.modal-backdrop` (`:4389`), `.confirm-modal` (`:4399`, `:4405`), `.modal-actions` |
| `SectionHeading` | `.section-heading`(2), `.eyebrow`(2) |
| `Card` | `.card`, `.card.wide`, `.setup-card` + ~15 modificadores |
| `StatusMessage` | `.notice-banner`, `.profile-form-status`, `.profile-avatar-status`, `.profile-inline-notice` |

**Regla para las fases siguientes:** las primitives **consumen** estas clases; no se renombran, no se
mueven a módulos y **no se elimina CSS** hasta demostrar que no quedan callers (paso 7 del plan).

## 12. Estructura objetivo propuesta para `src/ui/`

Propuesta **no creada** en esta tarea:

```
src/ui/
├── buttons/       Button · IconButton
├── forms/         FormField · TextInput
├── feedback/      StatusMessage · EmptyState · SkeletonLines
├── layout/        SectionHeading · Card
├── modals/        ModalShell · ConfirmDialog
└── data-display/  (ya existe) metric-grid · index-dots · trend-value
```

Criterios: responsabilidad única, props limitadas, semántica HTML correcta, estados accesibles,
mobile-first, dependencia CSS explícita y documentada. **Sin componente universal con muchas
variantes**: preferir `ConfirmDialog` sobre un `Modal` con 10 props booleanas.

## 13. Orden de migración recomendado

**P3-47 — Botones y formularios**
1. `Button` + `IconButton` (sin lógica de negocio).
2. Migrar **sólo** los botones de los 3 modales de confirmación.
3. Validar contratos de training-plan y routine-builder.
4. `FormField` + `TextInput`; migrar Profile.
5. **No** tocar `organizatech-app.tsx` (incluye su `TextField`).

**P3-48 — Feedback, vacíos y modales**
1. `ModalShell` con foco/`Escape` (resuelve UI-001).
2. `ConfirmDialog` sobre el shell; migrar 1 modal → validar → los otros 2.
3. `RoutineSuccessModal` reutiliza el shell, **no** `ConfirmDialog`.
4. `StatusMessage` con live regions; migrar Profile primero.
5. `EmptyState` sólo para casos de texto simple; `SkeletonLines` tras decidir el riesgo R4.

**P3-49 — Layout y datos**
1. `SectionHeading`; migrar 2 consumidores → validar → resto.
2. `Card` sólo base + `wide`.
3. Opcional: `Badge` no interactivo, barra de progreso CSS.

**P3-50 — Accesibilidad y consistencia**
1. Auditar foco/teclado en modales, drawer y panel.
2. Verificar live regions migradas.
3. Labels explícitos + `aria-describedby`/`aria-invalid`.
4. Decidir (no imponer) escala de iconos.
5. Sólo aquí: proponer limpieza de CSS demostrablemente huérfano.

Cada fase: primitive → 1-2 consumidores → validación → resto → eliminar duplicado **sólo** sin callers.

## 14. Matriz de conflictos entre features

| Archivo | Riesgo | Tareas en conflicto |
|---|---|---|
| `src/components/organizatech-app.tsx` | **Muy alto** | Root compartido; sigue siendo tocado por la línea P3-3x. **Excluir de P3-47..P3-49.** |
| `features/active-workout/components/GuidedTrainingScreen.tsx` | **Alto** | Contiene `notice-banner` (UI-003) y 6 botones. **P3-33 está activo en paralelo** → no tocar hasta que P3-33 se integre. |
| `src/app/globals.css` | **Alto** | Cualquier renombrado afecta a toda la app. Sólo lectura en P3-47..P3-49. |
| 9 contratos visuales estáticos | **Medio** | Leen rutas hardcodeadas; cada migración debe actualizar el suyo deliberadamente. |
| `ConfirmDeleteCycleModal` / `ConfirmNewCycleModal` | Bajo | training-plan; coordinar con P3-48. |
| `ConfirmRoutineUpdateModal` / `RoutineSuccessModal` | Bajo | routine-builder; coordinar con P3-48. |
| `ProfileScreen.tsx` | Medio | UI-003 **y** UI-004 tocan el mismo archivo → secuenciar, no paralelizar. |
| `cycle-history/*` | Medio | CSS Modules aislados; no mezclar con primitives globales sin decidir R4. |

## 15. Archivos que no deben modificarse simultáneamente

- `ProfileScreen.tsx` — objetivo de UI-003 y UI-004: **una tarea a la vez**.
- `GuidedTrainingScreen.tsx` — bloqueado mientras P3-33 esté activo.
- `organizatech-app.tsx` — no debe entrar en P3-47/48/49.
- `globals.css` — no debe modificarse mientras haya migraciones abiertas.
- Los 4 modales — migrar de a uno, validando entre cada paso.
- Contratos visuales — un contrato por tarea, nunca varios a la vez.

## 16. Riesgos

| ID | Riesgo | Mitigación |
|---|---|---|
| **R1** | Migrar botones toca 31 archivos y puede romper varios contratos a la vez. | Migrar por variante y por feature; empezar por modales. |
| **R2** | Unificar `.field` y `.profile-field` en una sola clase cambiaría la apariencia. | Unificar estructura, mantener clase por `variant`. |
| **R3** | Añadir focus trap altera el comportamiento de teclado (no visual) y no hay tests de runtime DOM. | Validación manual con teclado + contrato estático de atributos. |
| **R4** | `cycle-history` usa CSS Modules; el resto usa globals. Unificar skeletons obliga a decidir la política. | Decidir **antes** de P3-48; si no hay consenso, dejar cycle-history aparte. |
| **R5** | P3-33 activo en paralelo sobre Active Workout. | No tocar `GuidedTrainingScreen` hasta integrar P3-33. |
| **R6** | Los 9 contratos estáticos pueden dar falsa sensación de cobertura: verifican **fuente**, no render. | Declararlos siempre como estáticos; no presentarlos como cobertura runtime. |
| **R7** | Tentación de eliminar CSS "huérfano" al migrar. | Prohibido hasta P3-50 y sólo con evidencia de cero callers. |
| **R8** | Sobre-abstracción (un `Modal` con 10 props). | Primitives pequeñas; `ConfirmDialog` separado de `ModalShell`. |

## 17. Criterios de aceptación para P3-47/P3-48/P3-49/P3-50

**Comunes:** sin cambios visuales salvo los declarados; textos, navegación y lógica intactos; sin
nuevas dependencias; `globals.css` sin modificar (salvo P3-50 con evidencia); contratos actualizados
deliberadamente y nunca debilitados; lint + typecheck + test + build en verde; sin tocar
`organizatech-app.tsx`; duplicado eliminado **sólo** sin callers restantes.

**P3-47:** `Button`/`IconButton`/`FormField`/`TextInput` en `src/ui/`; ≥2 consumidores migrados por
primitive; `IconButton` exige `aria-label` **en el tipo**; variantes CSS actuales preservadas.

**P3-48:** `ModalShell` con foco inicial, trap, `Escape` y restauración; `ConfirmDialog` sobre el
shell; los 3 modales de confirmación migrados; `aria-label` originales preservados; `StatusMessage`
con `role="alert"`/`role="status"` según tono; sin anuncios duplicados.

**P3-49:** `SectionHeading` y `Card` (base + `wide`); modificadores de feature preservados vía
`className`; jerarquía de encabezados intacta.

**P3-50:** auditoría de foco documentada; live regions verificadas; labels explícitos con
`aria-describedby`/`aria-invalid`; decisión registrada sobre la escala de iconos; propuesta de CSS
huérfano **con evidencia de cero callers**, sin ejecutar la eliminación si hay duda.

## 18. Conteos finales por categoría y prioridad

**Por categoría**

| Categoría | Candidatos | IDs |
|---|---|---|
| Botones | 1 | UI-005 |
| Formularios | 1 | UI-004 |
| Feedback | 4 | UI-003, UI-009, UI-010, (UI-011 a11y) |
| Modales | 3 | UI-001, UI-002, UI-016 |
| Layout | 3 | UI-006, UI-007, UI-017 |
| Visualización de datos | 4 | UI-012, UI-013, UI-014, UI-015 |
| Transversales | 2 | UI-008, UI-018 |
| **Total** | **18** | |

**Por prioridad**

| Prioridad | Nº | IDs |
|---|---|---|
| **P0** | 2 | UI-001, UI-003 |
| **P1** | 4 | UI-002, UI-004, UI-005, UI-006 |
| **P2** | 4 | UI-007, UI-008, UI-009, UI-010 |
| **P3** | 5 | UI-011, UI-012, UI-013, UI-014, UI-015 |
| **NO UNIFICAR** | 3 | UI-016, UI-017, UI-018 |

**Por tarea futura:** P3-47 → 2 (UI-004, UI-005) · P3-48 → 5 (UI-001, UI-002, UI-003, UI-009, UI-010)
· P3-49 → 4 (UI-006, UI-007, UI-012, UI-013) · P3-50 → 3 (UI-008, UI-011, UI-016) · sin tarea → 4.

**Métricas de base:** 51 componentes visuales · 3 primitives compartidas · 31 archivos con `<button>`
· 18 `<input>` · 16 `<label>` · 4 modales · 9 contratos visuales · `globals.css` 5.244 líneas / ~740
selectores · 7 `role="dialog"` · 3 live regions (todas en cycle-history) · 0 focus traps.
