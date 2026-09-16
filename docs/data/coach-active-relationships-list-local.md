# Vínculos activos propios — incremento SQL local

Alcance: una lectura paginada de identidad consentida del episodio activo. No crea
vínculos ni atribuye consentimiento; no expone bajas, historial, pagos, cuentas,
invitaciones, códigos ni actividad. No monta UI. `id` es el episodio, nunca el alumno.

## Inventario y prerequisitos

- `supabase/migrations/20260909100428_coach_active_relationships_list.sql`
- `supabase/tests/coach_active_relationships_list_local.sql`
- `supabase/tests/support/run_coach_active_relationships_list_postgres.mjs`
- Este documento.

Nombre generado con CLI Supabase 2.114.0 después de consultar `--version` y
`migration new --help`, usando `migration new coach_active_relationships_list`.
Sin link, push, despliegue ni SQL remoto. Requiere la migración de invitaciones R2
20260909044235, SHA-256
`0f72a10fc35fc4203aa65d11c4181206749a56be31302f891ce90afc00eec3fc`.
La copia antigua de DATA permanece intacta y NO se debe transferir a ROOT.
PostgreSQL 17+, UTF8 y la collation incorporada `pg_catalog.pg_c_utf8` son
obligatorios; la migración falla con 0A000 si faltan. No crea extensiones,
collations ni fallback de locale.
[PostgreSQL 17: collations](https://www.postgresql.org/docs/17/collation.html).

## Contrato

`public.list_own_active_coach_relationships(p_query text default '', p_limit integer
default 25, p_cursor_linked_at timestamptz default null, p_cursor_id uuid default null)`:

```text
{ serverNow, totalActive, matchingCount,
  items: [{ id, studentName, studentEmail, linkedAt }],
  nextCursor: { id, linkedAt } | null }
```

Sólo `coach_user_id = auth.uid()` y `ended_at IS NULL`; snapshots sin normalizar al
proyectarlos ni lookup de cuentas. La unicidad activa por alumno ya existe.
Invitación pendiente no equivale a vínculo. Total antes de query/cursor;
matchingCount después de query, antes de cursor. Orden DESC(linked_at,id),
límite 1..50, default25, fetch limit+1; cursor = último elemento devuelto.
Es límite de página, no de clientes. Cursor pareado, finito y años UTC 1..9999;
futuro, inexistente, ajeno o revocado sólo expresa posición, nunca un lookup.
Cada llamada tiene su snapshot: después de revocaciones la página puede quedar vacía.

Query no nulo, máximo 254 bytes UTF8 **antes** de normalizar: btrim ASCII space,
NFD, eliminar exclusivamente U+0300..U+036F, lowercase simple Unicode pg_c_utf8.
Substring literal nombre **OR** correo; %, _ y backslash no son wildcards.
Una coincidencia por ambos campos cuenta una sola vez. SQL es la autoridad:
el lowercase contextual JS difiere con sigma y no debe rechazar resultados.
Timestamps UTC con seis decimales. Un linked_at futuro finito permitido por el
DDL se conserva, sin exigir linkedAt <= serverNow. No se agregan constraints
para reparar fechas históricas: el adaptador debe rechazar respuestas con fechas
no representables, sin inventar valores ni esconder filas. Sin inspección de datos reales.

## Seguridad y coste

SECURITY DEFINER, search_path vacío, EXECUTE sólo authenticated. El helper privado
existente valida auth.uid/membership y toma lock **exclusivo** antes de serverNow,
igual que revocación. Sin auth/membership: 42501. Entradas inválidas del cuerpo:
22023 y mensaje fijo `coach_active_relationship_list_invalid_input`. Tipos SQL
malformados se rechazan antes del cuerpo; no mostrar sus errores crudos.
No acepta ownership, estado ni campos extra.

Una statement da counts e items desde el mismo snapshot post-lock. VOLATILE:
no modifica hechos, pero toma row locks y no funciona en transacción SQL READ ONLY.
Otro Coach no comparte ese lock. Sin cambios a funciones previas, tablas, grants
de tabla, policies, triggers ni índices; default-deny y FORCE RLS permanecen.
`coach_relationship_owner_page(coach_user_id, linked_at DESC, id DESC)` ya sirve al
seek/orden. Counts exactos y substring normalizado escanean candidatos activos propios;
no se promete coste constante. CTE de origen NOT MATERIALIZED; sólo hasta 51
candidatos y 50 objetos JSON, nunca una colección completa agregada.

## Evidencia reproducible

En DATA se lee R2 por ruta local explícita; el runner verifica su SHA antes del SQL:

```sh
node supabase/tests/support/run_coach_active_relationships_list_postgres.mjs \
  --invitation-migration /Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-01/supabase/migrations/20260909044235_coach_invitation_persistence.sql
```

En ROOT integrado se puede omitir el argumento. `--postgres-archive /ruta/postgres.jar`
reutiliza un jar público local sin descargar. El PostgreSQL17.5 macOS arm64 de Maven
se verifica con SHA `e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de`.
Sin override descarga sólo ese artefacto. Cluster mkdtemp privado, socket Unix sin
TCP, sin dotenv/conexión Supabase/Auth API. Episodios aceptados y usuarios son
fixtures administrativos sintéticos: evidencia de esquema, no QA de aceptación.
SQL contractual termina en ROLLBACK y verifica ausencia de sus fixtures.
Concurrencia vive sólo en el cluster efímero. Cleanup cierra conexiones, detiene
Postgres y elimina exactamente su directorio; no elimina un jar externo.
Sin imprimir SQL, identidades, snapshots o detail/context del servidor.

Resultado local: transacción SQL PASS y **26 checks runner PASS** en PG17.5.
ACL/RLS/grants/search_path, anon/null auth/no Coach, BOLA, snapshots iguales entre
Coaches, exclusión bajas/invitados, allowlists, datos intactos, 68 activos,
ties/microsegundos, páginas/counts, Unicode/literales, límites/tipos/cursor
incompleto/futuro/ajeno/revocado y snapshot futuro finito. Carreras reales en ambos
órdenes listado/revocación y retiro de membership, verificadas por espera de lock.
Node --check, ESLint focal y diff/whitespace también ejecutados; baseline42,
HEAD/branch y stash protegido conservados. Sin npm test global/build en DATA.

## Integración pendiente

MAIN registra **filename + SHA final** en el test dueño del inventario de migraciones
y la allowlist CoachPortal (package/registries reservados a MAIN). Después de
integrar SQL y hashes, debe ejecutar suite GLOBAL nuevamente; un gate anterior
a SQL no lo sustituye. Auditoría independiente Sol medium posterior, no realizada
por el implementador. QA/PROD y QA manual del dueño pendientes.

No requiere ni copia tablas de ciclo/versiones de CYCLE. Si ROOT no tiene ese
futuro backend, ciclo sigue **desconocido/no consultado**, no `cycle: null` ni cero
entrenamientos. Esa lectura/autorización requiere otro incremento. Tampoco se
habilitan aceptación, bajas/historial, pagos, correo, alerts ni UI.
