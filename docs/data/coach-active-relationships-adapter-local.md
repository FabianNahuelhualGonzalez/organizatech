# Clientes activos — adaptador de lectura aislado

## Alcance

Implementación local del contrato `list_own_active_coach_relationships`.
No monta UI, no modifica pagos, no consulta entrenamientos y no implementa
aceptación del alumno, que sigue siendo un flujo separado pendiente.
Una fila representa un episodio de vinculación activo; su `id` no es el id
del alumno. El servidor comprueba Coach vigente y ownership en cada lectura.

## Contrato y responsabilidades

- Query explícita `{query, limit, cursor}`; texto crudo hasta 254 bytes UTF-8,
  sin NUL ni surrogates aislados; límite técnico 1..50, sin default oculto.
- Cursor `{linkedAt,id}` por posición descendente, no token de autorización.
  Precisión de microsegundos (seis decimales) y rango UTC de años 1..9999.
- Respuesta exacta `{serverNow,totalActive,matchingCount,items,nextCursor}`.
  Cada fila contiene sólo `{id,studentName,studentEmail,linkedAt}`.
- `totalActive` es global propio; `matchingCount` es anterior al cursor.
  La primera página valida cantidad y continuación; posteriores pueden quedar
  vacías tras una desvinculación. Las páginas no congelan toda la cartera.
- Los snapshots de nombre/correo conservan exactamente el contrato SQL y el
  validador de detalle existente. No se los normaliza como una invitación nueva,
  ni se buscan perfiles globales ni se usan como nueva prueba de identidad.
- Un `linkedAt` futuro finito permitido por el esquema sigue siendo un snapshot;
  no se agrega en frontend una constraint `linkedAt <= serverNow` inexistente.
- SQL resuelve búsqueda literal por nombre o correo. No se refiltra en JS:
  su lowercase contextual difiere del simple mapping de PostgreSQL `pg_c_utf8`.
- Datos inmutables por allowlist; reject de campos extra, ownership, códigos,
  fechas inválidas, getters, páginas excesivas, duplicados y orden incorrecto.
  No se agrega `cycle:null`, actividad cero o porcentajes ficticios.

## Transporte

Módulos pequeños en `src/features/coach-clients/data/`:
contrato, validación, repositorio y composición SDK; tres suites propias.
Reutilizan infraestructura explícita de Coach: verificación `getUser` del
mismo token capturado por `getSession`, generación de sesión, deadline total
Auth + RPC, configuración pública suministrada por el futuro owner y cliente
SDK fijado al token. No leen `.env`, storage ni secretos.

Cada llamada emite una sola RPC POST, cuatro parámetros allowlisted, abortSignal,
GET/HEAD deshabilitados y `.retry(false)` mediante el puerto ya auditado.
Timeout por defecto 8 s, configurable entre 1 ms y 30 s. Cancelación/timeout
impiden dispatch tardío tras Auth y descartan resultados tardíos de transportes
que ignoran abort. Se revalida contexto antes/después de RPC y del mapeo.
Errores SQL 42501/22023 se convierten en códigos fijos; el resto nunca se
interpreta como cartera vacía ni expone mensajes privados.

El consumidor futuro deberá invalidar el estado al cambiar cuenta, portal o
membresía y al conocer una desvinculación; este repositorio no mantiene caché
ni pretende detectar instantáneamente cambios remotos después de una respuesta.
La conexión al composition root, controlador y progreso real siguen pendientes.

## Validación y límites

Pruebas locales deterministas, SDK real con Auth/fetch sintéticos y PostgreSQL
aislado: no equivalen a autenticación real, PostgREST desplegado o QA manual.
Evidencia en `/tmp/organizatech-coach-active-list.9KhTBT/`.
Validación integrada: PASS. SQL transaccional + 26 comprobaciones PostgreSQL17.5;
206 tests de invitaciones/relaciones (35 nuevos del adaptador y uno de registro
de migración), 84 de pagos y 144 de dominio. `npm test` completo con pre/posttests,
lint, build, typecheck y diff PASS, en secuencia y **después** de integrar SQL
y sus dos registros de inventario. Auditoría independiente GPT-5.6 Sol, exigencia
media, READ-ONLY: PASS sin hallazgos HIGH/MEDIUM/LOW verificables en ROOT16.
El auditor ejecutó focal206/diff y verificó hashes e inventarios; SQL/globales
fueron revisados como evidencia del implementador, no ejecutados por el auditor.
Informe y manifest inmutable en la carpeta de evidencia. Después de la auditoría
sólo este documento se actualizó; quince archivos auditados permanecen intactos.

La migración nueva requiere inventario/autorización exactos para QA; no se
ejecutó SQL remoto, no hay commit/push, Preview nuevo ni cambios en producción.
No se reemplaza ningún SQL previo. El inventario global se actualizó con el
hash congelado antes de correr `npm test`, incluidos sus pre/posttests.

Documentación consultada: Supabase changelog, RPC, abortSignal y getSession;
el cambio de retries se evita explícitamente con POST y retry(false).
Las recomendaciones de Supabase se aplicaron a ownership, RLS/grants, límites
y separación entre snapshots, autorización y transporte.
