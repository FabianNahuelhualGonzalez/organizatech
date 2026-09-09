# Catálogo de ciclos — ajustes aprobados (2026-09-08)

## Alcance y aprobación previa

Cambio visual aprobado por el dueño de producto en este hilo: observaciones
sobre las fotos 1–5, aprobación del mensaje breve y «Perfecto, ahora si,
sigamos!». No se modifica Coach, vinculación, navegación global ni producción.

- **Card:** sustituir los avisos amarillos «Revisa tu distribución» de Rutina
  por una indicación neutral; adaptar el estado vacío existente del catálogo.
- **Button:** ordenar Todos / Ciclo anterior / Recientes, abrir con Todos;
  ofrecer «Ver ejercicios» y «Crear ejercicio» sin historial. Mantener `+`,
  la búsqueda y «Listo · ir a la rutina».
- **Section:** las mismas Rutina y Agregar ejercicios; sin nueva sección global.
- **Modal / Drawer:** ninguno nuevo o modificado.
- **Texto visible:** indicación neutral, mensaje breve de historial vacío y
  confirmación flotante de incorporación al borrador. No es confirmación de
  guardado en servidor; no sustituye ni oculta errores reales.
- **Interacción:** confirmación temporal, animada y visible sin hacer scroll,
  sin capturar foco ni bloquear pulsaciones; respetar movimiento reducido.
- **Infraestructura visual aislada:** ninguna; componentes privados de esta
  feature implementan exclusivamente la conexión visible aprobada.

## Referencia previa y wireframe

Before: las cinco fotos adjuntas en este hilo, lote
`1AF47D35-B38A-477F-9429-2E55D526C860`, muestran la rutina, el estado sin
historial y el catálogo con `+` sin confirmación. No se copian datos personales.

```text
Rutina
Nombre [Empuje]
(i) Tu distribución se actualizará a medida que agregues ejercicios
[ejercicios y acciones existentes]
[Ver distribución muscular]

Agregar a Lunes
[Buscar ejercicio o grupo…]
[Todos (inicial)] [Ciclo anterior] [Recientes]
[catálogo completo, cada ejercicio con +]

Al incorporar un ejercicio: confirmación fija en el viewport
[✓ Press militar agregado a Lunes] → desaparece sin bloquear la pantalla

Ciclo anterior sin historial y sin búsqueda
Aún no tienes ejercicios de un ciclo anterior. Explora el catálogo o crea
el que no encuentres: quedará guardado en tu cuenta para futuras rutinas.
[Ver ejercicios] [Crear ejercicio]
```

Una búsqueda no vacía sin coincidencias conserva un mensaje específico para
esa búsqueda. Nunca se presentan comillas vacías. Los ejercicios personalizados
siguen el flujo privado de guardado existente; no se publica un catálogo global.

## Resultado técnico y gates

- Implementación: completa en el worktree de ciclos, sin tocar el composition root.
- Validaciones automáticas: PASS en `npm run typecheck`, `npm run lint`,
  `npm run test:training-cycle-builder-frontend` (39 pruebas de estado/presentación,
  7 de autosave, 4 de video y contrato), `npm test`, `npm run build` y
  `git diff --check`.
- Intento inicial de auditoría Claude: BLOQUEADO. Se intentó mediante la CLI
  configurada, con sólo Read/Grep/Glob, sin herramientas de escritura,
  navegador ni MCP. La cuenta alcanzó su límite de sesión; no se recibió
  un informe de auditoría.
- Excepción autorizada por el dueño: ante «¿Autorizas que otro agente independiente
  complete la auditoría ahora?», respondió «Si autorizo» en este hilo.
- Auditoría alternativa read-only `audit_catalog_ux`: detectó una regresión en la
  precarga del nombre de un ejercicio personalizado. Se corrigió para preservar
  nombre, grupo, video y error previo al reabrir sin una nueva búsqueda. Se añadió
  una prueba funcional y un contrato de conexión. Reauditoría final: **PASS**.
  El auditor verificó cinco casos mediante un probe independiente sobre los
  handlers reales y repitió las pruebas focales (39 + 7 + 4 y contratos), sin
  modificar archivos. No identificó otros defectos concretos en el alcance.
- Commit/push: exclusivamente el dueño, después del PASS técnico.
- Preview de este cambio: pendiente; el Preview anterior no contiene este ajuste.
- After, QA iPhone 15 Pro Max (scroll, teclado, safe-area, pulsaciones repetidas,
  movimiento reducido) y aprobación final: exclusivamente el dueño en Preview.
- Merge / producción: bloqueados hasta QA y aprobación final PASS.

Sin navegador, migraciones, cambios remotos ni variables de entorno.

La guía de React orientó la separación del catálogo y del aviso en componentes
privados pequeños, sin store global ni lógica nueva en el composition root.
El PASS técnico no cubre una medición real del layout o de los anuncios de
VoiceOver en Safari: esos puntos siguen en la QA del dueño.

## Archivos del cambio

Todos bajo `src/features/training-cycle-builder/`, salvo este registro:

- `components/cycle-routine-screens.tsx`: mensaje neutral y extracción del catálogo.
- `components/cycle-catalog-screen.tsx`: catálogo y estados vacíos aprobados.
- `components/cycle-catalog-addition-notice.tsx`: confirmación temporal accesible.
- `components/training-cycle-builder.module.css`: aviso fijo y estilos acotados.
- `model/catalog-presentation.ts`: filtros, orden y mensajes según estado.
- `hooks/training-cycle-builder-state.ts`: inicio en Todos y confirmación de adición.
- `hooks/training-cycle-builder-state.check.ts`: regresiones de catálogo y avisos.
- `training-cycle-builder-frontend-contract.check.ts`: contratos visuales/accesibilidad.

HEAD conservado: `5089a21d813a75f458003143a7c75a1bafb08ca0`.
Stash protegido conservado: `7e618d67efb4290082a4f6be258c1f75640856c8`.

## Instrucciones y alcance de auditoría

Título exacto: **Auditoría — Ciclos: catálogo y confirmación de ejercicios — QA técnico**.

El dueño autorizó realizar esta revisión con otro agente independiente por la
indisponibilidad de Claude. La revisión alternativa mantiene el título y alcance
read-only siguientes; no requiere crear otra tarea principal ni otro entorno.

Prompt:

```text
Audita exclusivamente en modo read-only el cambio de catálogo y confirmación
de ejercicios en /Users/fabiannahuelhual/Developer/organizatech-cycle-redesign-integration-01,
branch codex/cycle-redesign-integration-01, contra HEAD 5089a21d813a75f458003143a7c75a1bafb08ca0.
Lee docs/product/training-cycle-redesign/catalog-ux-review.md y sus ocho archivos
de código/pruebas, incluyendo los nuevos sin seguimiento. Comprueba los cuatro
requisitos aprobados, aislamiento de la feature, búsqueda y estados vacíos,
feedback sólo tras adición al borrador, repetición, desmontaje, reduced-motion,
foco, safe-area y ausencia de regresión de autosave y bloqueo de writes.
Verifica con pruebas locales deterministas cuando sea necesario. No modificar
archivos, ejecutar navegador, hacer QA manual, tocar Supabase, credenciales,
variables de entorno ni hacer commit/push/merge/despliegue. Coach y vinculación
siguen pausados. Entrega PASS, FAIL o REQUIERE MÁS PRUEBAS con evidencia y
hallazgos concretos por archivo/línea. El PASS técnico no sustituye la QA visual
y funcional del dueño. Devuelve el informe a la tarea principal de ciclos.
```

## QA pendiente del dueño en el nuevo Preview

1. Abrir Agregar ejercicio: Todos aparece primero y seleccionado, con catálogo.
2. Hacer scroll y pulsar `+`: aviso visible en el viewport durante unos segundos,
   sin mover la página ni impedir seguir agregando; cada pulsación agrega una vez.
3. Probar Ciclo anterior sin historial y una búsqueda sin resultados: textos
   distintos, sin comillas vacías; Ver ejercicios vuelve al catálogo completo.
4. Crear personalizado, escribir nombre/grupo/video, volver y reabrir sin buscar:
   datos conservados. Una búsqueda nueva puede precargar otro nombre.
5. Guardar un personalizado y comprobar su disponibilidad en futuras rutinas
   mediante el flujo existente de la cuenta, sin confundir el aviso de adición
   con el indicador de guardado remoto.
6. En Rutina, comprobar el texto neutral y acceso a distribución; revisar aviso
   con teclado abierto, nombres largos y movimiento reducido en Safari móvil.

No usar el Preview anterior para dar PASS a este cambio. Hace falta el despliegue
del commit que publique el dueño y su aprobación visual/funcional explícita.
