# Coach — revisión histórica de la proyección aislada

> Registro del lote anterior al montaje productivo. No describe el estado vigente;
> consultar `integration-contract.md` y `progress.md`.

## Alcance y estado

Delta posterior al PASS de integración aislada; no hereda auditoría independiente.
Clasificación principal: `Sin cambio visible`.
Declaración secundaria: `Contiene infraestructura visual aislada y no montada`.
Card, Button, Section, Modal, Drawer y texto visible agregados o modificados: ninguno.

Ownership temporal: ROOT `/Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-01`,
branch `codex/coach-dashboard-01`, base `00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`.
Stash protegido `7e618d67efb4290082a4f6be258c1f75640856c8`: no tocar.

## Contrato mínimo

`projectCoachPreferencesPresentation(state, canSaveFee)` recibe el snapshot actual
y la capacidad booleana real de su controller, obtenidos juntos. Devuelve sólo
siete campos escalares readonly en un objeto congelado:

| Campo | Fuente |
| --- | --- |
| `feeOpen` | `feeDraft !== null`; vacío continúa abierto |
| `feeRaw` | `feeDraft` exacto, sin parsear, recortar ni formatear |
| `busy` | `pending !== null`; nunca `needsRefresh` |
| `chatOpen` | `state.chatOpen` |
| `isRegistered` | confirmación real de Chat o `null` si desconocida |
| `canSave` | confirmado, sin refresh/pending, Fee abierto y capacidad del controller |
| `canRegister` | confirmado, sin refresh/pending, Chat abierto y registro confirmado `false` |

No se entrega el controller ni callbacks al mapper. No hay I/O, suscripción,
estado retenido, efectos, Auth, React, SQL ni import del runtime/repository/parser.
Los flags son presentación, no una autorización de persistencia: el controller
y el servidor conservan sus validaciones y controles de identidad.
El mapper no reinterpreta sintaxis ni versiones; respeta `canSaveFee`.

Fuera de alcance: preview, cartera, ingresos, presets, `isInvalid`, touched,
mensajes/copy, props nuevos, binding React, foco y montaje productivo.
Una futura conexión debe resolver esas entradas y el ciclo de vida por identidad
con autorización propia. La guía Next.js se aplicó manteniendo el módulo puro,
sin directivas client/server ni nuevo boundary de renderizado.

## Inventario exclusivo del delta

- Nuevo: `src/features/coach-dashboard/integration/coach-preferences-presentation.ts`.
- Nuevo: `src/features/coach-dashboard/integration/coach-preferences-presentation.test.ts`.
- Nuevo: `docs/product/coach-dashboard/preferences-presentation-review.md`.
- Modificado: `package.json`, sólo añadir la ruta literal al script existente
  `test:coach-dashboard-integration`, ya conectado a `posttest`.
- Modificado: `src/features/active-workout/active-workout-visual-integration-contract.test.ts`,
  únicamente el hash de `package.json` después de comprobar el diff y lock intacto.

## Validaciones y auditoría

Gates técnicos del delta ejecutados el 2026-09-08:

| Comando | Resultado | Log local |
| --- | --- | --- |
| `npm run test:coach-dashboard-integration` | PASS, exit 0, 19/19: 10 nuevos + 9 runtime existentes | `focal.log` |
| `npm run typecheck` | PASS, exit 0 | `typecheck.log` |
| `npm run lint` | PASS, exit 0, sin warnings | `lint.log` |
| `npm test` completo, incluidos pretest/posttest | PASS, exit 0, sesión 24391 | `npm-test.log` |
| `npm run build` | PASS, exit 0, sesión 5004 | `build.log` |
| `git diff --check` y whitespace de los tres archivos nuevos | PASS, verificador exit 0 | `diff-check.log` |

Directorio de logs: `/tmp/organizatech-coach-presentation.GVQPqa/`.
Baseline previo del delta: `baseline.json` en ese directorio, 131 rutas; hash
agregado `9c77aa752409766326fe50327f70d0938405916eb7f9f9b9803cb864f5154f4f`
(SHA-256 de rutas relativas ordenadas, cada ruta + NUL + contenido crudo).
Los tests del delta cubren null/cero/vacío/raw, capacidades, pending/readback,
confirmación real de Chat, inmutabilidad y ausencia de efectos sobre el controller.
El inventario `.test.ts/.test.tsx` cuenta 220 referencias únicas y 220 archivos
(211 en `src`, 9 en `supabase/functions`), sin duplicados, faltantes ni rutas
inexistentes. La nueva ruta aparece exactamente una vez.

Preservación: los 114 hashes del manifiesto de transferencia coinciden. De las
131 rutas dirty previas, 129 permanecen byte-idénticas; sólo cambian package y
el hash autorizado de su contrato. Al revertir en memoria exclusivamente esas
dos sustituciones se recuperan los hashes exactos de ambas versiones previas.
Ahora hay 134 rutas dirty: se agregan exclusivamente los tres archivos nuevos.
El lock sigue byte-idéntico; no se añaden dependencias ni exclusiones.

SHA-256 del código/configuración del delta:

| Archivo | SHA-256 |
| --- | --- |
| `src/features/coach-dashboard/integration/coach-preferences-presentation.ts` | `65da9aa556b8dba9d177769adc6811eb4f5213b41bcb882fb3f9973ffabbcaed` |
| `src/features/coach-dashboard/integration/coach-preferences-presentation.test.ts` | `16ff0d121df4c5d53305e8541e9260b4b42378b886aceb0d84106afbfab4e3cd` |
| `package.json` | `2174ba7545a6392d18112876410d68cde16158ed2a434df7510b1c8fa36bc426` |
| `src/features/active-workout/active-workout-visual-integration-contract.test.ts` | `8f62d089c0d97fe5b2f1ab01ad6d4d9ec9c63e36ee71becf7135e39a39bde529` |
| `package-lock.json` (sin cambios) | `3651f947e7f6d9c7fc2079b73c863d8a71728adae24ab857b60be2e5b43dedc5` |

La búsqueda de referencias en `src` sólo encuentra la declaración del mapper y
el import de su test; ninguna pantalla, controller o runtime productivo lo importa.
Sin commit/push, navegador, Preview, QA/PROD ni ejecución remota.
Auditoría independiente del delta: **PASS**, GPT-5.6 Sol con razonamiento medio,
elegido expresamente por el dueño: «Haz las auditoria con chatgpt 5.6 sol medio».
Agente `/root/cycle_technique_picker_sol_audit`, revisión read-only independiente;
no implementó este delta. Informe `sol-audit.md` en el directorio de evidencia.
No se atribuye este resultado a Claude ni se hereda una auditoría anterior.

El auditor confirmó las cinco rutas, preservación de lotes, capacidades sin
parsing duplicado, readback, ausencia de efectos/conexión productiva e inventario
de tests. Sin hallazgos que requieran corrección. Inspeccionó los logs del
implementador, sin ejecutar gates. Su observación documental era reemplazar
el estado preauditoría «Claude pendiente» por el auditor real; queda resuelta aquí.
Código/tests/configuración no cambiaron después de la revisión.

Este PASS cierra sólo la proyección aislada. No certifica binding/lifecycle,
invitaciones/correo/vínculos/métricas, seguridad final, QA alojada ni producción.
No certifica el flujo Coach completo ni autoriza conectar UI.
