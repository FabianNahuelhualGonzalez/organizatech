# Repositorio de períodos pagados — local y desconectado

Incremento de seis archivos: `coach-paid-periods-contract.ts`,
`coach-paid-periods-validation.ts`, `coach-paid-periods-repository.ts`, sus dos
tests bajo `src/features/coach-clients/data/` y este documento. No modifica SQL,
invitaciones, preferencias, package, UI ni archivos ROOT.

## Contrato

Consume exclusivamente las cuatro RPC de `20260909054933_coach_paid_period_persistence.sql`:

| Método | RPC | Resultado |
| --- | --- | --- |
| `confirmPeriod` | `confirm_own_coach_paid_period` | `status:recorded`, operación `action:confirm` |
| `correctPeriod` | `correct_own_coach_paid_period` | `status:recorded`, operación `action:correct`, mismo periodId solicitado |
| `readPeriod` | `read_own_coach_paid_period` | Último período registrado o `period:null` con versión inicial |
| `readOwnOperation` | `read_own_coach_paid_period_operation` | Recibo del requestId o `null` legítimo |

Confirmación recibe exactamente `episodeId,start,end,expectedVersion,requestId`;
corrección agrega `periodId`. Lecturas reciben sólo el UUID de episodio o solicitud.
No ownership cliente, estados arbitrarios, importe, código, email ni datos de actividad.
UUID canónicos (se acepta mayúscula y se serializa minúscula); fechas Gregorianas
estrictas `YYYY-MM-DD`, años 0001–9999 y fin posterior al inicio. No normaliza fechas
inválidas ni inventa duración, estado comercial o fecha del ciclo de entrenamiento.
Cronología entre períodos, episodio activo, membership y CAS siguen siendo autoridad SQL.

DTO y recibos contienen sólo sus campos SQL allowlisted. `Period` conserva
`id,linkEpisodeId,start,end`, compatible estructuralmente con el modelo auditado.
La versión inicial es `00000000-0000-0000-0000-000000000000`; período presente y
recibos requieren versión no inicial. La respuesta de write debe coincidir con
acción, requestId, episodio, fechas y periodId conocido de corrección, y devolver
una versión distinta de expectedVersion. Devuelve snapshots nuevos e inmutables.
No calcula vigencia contra reloj cliente ni afirma que un recibo histórico sea actual.

Elegir “Pagado” o editar el modal no llama automáticamente al repositorio. La futura
integración debe invocarlo sólo con Guardar/Listo explícito. `recorded` es el hecho
comercial manual, no procesamiento de pago, cobro, deuda o correo enviado. Este lote
no persiste pending/declined, avisos, snapshots mensuales ni consentimiento.

## Captura, transporte y fallos

Reutiliza por import el contrato de identidad/generación y captura de invitaciones
(sustituyendo sólo el tipo del port cliente), su deadline único y parsers seguros
de records/UUID/timestamps. La allowlist RPC de invitaciones no cambia. El port de
pagos es propio y sólo adapta un cliente **ya autenticado/pinned**: POST explícito,
mismo AbortSignal, sin construir SDK, consultar Auth o reintentar por cuenta propia.
La sesión exterior debe suministrar captureOperation e isCurrent real; no se crea
una implementación ficticia de autenticación dentro del repositorio.

Deadline total captura + transporte: 8 s por defecto, configurable 1–30000 ms.
Comprobaciones de identidad y generación capturadas antes/después de RPC y mapping,
también ante rechazo. Cambiar cuenta o reiniciar sesión con igual UUID invalida la
operación. Captura/transporte tardío tras timeout o abort no publica ni dispara otra RPC.

Los errores se reconstruyen con códigos técnicos fijos, nunca mensaje/details/hint,
causa o copy visible procedente de SQL/SDK. `55000` distingue vínculo inactivo;
`P0002` referencia ajena/inexistente; `42501` acceso denegado. Los mensajes SQL fijos
permiten distinguir `request_conflict` (22023) y `version_conflict` (40001); un 40001
genérico queda `conflict`, no el `retry_required` técnico de invitaciones. No se
reintenta ninguno automáticamente. DTO extra/incoherente resulta `invalid_response`.
La envoltura admite sólo data/error y metadata conocida count/status/statusText,
sin devolver esa metadata ni aceptar éxito HTTP/SQL contradictorio.

Ante timeout, desconexión, aborto o respuesta inválida posterior al dispatch, el
resultado del write puede ser incierto. El caller conserva requestId y consulta
explícitamente `readOwnOperation` con ese mismo valor; el repositorio no crea otro
requestId, repite write ni lee automáticamente. El recibo debe reconciliarse con
el intento que conserva el caller; no equivale a la versión más reciente. `null`
no autoriza renovar ni corregir automáticamente. Tras unlink se puede consultar
el hecho comercial propio; los writes se rechazan. No se habilita actividad del alumno.

## Validación y límites

```sh
./node_modules/.bin/tsx --test src/features/coach-clients/data/coach-paid-periods-repository.test.ts src/features/coach-clients/data/coach-paid-periods-validation.test.ts
npm run typecheck
npm run lint
git diff --check
```

Tests sin I/O: las cuatro operaciones, allowlists, fechas/bisiestos, CAS/requestId,
IDs falsos, no-período, recibos inmutables, errores saneados, cambio de cuenta y
generación, payload mutado durante captura, deadline compartido, abort y respuestas
tardías. Los tests de timeout usan timers virtuales Node (API experimental en Node22),
sin espera de tiempo real. El SQL anterior permanece congelado; no se reejecuta ni
modifica en este lote de repositorio.

Los dos focales nuevos requieren registro único en package reservado a ROOT. Este
incremento no sustituye evidencia SQL, auditoría independiente Sol medium, integración
de sesión real/Guardado, aceptación Alumno ni QA manual del dueño. No acredita QA PASS,
envío, consentimiento, despliegue, producción o disponibilidad para commit.

Guía Supabase aplicada a allowlists, separación de Auth y abort:
[RPC](https://supabase.com/docs/reference/javascript/rpc).

## Integración ROOT 09-09

Los seis archivos se transfirieron por patch exacto después de revisar su contrato
y el SQL ya auditado. Los dos tests nuevos quedaron registrados una sola vez,
junto al focal de migración anterior, en test:coach-dashboard-paid-periods; posttest
lo ejecuta. La evidencia DATA de npm test FAIL 193/199 era registro pendiente:
ROOT ahora tiene focal pagos 28/28 e invitaciones 40/40, npm test completo
(pre/main/post), lint, build, typecheck y diff secuenciales PASS.

No se modificó ni volvió a aplicar SQL; conserva el hash y las pruebas PostgreSQL
del lote ROOT15. El contrato documental de integración se reconcilió con decisiones
ya aprobadas (fechas pagadas manuales, fuente monetaria nueva y fase1 sin montaje).
Auditoría independiente GPT-5.6 Sol medio READ-ONLY: PASS para este lote9, sin
hallazgos. El auditor ejecutó personalmente focales 28/28 y diff check; verificó
9/9 hashes, 160/160 archivos no compartidos preservados y SQL congelado. No hizo
QA remota/manual ni probó todavía conexión SDK de pagos, controller, Guardar o UI.
Informe y manifest inmutable: /tmp/organizatech-coach-paid-adapter-root.vd01rQ/.
