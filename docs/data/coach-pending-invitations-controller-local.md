# Listado pendiente: controlador y conexión de lectura

Estado: código, gates locales y auditoría independiente GPT-5.6 Sol medio PASS.
No montado; no QA manual ni migración remota ejecutada.

## Corrección detectada en gates de integración

La primera suite global de este incremento falló porque la migración de listado
agregada en el bloque anterior no estaba registrada en el inventario contractual
post-PERF. El bloque anterior ejecutó su suite global antes de integrar ese SQL;
sus pruebas SQL locales posteriores no cubrían este registro. Por eso el PASS
previo no demostraba la suite global con los cuatro SQL presentes.

Se agrega únicamente el nombre/hash exacto al contrato de invitaciones (con su
test de hash) y el path exacto a la allowlist del contrato Coach Portal. No se
desactiva el control de inventario, no se amplía a patrones y no cambia ningún SQL.
El log del FAIL se conserva; los gates completos corregidos deben pasar antes de
pedir la auditoría del lote. El delta incluye estos dos contratos adicionales.
La repetición completa R2 pasó después de la corrección, con los cuatro SQL
presentes: no se utiliza la ejecución previa al SQL como prueba de integración.

Este incremento compone la RPC de listado ya validada con un controlador de
búsqueda y paginación. No agrega SQL, pantallas, textos, rutas ni campos visibles;
no cambia reglas de invitación, aceptación, pagos o cohortes comerciales.

## Responsabilidades

- `hooks/coach-pending-invitations-*`: estado local de consulta, carga, páginas,
  errores seguros, cancelación y descarte de respuestas de consultas anteriores.
- `integration/coach-pending-invitations-runtime.ts`: composición con el repositorio
  de lectura existente, configuración pública y principal suministrados por el
  dueño de sesión. No lee variables, cookies, storage ni credenciales adicionales.
- El repositorio valida el DTO mínimo y fija el token verificado con `getUser`;
  aplica un deadline total a Auth + RPC, transporta AbortSignal y desactiva retries.
- La UI presentacional existente sigue aislada. No se agrega un botón de cargar
  más ni se decide un debounce o polling silencioso.

## Contrato de integración futuro

La construcción empieza en `idle` y no consulta nada. `setQuery(raw)` cancela y
reinicia la consulta local; el dueño invoca `load()` explícitamente después de
una entrada válida. `loadNext()` usa el cursor confirmado y sólo permite una
lectura pendiente. `reload()` reemplaza una lectura anterior desde la primera
página. No se deben derivar estados vacíos mirando únicamente `items.length`:
`phase`, `issue` y conteos desconocidos distinguen carga, error y resultados.

`invalidate()` aborta y purga sin red, permitiendo una nueva lectura explícita
en el mismo contexto. `dispose()` es terminal; también lo es una identidad
descartada o una respuesta de autorización denegada. Debe crearse una instancia
nueva para otra cuenta o generación, no cambiar la identidad de una existente.
Conservar filas durante un error de carga posterior no convierte esa lectura en
éxito ni demuestra que la cartera siga sin cambios.

## Límite de consistencia

Cada página es una lectura autoritativa independiente, no una fotografía congelada
de toda la cartera. Una cancelación remota puede cambiar conteos entre páginas;
el acumulado local no demuestra la pertenencia actual de cada fila ya entregada.
No se refiltra Unicode en JavaScript ni se derivan totales del tamaño de página.
El futuro dueño de pantalla debe invalidar/recargar después de una mutación
confirmada e invalidar/disponer en logout, cambio de cuenta, portal o contexto.
La sesión por sí sola no detecta una revocación remota ni borra datos ya entregados
a otros consumidores. No hay suscripción Realtime ni sondeo nuevo en este bloque.

## Verificación ejecutada

Pruebas puras del controlador y pruebas del runtime con el SDK instalado, Auth y
HTTP sintéticos, sin red ni cuentas reales. Cubren consultas tardías, paginación,
cancelación que el transporte ignora, deadline, cambios de identidad y errores
sin exponer mensajes del servidor. DOMAIN entregó 33 casos focales y 256 de
regresión local, typecheck/lint/diff PASS. MAIN integró sólo los cuatro archivos
congelados, verificando hashes; las 16 pruebas SDK pasaron al primer intento.

Evidencia ROOT: `/tmp/organizatech-coach-pending-controller.XPRyM4/`.
Sesión R2 96194 terminó exit 0, secuencialmente: invitaciones 170, pagos 84,
dominio 144, `npm test` completo, lint, build, typecheck y diff PASS. La primera
sesión 64610 terminó FAIL por el registro descrito arriba; `npm-test.log` conserva
ese resultado y `r2-*` conserva la ejecución corregida. Ninguna validación global
compitió con otro proceso de test, build o edición en ROOT.

Baseline 202 archivos; lote 11 (7 nuevos y 4 compartidos), total 209. Se preservan
198 archivos del baseline sin cambios, composition root, lockfile, cuatro SQL y
stash. Los compartidos son package/registro de dos tests, su hash contractual,
el contrato de migraciones de invitaciones y la allowlist exacta de Coach Portal.
La revisión independiente GPT-5.6 Sol medio se registra después de estos gates.

## Cierre de auditoría del incremento

GPT-5.6 Sol medio READ-ONLY: PASS, sin hallazgos HIGH/MEDIUM/LOW verificables.
Auditor ejecutó 170 focales y diff check; verificó los 11 hashes del delta,
6 protegidos, 14 logs y 198 archivos preservados. Gates globales y DOMAIN se
evaluaron como evidencia del implementador; no se presentaron como ejecución
propia ni se probaron SQL, Auth/PostgREST remoto, navegador o QA manual.

Informe: `/tmp/organizatech-coach-pending-controller.XPRyM4/sol-audit.md`.
Manifest auditado inmutable `ca4bbc19fa9423b07131691ec9275957b7c08de2928325ae692785622a2e4e7e`.
Después del PASS sólo se actualizan este documento y el del controller con su
estado de integración. Las nueve fuentes/config/tests auditadas quedan idénticas;
`post-audit-integrity.json` registra los hashes actuales de ambos documentos.
El cierre es parcial: no autoriza commit/push automático, montaje, QA o producción
ni declara terminados el resto de Coach o sus migraciones remotas.

Guía Supabase utilizada: sesión local no equivale a identidad verificada,
AbortSignal viaja hasta el fetch y los reintentos deben ser explícitos. Changelog
y referencias `auth-getsession`, `auth-getuser` y `using-modifiers-abortsignal`
consultadas el 2026-09-09. No se modificó la implementación ya auditada del SDK.
