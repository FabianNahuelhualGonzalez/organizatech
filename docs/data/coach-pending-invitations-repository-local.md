# Listado de invitaciones pendientes — lectura aislada

Estado: código, SQL integrado y auditoría independiente GPT-5.6 Sol medio PASS local.
No es un PASS de QA ni un listado visible montado.

## Alcance autorizado

Fuente del tab Pendientes del handoff de vinculación: invitaciones todavía no
aceptadas, incluyendo vencidas que requieren regeneración explícita. No son pagos
pendientes. Canceladas y aceptadas no pertenecen a este listado. El incremento no
decide cómo agrupar alumnos que se desvinculan y vuelven, ni crea aceptación Alumno.

`list_own_pending_coach_invitations` devuelve `serverNow`, `totalPending`,
`matchingCount`, `items` y `nextCursor`. Cada fila sólo contiene ID de invitación,
correo previamente introducido por su Coach, estado pendiente/vencido y fechas
creación/emisión/vencimiento. No códigos, nombres, ownership, perfiles ni actividad.

Paginación técnica de 25 por defecto en SQL, configurable entre 1 y 50. No es un
límite de alumnos. Orden estable por creación DESC y UUID DESC, incluyendo la
precisión de microsegundos. El cursor es una posición, no un permiso ni snapshot
de cartera. Un ancla cancelada no impide seguir consultando. Cada página es una
lectura vigente; cancelaciones/altas entre llamadas pueden cambiar los totales.

La búsqueda es substring literal del correo propio, sin comodines `%`/`_`, con
normalización NFD, eliminación de marcas U+0300–U+036F, minúsculas y recorte de
espacios ASCII. Longitud máxima de entrada: 254 bytes UTF-8. No consulta cuentas
globales por correo. Los conteos se calculan antes de limitar la página: total
pendientes y coincidencias del filtro son conceptos distintos.

SQL es la autoridad del matching Unicode simple de PostgreSQL17, no el casing
contextual de JavaScript (por ejemplo sigma griega final). El mapper no vuelve a
filtrar las filas recibidas usando una segunda normalización divergente.

## Boundaries y transporte

- `coach-pending-invitations-contract.ts`: DTO mínimo, petición/cursor y puerto.
- `coach-pending-invitations-validation.ts`: allowlist, copias inmutables, tipos,
  fechas, conteos, orden, coherencia de cursor y ausencia de campos sensibles.
- `coach-pending-invitations-repository.ts`: una lectura con deadline total,
  verificación de identidad/generación y errores sanitizados. No cache ni retries.
- `supabase-coach-pending-invitations-repository.ts`: SDK real con principal
  existente verificado y token capturado. Configuración sólo pública, sin I/O de
  env, storage ni Auth adicional del cliente creado. POST, abortSignal, retry(false).

Reutiliza captura/deadline/errores de invitaciones ya auditados. El puerto SDK
compartido amplía únicamente su tipo de argumentos a string/number/null, para
transportar el límite numérico y cursores nulos; las allowlists de las ocho RPC de
invitaciones y las de períodos pagados no se amplían.

Una respuesta inválida, ausencia de permiso o timeout se rechaza: nunca representa
una cartera vacía. El estado vencido se contrasta con la hora del servidor, no con
el reloj del teléfono. Una página no acredita envío de correo ni consentimiento.

## Integración futura

No monta Card, Button, Section, Modal, Drawer ni textos; ninguna pantalla importa
esta nueva fuente. El controller consumidor deberá cancelar cambios de búsqueda,
descartar respuestas de selecciones anteriores y reiniciar páginas tras cancelar,
regenerar o crear invitaciones. Un cambio remoto no borra por arte de magia lo ya
recibido: la fuente no promete revocación instantánea de memoria del navegador.

No se modifica la carpeta principal, stash, root, lockfile, entrenamiento ni SQL
anterior. Migración nueva se valida localmente y requiere inventario/autorización
remotos propios: no pertenece al inventario QA de tres migraciones ya pendiente.

## Verificación local

32 pruebas focales iniciales PASS. Typecheck inicial detectó un tipo unknown para
state, corregido usando el discriminante ya validado; segunda pasada PASS.
120 pruebas de invitaciones, 84 de pagos y 144 de dominio PASS. Suite npm test
completa (pre/main/post), lint, build, typecheck y diff PASS, sesión92896. Luego
se integraron exactamente los cuatro archivos SQL/test/runner/doc congelados de
DATA por SHA; no cambió ningún archivo TypeScript/config validado. El runner
ejecutado nuevamente en ROOT pasó transacción SQL/rollback y 21 checks PostgreSQL.
Se repiten lint/typecheck/diff después de esa integración, sin concurrencia con
la suite global: ambas pasadas exit0. Auditoría GPT-5.6 Sol medio READ-ONLY PASS,
sin hallazgos HIGH/MEDIUM/LOW verificables. Auditor ejecutó120focal+diff y verificó
15hashes,5protegidos,14logs; SQL y gates globales sólo por evidencia congelada.
Informe: `sol-audit.md` en el directorio indicado a continuación. No se cambió
ninguna fuente de código/SQL después de la auditoría; sólo documentos de estado.
Evidencias del incremento:
`/tmp/organizatech-coach-pending-list.erJX9K/`.

Las guías Supabase/Postgres orientan permisos por función/owner, search_path vacío,
paginación keyset y reutilización de índices. Changelog consultado 09-09: no se
cambian versiones de SDK, Node, extensiones ni configuración del proyecto.
Documentación: [Funciones](https://supabase.com/docs/guides/database/functions),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
