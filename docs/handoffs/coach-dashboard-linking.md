# Handoff — Panel Coach y vinculación

## Veredicto

**REQUIERE MÁS TRABAJO.** El código está preservado, pero todavía no está listo para commit, migraciones QA ni QA manual.

## Entornos preservados

Todos parten de `00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`:

| Worktree | Branch | Pendientes verificados |
| --- | --- | ---: |
| `/Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-01` | `codex/coach-dashboard-01` | 247: 5 modificados, 242 nuevos |
| `/Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-domain-01` | `codex/coach-dashboard-domain-01` | 51: 2 modificados, 49 nuevos |
| `/Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-data-01` | `codex/coach-dashboard-data-01` | 50: 3 modificados, 47 nuevos |
| `/Users/fabiannahuelhual/Developer/organizatech-coach-dashboard-ui-01` | `codex/coach-dashboard-ui-01` | 95: 4 modificados, 91 nuevos |

No copiar carpetas completas ni sobrescribir un worktree con otro. Integrar archivos concretos y revisar sus diffs.

## Avance preservado

- Dashboard Coach y componentes modulares.
- Invitaciones, períodos pagados, pendientes, activos, desvinculación y creación de invitaciones.
- Repositorios y runtimes parciales.
- Pruebas locales reportadas antes de la pausa: invitaciones 367 PASS, pagos 84 PASS, dominio 144 PASS y contrato Coach 24 PASS.
- PostgreSQL local: SQL transaccional y 34 comprobaciones de seguridad/concurrencia reportadas PASS.

Estas cifras son evidencia histórica del handoff, no sustituyen una ejecución final desde cero.

## Bloque exacto pendiente

El controlador `Reenviar código / Generar nuevo código` existe sólo en DOMAIN:

- `coach-invitation-actions-contract.ts`
- `coach-invitation-actions-controller.md`
- `coach-invitation-actions-controller.test.ts`
- `coach-invitation-actions-controller.ts`
- `coach-invitation-actions-reconciliation.ts`

Falta integrarlo de forma selectiva en el worktree principal, crear su runtime usando exclusivamente operaciones vinculadas a generación y conectar el dashboard sin trasladar lógica de feature al composition root.

## Migraciones locales, no aplicadas en QA

1. `20260908201518_coach_dashboard_private_preferences.sql`
2. `20260909044235_coach_invitation_persistence.sql`
3. `20260909054933_coach_paid_period_persistence.sql`
4. `20260909085022_coach_pending_invitations_list.sql`
5. `20260909100428_coach_active_relationships_list.sql`
6. `20260909120120_coach_invitation_generation_binding.sql`

No fueron aplicadas en Supabase QA ni PROD. Deben revisarse como una cadena ordenada, validar RLS, ownership, grants, `WITH CHECK`, `SECURITY DEFINER` y `search_path`, y ejecutarse primero en QA sólo con autorización exacta.

## Decisiones de producto vigentes

- Cada alumno puede tener un solo coach activo.
- La invitación vence en 7 días; permite hasta 3 reenvíos por invitación cada 24 horas, separados al menos 60 segundos.
- Invitados que aún no aceptan cuentan como pendientes hipotéticos, no como pagos pendientes.
- Los activos renovados cuentan como activos; quienes no continúan se contabilizan como pérdida.
- Avisar a coach y alumno 3 días antes del vencimiento, el día del vencimiento y 1 día después.
- `Pago pendiente` permanece como recordatorio para que el coach confirme continuidad. Si pagó, el coach registra inicio y término del nuevo período.
- El pago mensual al coach es independiente de la duración del ciclo de entrenamiento.
- Mostrar alerta de inactividad después de 3 días sin entrenar.
- Medir cumplimiento por sesiones planificadas y completadas dentro del período, aunque el alumno entrene en un día distinto del originalmente seleccionado.
- Una vez vinculado, el coach puede crear, editar y eliminar rutinas del alumno dentro de los permisos aprobados.
- Las notificaciones deben llegar dentro del dashboard/campana y por correo cuando corresponda, tanto al coach como al alumno.
- El correo de invitación lo envía Organizatech identificando al coach. Cualquier copia al coach debe respetar privacidad y no exponer códigos o datos innecesarios.
- El flujo donde el alumno abre el enlace, entra a Perfil > Coach e ingresa el código espera el diseño final del dueño y no debe inventarse durante esta integración.

## Orden de reanudación

1. Verificar nuevamente los cuatro worktrees sin modificar el stash protegido.
2. Integrar selectivamente los cinco archivos del controlador de acciones desde DOMAIN.
3. Crear y probar el runtime principal de reenvío/regeneración.
4. Conectar el dashboard mediante controllers/runtimes definidos, manteniendo limpio el composition root.
5. Ejecutar SQL local y pruebas focalizadas; después typecheck, lint, build y `git diff --check` una sola vez como gate final.
6. Auditar el diff integrado con GPT-5.6 Sol medio, read-only, hasta resolver hallazgos concretos.
7. Preparar inventario y comandos para commit/push del dueño.
8. Con autorización separada, aplicar las seis migraciones únicamente en QA.
9. Entregar Preview para QA manual del dueño.

## Fuera de alcance hasta nueva aprobación

- Diseño definitivo del ingreso de código por parte del alumno.
- Historial clínico/de entrenamiento ampliado del alumno para decisiones del coach.
- Producción, merge, SQL remoto o variables de entorno.
