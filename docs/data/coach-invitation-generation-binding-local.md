# Vinculación de acciones a la generación de invitación

Incremento local aditivo. No autoriza ejecución en QA/PROD, correo, aceptación,
UI ni cambios de entrenamiento. `reserved` significa reserva persistida, nunca
envío confirmado. La auditoría independiente y los gates de integración de ROOT
son posteriores; este documento no declara QA PASS.

## Inventario y dependencia

- Migración: `supabase/migrations/20260909120120_coach_invitation_generation_binding.sql`.
- SQL transaccional: `supabase/tests/coach_invitation_generation_local.sql`.
- Runner: `supabase/tests/support/run_coach_invitation_generation_postgres.mjs`.
- Este documento.

La versión fue generada localmente por `supabase migration new
coach_invitation_generation_binding`, tras consultar `migration new --help`
con CLI 2.114.0. Requiere invitaciones R2
`20260909044235_coach_invitation_persistence.sql`, SHA-256
`0f72a10fc35fc4203aa65d11c4181206749a56be31302f891ce90afc00eec3fc`.
La copia histórica de DATA no es esa dependencia y no se modifica. El runner
admite una ruta absoluta explícita y rechaza cualquier otro hash antes de SQL.

No crea tablas, índices, triggers, policies, extensiones ni roles; no cambia
funciones, ACL o filas preexistentes durante el DDL. Conserva FORCE RLS y denegación
por defecto. Crea sólo tres RPC públicas y dos helpers privados sin EXECUTE para
PUBLIC/anon/authenticated. Las RPC son SECURITY DEFINER, con search_path vacío y
EXECUTE exclusivamente authenticated; los helpers son SECURITY INVOKER.

## Contrato exacto

- `resend_own_coach_invitation_for_generation(p_invitation_id uuid, p_expected_generation integer, p_request_id uuid)`.
- `regenerate_own_coach_invitation_for_generation(p_invitation_id uuid, p_expected_generation integer, p_request_id uuid)`.
- `read_own_coach_invitation_generation_operation(p_request_id uuid)`.

Sin overloads, defaults ni entrada de ownership/código/correo/estado. Generación
esperada entre 1 y 2147483647. Reenviar MAX es válido; regenerar MAX se rechaza
sin overflow. La última regeneración representable es MAX-1 → MAX.

Los comandos retornan exactamente:

    {status:"recorded", serverNow, operation}
    {status:"rate_limited", serverNow, retryAt}

`operation` y la lectura contienen exactamente siete campos:

    {requestId, action, state, invitationId, expectedGeneration, generation, reservedAt}

`action` es resend/regenerate, `state` reserved/cancelled. Reenvío mantiene
generation=expectedGeneration; regeneración usa expectedGeneration+1. Se conservan
las representaciones timestamptz de R2 y se exige tiempo finito/años UTC 1–9999
al proyectar el recibo. No se incluye episodeId, código, correo, ownership ni
payload. Lectura propia ausente retorna null; un recibo legacy/incompatible
produce conflicto, no se adopta como intención nueva ni se confunde con ausencia.

Helpers nuevos:
`private.mutate_coach_invitation_for_generation(text,uuid,integer,uuid)` y
`private.coach_invitation_generation_operation_view(uuid,uuid)`.

## Transacción, replay y cuotas

Cada entrada comprueba auth.uid() y membresía Coach actual con el mismo lock
exclusivo de R2; reloj después del lock. Orden: membresía → invitación →
operaciones, sin upgrade de locks. El replay propio hace sólo SELECT de operación,
sin bloquearla antes de la invitación. Compara acción y payload exacto
`{invitationId,expectedGeneration,contractVersion:1}` antes de mirar estado o
generación actual. Un replay exacto cancelado sólo reconcilia ese recibo.

Sin operación previa, bloquea invitación propia, compara expectedGeneration y
llama al motor R2 intacto. Únicamente vincula la operación recién creada en la
misma transacción: exige owner/request/acción/id/generación/state reserved y payload
legacy exacto. Rowcount distinto de uno o payload retornado distinto provoca
40001 y rollback de código, generación, cancelaciones previas y cuota.
Nunca transforma un recibo previamente persistido.

Se mantienen 7 días, creación/regeneración 10/h y 50/24h por Coach; reenvío
3/24h por invitación y al menos 60 segundos, sin extender expiry. Rate limit no
persiste operación. Un retry explícito con generación antigua debe fallar si
otra acción ya la cambió. RequestId lo provee el caller; no hay reintentos,
regeneración ni reenvío automáticos. Las RPC legacy siguen intactas e incompatibles
con replay del payload nuevo; su existencia no se presenta como protección
generacional de clientes que continúen usando el contrato antiguo.

Errores de dominio fijos, sin detalles sensibles:

| SQLSTATE | Mensaje |
| --- | --- |
| 42501 | coach_invitation_forbidden |
| P0002 | coach_invitation_not_found |
| 22023 | coach_invitation_invalid_input |
| 22023 | coach_invitation_request_conflict |
| 22023 | coach_invitation_operation_contract_conflict |
| 55000 | coach_invitation_generation_conflict |
| 55000 | coach_invitation_generation_exhausted |
| 55000 | coach_invitation_state_conflict (R2) |
| 40001 | coach_invitation_retry_required |

Errores de tipos UUID/integer ocurren antes del cuerpo SQL y deben sanitizarse
en el adaptador. 40001 es incertidumbre/reintento técnico, no conflicto de versión
de preferencias. La reconciliación usa el mismo requestId y la misma intención.

## Evidencia local y ejecución reproducible

El SQL corre en transacción terminada en ROLLBACK. Cubre ACL/RLS/ownership,
allowlists, inputs, recibos malformados, separación legacy/versionada, estado,
MAX, código/expiry, cuotas compartidas y fallos de binding inyectados con trigger
sintético temporal. El runner verifica que los fixtures, grants y trigger se
reviertan y que el catálogo de objetos anteriores no cambie.

Las pruebas con conexiones independientes observan espera real de lock:
mismo request, distintos requests con misma generación, lectura durante binding,
legacy versus nuevo en ambos órdenes, cancelación en ambos órdenes, rollback
explícito, namespace de request por Coach y eliminación de membresía actual.
No crean vínculo, consentimiento, pagos ni actividad de entrenamiento.

Requiere macOS arm64, Node y dependencia pg existente; PostgreSQL 17.5 se extrae
del JAR público cacheado y pinneado SHA-256
`e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de`.
No descarga binarios ni lee valores de entorno/credenciales. Cluster y socket
privados en mkdtemp, puerto 55447, listen_addresses vacío; sin TCP. El runner
detiene y elimina únicamente su directorio temporal exacto incluso al fallar,
sin borrar el archivo JAR externo. Logs sólo de checks/errores sanitizados.

Desde DATA, con el archivo cacheado existente:

    node supabase/tests/support/run_coach_invitation_generation_postgres.mjs \
      --invitation-migration /Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-01/supabase/migrations/20260909044235_coach_invitation_persistence.sql \
      --postgres-archive /tmp/org-coach-active-list-binary.U3hhYM/postgres.jar

En ROOT integrado puede omitirse --invitation-migration únicamente si su copia
local coincide con el hash R2. La ruta cacheada es evidencia local, no un recurso
garantizado en otros equipos; no hay fallback silencioso de versión/binario.

MAIN debe registrar filename/hash y contrato de RPC en sus registries/allowlists,
integrar adaptador y ejecutar los gates globales después de integrar este SQL.
Este lote no modifica package, registries, TypeScript ni SQL cerrados. No ejecuta
global npm test/build ni auditoría. No existe autorización para aplicar DDL remoto
o escribir el ledger de migraciones; el mecanismo de preservación de versiones
remotas sigue siendo una decisión externa a este incremento.
