# Revisión estática — cadena Dashboard Coach y vínculos

Fecha: 2026-09-16. Base revisada: `3b1df2f3d023c729d62ff2b69b72a30ea5ed4b8e`.

## Veredicto

**PASS estático con bloqueos funcionales explícitos.** La cadena aplica default-deny,
ownership derivado de `auth.uid()`, RPCs con allowlists escalares, `SECURITY DEFINER`
con `search_path = ''` y grants limitados a `authenticated`. No se ejecutó SQL ni se
consultó QA/PROD. La aplicación en QA requiere autorización separada y verificación
del owner/BYPASSRLS efectivo de las funciones.

No es un flujo completo de alta y entrega: estas migraciones no incluyen aceptación
por el alumno ni dispatcher/outbox de correo. Una operación `reserved` no demuestra
aceptación del proveedor ni entrega al buzón.

## Orden, hashes y dependencias

| Orden | Migración | SHA-256 | Dependencias |
| --- | --- | --- | --- |
| 1 | `20260908201518_coach_dashboard_private_preferences.sql` | `1dcba62528dac569acaa18d84437cd3a965d5ebd4274f9cfef1d1d20f2ba2cee` | `auth.users`, `public.coach_registrations`, `auth.uid()` |
| 2 | `20260909044235_coach_invitation_persistence.sql` | `0f72a10fc35fc4203aa65d11c4181206749a56be31302f891ce90afc00eec3fc` | `auth.users`, `public.coach_registrations`, `public.user_registrations`, `gen_random_uuid()` |
| 3 | `20260909054933_coach_paid_period_persistence.sql` | `bd4f106772558062c856eb586e243c919adaaa4b1c7bf4e21bb5381674b79192` | tablas, FKs y `private.lock_coach_invitation_owner()` de la migración 2 |
| 4 | `20260909085022_coach_pending_invitations_list.sql` | `30190a102caf00fde6f687b9191f0f9ca1a1c5fd429e15e75dcebad08acc3590` | migración 2; PostgreSQL 17, UTF-8 y `pg_catalog.pg_c_utf8` |
| 5 | `20260909100428_coach_active_relationships_list.sql` | `0f46a48418e1fed82aadd9e47bd3c9da994c1c7f762004b371763ac2411a4085` | migración 2; PostgreSQL 17, UTF-8 y `pg_catalog.pg_c_utf8` |
| 6 | `20260909120120_coach_invitation_generation_binding.sql` | `dc8d07e9f1eb25b72b770e041a17e4d3a8367fb461d2ba666f7297434498c3de` | motor, tablas y operaciones de la migración 2 |

La restricción de un solo Coach activo por alumno se materializa en el índice único
parcial `coach_relationship_one_active_student` sobre `student_user_id` cuando
`ended_at is null`. La cadena no contiene el endpoint que crea ese episodio: su
transacción futura debe volver a validar identidad del alumno, consentimiento y el
mismo orden de locks.

## RLS, policies y `WITH CHECK`

| Tablas privadas | RLS | Policies | Acceso de cliente |
| --- | --- | --- | --- |
| preferencias e interés Chat | `ENABLE` + `FORCE` | ninguna | `REVOKE ALL` a `PUBLIC`, `anon`, `authenticated` |
| invitaciones, episodios y operaciones | `ENABLE` + `FORCE` | ninguna | `REVOKE ALL` a `PUBLIC`, `anon`, `authenticated` |
| registros, períodos y operaciones pagadas | `ENABLE` + `FORCE` | ninguna | `REVOKE ALL` a `PUBLIC`, `anon`, `authenticated` |

No existe `WITH CHECK` porque deliberadamente no existen policies ni grants de tabla:
el resultado es default-deny y todo acceso pasa por RPCs estrechos. Agregar una policy
para “facilitar” acceso desde el frontend debilitaría este diseño y requiere otra
revisión. En QA se debe confirmar que ningún default privilege posterior otorgue
acceso directo al schema/tablas privadas.

## Ownership, BOLA/IDOR y writes

- Preferencias: `private.require_coach_dashboard_owner()` deriva `auth.uid()`, exige
  membresía Coach real y bloquea esa membresía antes de leer/escribir por
  `coach_user_id = v_owner`.
- Invitaciones/relaciones: `private.lock_coach_invitation_owner()` deriva el mismo
  owner y todos los recursos se seleccionan por id **y** `coach_user_id = v_owner`.
- Períodos pagados: la FK compuesta enlaza `episode_id + coach_user_id`; lectura y
  writes vuelven a filtrar ambos valores y rechazan episodios finalizados.
- Ningún RPC público acepta `user_id`, `owner_id`, `coach_user_id`, `student_user_id`,
  código, state ni payload libre. Los writes aceptan sólo correo/ids/fechas/versiones
  y request ids de la operación concreta.
- La desvinculación conserva el episodio y snapshots, sólo fija `ended_at`; no borra
  historial ni concede permisos de entrenamiento.
- Invitaciones pendientes y pagos pendientes permanecen modelos separados. Los
  agregados de invitaciones no se convierten en cobros ni deuda.

## `SECURITY DEFINER`, `search_path` y grants

- Todos los entrypoints públicos son `SECURITY DEFINER` y declaran
  `set search_path = ''`; sus referencias internas sensibles están calificadas por
  schema o se resuelven en `pg_catalog`.
- Los helpers privados son `SECURITY INVOKER`, no tienen EXECUTE para roles de
  cliente y sólo se alcanzan desde wrappers controlados.
- Cada función revoca EXECUTE a `PUBLIC`, `anon` y `authenticated`; sólo los RPCs
  públicos exactos recuperan EXECUTE para `authenticated`. `anon` no recibe RPCs.
- Los listados y reads también validan membresía Coach; no son oráculos de UUIDs de
  otros owners. Cursores son posiciones y no autorizaciones.
- Con `FORCE RLS` y cero policies, el funcionamiento depende de que el owner efectivo
  de las funciones tenga el bypass previsto por la plataforma. Antes de QA se debe
  inspeccionar `pg_proc.proowner`, `prosecdef`, `proconfig`, `pg_roles.rolbypassrls`
  y ACLs; si el owner no puede atravesar RLS, el resultado esperado es fail-closed.

## Riesgos y gates pendientes

1. **Bloqueo de producto:** no hay endpoint de aceptación/consentimiento del alumno;
   por tanto esta cadena no crea vínculos activos nuevos. No se inventa la pantalla
   de ingreso de código.
2. **Bloqueo de entrega:** crear, reenviar o regenerar registra una reserva y un
   código, pero no acredita correo enviado. La UI debe mostrar esa incertidumbre y
   no producir un receipt `provider-accepted`/`delivered` ficticio.
3. **Compatibilidad legacy:** los RPCs v1 de reenvío/regeneración siguen presentes.
   El runtime integrado usa sólo los RPCs generation-bound v2; retirar o revocar v1
   requiere autorización separada y prueba de consumidores.
4. **Concurrencia/costo:** lecturas y writes serializan por fila de membresía Coach.
   Es coherente con ownership y orden de locks, pero requiere medición en QA con una
   cartera representativa.
5. **QA de seguridad:** verificar ACLs, ausencia de policies inesperadas, un Coach
   contra recursos ajenos, concurrencia de aceptación futura y unicidad de Coach
   activo, todo en transacción con rollback cuando corresponda.

No se aplicaron migraciones, no se ejecutó DDL/DML remoto y no se modificaron QA,
PROD ni variables de entorno.
