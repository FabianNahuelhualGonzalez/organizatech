# Coach: persistencia local de invitaciones y episodios

Estado: **PASS local integrado y auditoría independiente GPT-5.6 Sol medio R2**.
No representa QA remoto, envío de correo, aceptación del alumno ni despliegue.
Base aprobada: `00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`.
Acuerdos del dueño de producto del 9 de septiembre de 2026 sustituyen las
preguntas históricas del contrato de persistencia. Alcance: SQL local solamente.

## Inventario exclusivo de este incremento

- `supabase/migrations/20260909044235_coach_invitation_persistence.sql`
- `supabase/tests/coach_invitations_local.sql`
- `supabase/tests/support/run_coach_invitations_postgres.mjs`
- `docs/data/coach-invitations-local.md`
- `src/features/coach-dashboard/data/coach-invitations-migration.test.ts`

El quinto archivo fue autorizado después de detectar el gate de ownership
histórico. SHA-256 de la migración congelada, registrado en ese contrato:
`0f72a10fc35fc4203aa65d11c4181206749a56be31302f891ce90afc00eec3fc`.

Este hash incluye la corrección local ROOT del hallazgo R1 de GPT-5.6 Sol medio.
El patch original DATA y sus hashes anteriores se conservan como evidencia histórica.

La migración se creó con `supabase migration new coach_invitation_persistence`
(CLI local 2.114.0); no se usó link, push, SQL remoto ni configuración de entorno.
Los archivos de preferencias previos y los demás cambios del entorno no forman
parte de este incremento. Stash protegido `7e618d67efb4290082a4f6be258c1f75640856c8` intacto.

## Autoridad y seguridad

Tres tablas privadas, todas con ENABLE/FORCE RLS sin policies (default deny),
sin grants directos a PUBLIC, anon o authenticated. Los únicos grants nuevos a
authenticated son EXECUTE de ocho RPCs con argumentos allowlisted. Cada RPC
deriva el actor de `auth.uid()` y exige membresía actual en `coach_registrations`.
No se confía en metadata del usuario, email profesional ni ownership enviado.

Los wrappers SECURITY DEFINER públicos son la frontera RPC requerida para
acceder a tablas privadas. Toda autorización y mutación está en helpers privados
SECURITY INVOKER no ejecutables por clientes; todos fijan `search_path = ''`.
No se cambia el ACL de schemas compartidos, defaults ni tablas anteriores.

Invitar no consulta cuentas globales por email, no descubre otro Coach y no crea
vínculos. No hay aceptación, validación de código pública ni lectura de perfiles
globales. No se modifica ninguna tabla, policy o RPC de entrenamiento o storage.

## RPCs y resultados

| RPC pública | Argumentos de cliente | Resultado |
| --- | --- | --- |
| `create_own_coach_invitation` | `p_recipient_email`, `p_request_id` | Reserva propia; ID de invitación |
| `resend_own_coach_invitation` | `p_invitation_id`, `p_request_id` | Nueva reserva limitada; mismo código/expiry |
| `regenerate_own_coach_invitation` | `p_invitation_id`, `p_request_id` | Sólo vencida; nueva generación y vigencia |
| `cancel_own_coach_invitation` | `p_invitation_id`, `p_request_id` | Cancela invitación pendiente y reservas |
| `revoke_own_coach_relationship` | `p_episode_id`, `p_request_id` | Cierra episodio propio activo |
| `read_own_coach_invitation` | `p_invitation_id` | Detalle propio; código sólo pendiente vigente |
| `read_own_coach_invitation_operation` | `p_request_id` | Reconcilia operación propia; null si no consta |
| `read_own_coach_relationship` | `p_episode_id` | Snapshot propio de nombre/email y fechas |

Una mutación registrada devuelve `{status: 'recorded', serverNow, operation}`.
`operation` contiene sólo requestId, action, state, invitationId o episodeId,
generation y reservedAt. No contiene código, payload, ownership ni datos de pago.
Para recuperar código se usa el read propio de invitación después de confirmar
la operación. El read de operación no sustituye al read del estado de invitación:
una reserva histórica puede seguir registrada aunque la invitación haya vencido.

Una cuota agotada devuelve `{status: 'rate_limited', serverNow, retryAt}` sin
crear operación ni mutar invitación. retryAt procede del reloj y las reservas
del servidor, no de un tiempo ficticio del cliente.

SQLSTATEs de negocio: `42501` no autorizado; `22023` input inválido o requestId
reutilizado para otro payload/acción; `P0002` objeto inexistente o ajeno (idéntico
resultado); `55000` estado incompatible; `40001` reintento técnico necesario.
Errores nunca interpolan código/email/identidad. No hay RAISE LOG/NOTICE ni
telemetría de resultados. Cualquier integración debe mapear errores sanitizados.

## Código, tiempo, cuotas e idempotencia

- Código generado sólo en Postgres: LLd-LLd-LLd, letras
  `ABCDEFGHJKLMNPQRSTUVWXYZ`, dígitos `23456789`.
- Se usa el primer byte aleatorio de `pg_catalog.gen_random_uuid()`; no incluye
  bits fijos de versión/variante. Postgres 17 usa `pg_strong_random`. Muestreo con
  rechazo para letras evita sesgo de módulo. Un índice único resuelve colisiones;
  hasta ocho intentos, error final genérico sin exponer DETAIL del código.
- El material recuperable queda únicamente en la fila privada de invitación;
  no se duplica en el ledger de operaciones. No se añade cifrado con claves
  privadas ni dependencias externas. Logs de infraestructura/respuestas deben
  excluir códigos antes de una futura integración; no se alteraron settings remotos.
- Vigencia exacta de 168 horas desde issuedAt del servidor. En el instante
  `expiresAt <= now` el estado proyectado es expired y code es null.
- Creación: 10 por hora móvil y 50 por 24 horas móviles por Coach. Regeneración
  consume el mismo presupuesto; cancelar no devuelve cuota.
- Reenvío: 3 por invitación en 24 horas móviles, intervalo mínimo de 60 segundos
  desde emisión o último reenvío. No cambia código/expiry y no devuelve cuota por
  fallo hipotético. La regeneración tampoco limpia el historial del presupuesto.
- Regenerar sólo es explícito tras vencimiento: generación incrementada, código
  diferente, nuevas 168 horas, reservas anteriores invalidadas. Cancelar también
  borra el código y cancela reservas pendientes. No hay envío automático.
- Todas las llamadas toman un lock FOR UPDATE exclusivo de la membresía Coach
  desde el inicio. Orden: membresía -> invitación/episodio -> operaciones.
  No hay upgrade de KEY SHARE a UPDATE. El reloj se toma después del lock.
- La creación vuelve a comprobar correo ya activo o pendiente sólo en la cartera
  del Coach autenticado, después del replay y antes de cuota/INSERT. Los rechazos
  usan SQLSTATE 55000 y mensajes fijos sin email ni código; no reservan cuota.
  Índices owner-first cubren ambas consultas; índice único parcial impide dos
  invitaciones pending del mismo Coach/correo. Expiradas siguen pending en storage
  y requieren regeneración explícita. Canceladas e inactivas permiten invitar de
  nuevo; otro Coach puede invitar al mismo correo sin descubrir cuentas globales.
- `(coach_user_id, request_id)` es único; el replay compara acción y payload
  normalizado antes de mutar. Reusar la clave con otro payload falla. Releer/repetir
  la misma clave tras timeout no duplica reserva ni revive una cancelación.
- La segunda revocación con la misma clave devuelve su operación; otra clave
  sobre un episodio ya cerrado falla sin añadir operaciones indefinidamente.

No hay límite de alumnos ni una política comercial adicional. El lock por Coach
serializa también lecturas puntuales: es simple y conserva la autorización contra
baja concurrente de membresía, pero su contención requiere medición en QA.

## Episodios: únicamente esquema y revocación

Cada episodio exige consentimiento/fecha de inicio iguales, invitación propia,
membresía Usuario y snapshot acotado de nombre/email. Un índice único parcial
sobre alumno WHERE ended_at IS NULL impide dos Coaches activos. El frontend no
tiene INSERT/UPDATE ni RPC que pueda atribuir consentimiento o crear episodio.

Revocar sólo fija endedAt del episodio propio y preserva snapshot y fechas.
Una relación futura requiere otra invitación y un nuevo episodio con consentimiento;
no reactiva el histórico. La futura aceptación debe verificar actor/destinatario,
tomar los mismos locks y comprobar unicidad en una transacción; todavía no existe.

La baja comercial no borra datos. La eliminación administrativa de cuenta o de
membresía Usuario canónica es otra operación: FKs en cascada evitan bloquear el
flujo Auth existente y eliminan episodios/operaciones dependientes, no entrenamientos.
No se añade endpoint de borrado ni se ejecuta borrado real de cuentas.

## Pruebas locales y límites

Comando reproducible en macOS arm64:

```sh
node supabase/tests/support/run_coach_invitations_postgres.mjs
```

El runner reutiliza el artifact PostgreSQL 17.5 con SHA-256 fijado del soporte
existente. Descarga sólo el binario público; crea un directorio temporal 0700 y
un socket Unix privado sin listener TCP. Descarta defaults PG* heredados, no carga
.env ni URLs remotas, y elimina exclusivamente su cluster temporal al terminar.
No imprime parámetros, código, SQL ni DETAIL del servidor, incluso al fallar.

Bootstrap reducido: cuatro usuarios sintéticos, migraciones reales de Coach y
Usuario, columnas mínimas de profiles para el backfill, y esta migración. No es
una reproducción completa de Supabase/Auth/PostgREST ni de su configuración remota.

`coach_invitations_local.sql` ejecuta pruebas en BEGIN/ROLLBACK: ACLs, FORCE RLS,
helpers bloqueados, anon/sin identidad/sin Coach, BOLA, allowlist, email, formato,
expiry exacto, cooldown, tres reenvíos/24h, retry/payload, regeneración, cancelación,
reservas vs envío, snapshots, unicidad activa, cascadas de cuentas sintéticas
y colisión de código forzada con error/DETAIL sanitizados.
Grants temporales adicionales comprueban que RLS sigue default-deny por sí mismo.

El runner añade 40 comprobaciones, incluidas carreras reales de requestId/payload,
10/hora, 50/24h, regenerate vs regenerate, resend vs resend, cancel vs resend y
baja de membresía concurrente. Las pruebas de episodios usan fixtures admin;
no equivalen a QA de aceptación ni comprueban acceso compartido a entrenamientos.

La ronda R1 del auditor reprodujo dos invitaciones propias para el mismo correo
con requestIds distintos. Regresiones nuevas cubren rechazo pendiente/activo,
normalización de correo, expiración, reinvitación tras cancelar/desvincular y
carrera entre dos requestIds sin doble reserva de cuota. La nueva prueba SQL
falló antes de corregir la función; los gates integrados y auditoría R2 ya pasaron.

Validaciones históricas ejecutadas en el entorno DATA antes de integrar:

- PASS: SQL transaccional y runner PostgreSQL local.
- PASS: `npm run typecheck`, `npm run build`, `npm run lint`, `git diff --check`.
- PASS: `npm run test:coach-dashboard-preferences` (23 pruebas).
- PASS: focal propio `coach-invitations-migration.test.ts` (4 pruebas).
- FAIL en la ejecución inicial: `npm test` se detiene en pretest, contrato
  `src/lib/server/perf-06-history-reconciliation-contract.test.ts`, porque falta
  registrar ownership/hash de la nueva migración en un test fuente propio.
  Se añadió después el contrato propio autorizado. El registro package sigue
  reservado al integrador; no debe declararse PASS general de la suite.
- FAIL confirmado al ejecutar de nuevo el contrato histórico directamente:
  registro global de tests `193 !== 194`, por el focal nuevo todavía no incluido
  en package.json. El ownership/hash ya supera su comprobación previa.

Contrato propio añadido siguiendo el metadata de preferencias. Focal disponible:

```sh
./node_modules/.bin/tsx --test src/features/coach-dashboard/data/coach-invitations-migration.test.ts
```

Integración ROOT completada: focal registrado una sola vez en
`test:coach-dashboard-invitations`, encadenado al gate general. El runner
PostgreSQL se ejecutó aparte (macOS arm64). PERF-06 no se debilitó.
Lote18 integrado: invitaciones30 y DOMAIN130, SQL transaccional+40checks,
npmtest pre/main/post, lint/build/typecheck/diff PASS. Evidencia:
`/tmp/organizatech-coach-invitations-integrated.GOScwN/`.
Auditor GPT-5.6 Sol medio R2 confirmó cierre del MEDIUM y ejecutó focal49/49;
inspeccionó, pero no reejecutó, SQL y gates completos. Ver `sol-audit-r2.md`.

Todavía faltan validación completa de migraciones/advisors
contra un entorno QA autorizado, PostgREST/Auth real y captura productiva de sesión,
paginación/listado de cartera (este lote sólo expone reads por ID), proveedor/outbox
con workers y permisos específicos, UI de aceptación y QA manual del dueño.
No hay estado provider_accepted/delivered implementado: **reserved no es enviado**.

El PASS local de este lote no es PASS del Coach completo ni autoriza despliegue.
El inventario final para commit del dueño requiere cerrar los demás lotes. Ningún commit, push,
navegador, prueba manual de producto ni cambio remoto se ejecutó en este lote.

## Referencias verificadas

Las guías Supabase/Postgres guiaron el cierre explícito de grants, el default-deny
RLS, los índices de cuota/FKs y el orden exclusivo de locks.

- [Supabase RLS y grants](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [Supabase database functions](https://supabase.com/docs/guides/database/functions).
- [Cambio de exposición Data API, abril 2026](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
- [Postgres 17 UUID functions](https://www.postgresql.org/docs/17/functions-uuid.html).
- [Implementación Postgres 17 de gen_random_uuid](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/adt/uuid.c).
