# Períodos pagados Coach — incremento local

Estado: implementación y evidencia técnica local; no ejecución QA/PROD ni integración UI.
Acuerdos del dueño del 09-09-2026; referencias read-only auditadas de ROOT:
`coach-payment-period.ts`, `coach-renewal-draft.ts` y `coach-renewal-detail-view.ts`.

## Inventario exclusivo

- `supabase/migrations/20260909054933_coach_paid_period_persistence.sql`
- `supabase/tests/coach_paid_periods_local.sql`
- `supabase/tests/support/run_coach_paid_periods_postgres.mjs`
- `src/features/coach-clients/data/coach-paid-periods-migration.test.ts`
- Este documento.

Nombre final generado por `supabase migration new coach_paid_period_persistence`,
CLI 2.114.0, después de consultar `migration new --help`. Sustituyó un nombre
manual provisional antes del cierre; el contenido se trasladó mediante apply_patch.
Depende de la migración de invitaciones `20260909044235`: episodios existentes,
membership real y su lock exclusivo. No la modifica. DATA conserva esa dependencia
anterior al fix R1; integrar sólo estos cinco archivos, nunca sustituir la versión
de invitaciones corregida en ROOT. Repetir el runner en ROOT prueba ambas juntas.

## Contrato mínimo

Las cuatro RPC públicas devuelven JSONB; sólo `authenticated` tiene EXECUTE.
No aceptan propietario, identidad del alumno, estado comercial arbitrario,
objetos de formulario, importe, tarifa, entrenamiento ni evidencia de consentimiento.

| RPC | Argumentos exactos |
| --- | --- |
| `confirm_own_coach_paid_period` | `p_episode_id uuid, p_start text, p_end text, p_expected_version uuid, p_request_id uuid` |
| `correct_own_coach_paid_period` | `p_episode_id uuid, p_period_id uuid, p_start text, p_end text, p_expected_version uuid, p_request_id uuid` |
| `read_own_coach_paid_period` | `p_episode_id uuid` |
| `read_own_coach_paid_period_operation` | `p_request_id uuid` |

Lectura de último período **registrado**, no necesariamente vigente hoy:

```ts
type Period = { id: string; linkEpisodeId: string; start: string; end: string };
type ReadResult = { linkEpisodeId: string; version: string; period: Period | null };
type Receipt = {
  requestId: string;
  action: "confirm" | "correct";
  period: Period;
  version: string;
  recordedAt: string;
};
type WriteResult = { status: "recorded"; operation: Receipt };
type ReadOperationResult = Receipt | null;
```

`Period` coincide con `CoachPaidPeriod`. `version` es un UUID opaco por registro
comercial del episodio, no por formulario ni entrenamiento. Sin períodos, lectura
retorna `period:null` y versión `00000000-0000-0000-0000-000000000000`, sin INSERT.
Cada guardado exitoso emite otra versión. No convierte `CoachRenewalBaseline.id`
en episodio automáticamente: su mapeo y el adaptador tipado requieren otro lote.

Sólo la acción explícita final Guardar/Listo debe invocar confirmación. Elegir
“Pagado”, abrir/cerrar fechas, aceptar fechas en el modal anidado o derivar estados
no guarda nada. Este lote no conecta handlers de UI, por lo que no acredita ese QA.
`recorded` significa hecho comercial confirmado manualmente, no procesamiento de
pago, cobro, deuda, mensaje enviado ni entrega de un aviso.

Fechas civiles Gregorianas canónicas `YYYY-MM-DD`, años 0001–9999 inclusive;
sin espacios, normalización implícita, timestamp, infinity ni año cero. `end > start`.
El fin es inclusivo: una confirmación nueva exige inicio posterior al último fin
confirmado, igual que el modelo auditado de renovación. No impone duración,
mes actual, importe ni fechas del ciclo de entrenamiento. Un período futuro o
histórico explícito es válido; los estados los deriva el modelo existente.

Corregir conserva `periodId` y `confirmed_at`; cambia fechas y `corrected_at`,
registra las fechas anteriores en una operación inmutable y no puede cruzar ni
solapar los vecinos anterior/siguiente. Renovar explícitamente crea otro período.
No hay endpoint de eliminación ni renovación automática. Se preservan todos los
períodos y revisiones; la lectura acotada devuelve sólo el último período. No se
añade una pantalla ni un endpoint de historial de actividad del alumno.

## Autorización, concurrencia y revocación

Las tres tablas privadas tienen FORCE RLS sin policies y sin grants de acceso
directo. Helpers privados SECURITY INVOKER no ejecutables por clientes; wrappers
SECURITY DEFINER con `search_path=''`, identidad desde `auth.uid()` en el helper
existente y membership Coach consultada en su tabla real, nunca metadata cliente.

Orden común: fila Coach `FOR UPDATE` realmente exclusiva, episodio propio
`FOR UPDATE`, registro/períodos y operación. Es compatible con el revoke existente;
no hay upgrades KEY SHARE ni orden inverso. Locks y cambios viven en la transacción.
No requiere extensiones nuevas, workers, credenciales, SDK ni llamadas externas.

Los writes requieren episodio propio **activo**, incluso al repetir una solicitud
previa tras unlink. Se aplica CAS con `p_expected_version`; requestId se conserva
explícitamente. Repetir mismo request y mismos argumentos devuelve exactamente la
operación guardada, antes de comprobar la versión actual. Cambiar acción, episodio,
período de corrección, fechas o versión con ese requestId se rechaza. No hay retries
automáticos: ante respuesta incierta se consulta la operación por requestId.
Un replay devuelve su recibo histórico, no afirma que sea la versión actual.

Unlink bloquea nuevos writes; conserva hechos comerciales del Coach. Ambas lecturas
de esos hechos propios siguen disponibles con membership válida, también para
reconciliar una respuesta perdida. No devuelven actividad, identidad del alumno,
payload, código de invitación ni ownership; no amplían RLS/grants de entrenamiento.
No confundir esta lectura comercial con acceso al historial del alumno.
Las FK siguen la eliminación física de su episodio: retención/borrado de cuenta
es una política distinta, no decidida ni ampliada en este lote.

Errores esperados de dominio usan mensajes fijos, sin parámetros interpolados:
`42501` identidad/membership; `P0002` referencia inexistente o ajena; `22023` input,
fechas o request reutilizado con payload distinto; `55000` vínculo inactivo;
`40001` versión/colisión concurrente. No reenviar ciegamente ante `40001`: refrescar
hechos y resolver el intento con confirmación explícita. El adaptador futuro debe
sanitizar también errores de transporte/coerción UUID que ocurren antes del cuerpo
de la RPC. No exponer mensajes PostgreSQL arbitrarios a la UI.

## Verificación local reproducible

```sh
node supabase/tests/support/run_coach_paid_periods_postgres.mjs
./node_modules/.bin/tsx --test src/features/coach-clients/data/coach-paid-periods-migration.test.ts
npm run typecheck
npm run lint
npm run build
git diff --check
```

Runner macOS arm64 con PostgreSQL 17.5, binario público fijado por SHA-256, `pg`
existente. Descarga exclusivamente el artefacto público; DB sin TCP en socket Unix
privado, puerto 55444, cluster temporal propio. No carga `.env`, URLs DB ni PG*
heredadas. Fixtures sintéticos, SQL BEGIN/ROLLBACK y cluster eliminado al salir.
Admin crea episodios sólo como fixtures de esquema: no hay aceptación pública ni
consentimiento real atribuido. Logs no contienen SQL, fechas, identidades ni parámetros.

Pruebas reales: auth/membership, ownership/BOLA y referencias falsas, grants,
search_path, FORCE RLS incluso ante grants accidentales, formato civil/años/bisiestos
y DateStyle/timezone, fechas iguales/solapadas, identidad estable y revisiones,
replay/payload distinto, CAS con dos conexiones, renovación contra corrección,
requestId independiente entre Coaches, ambos órdenes guardar/desvincular y borrado
de membership. Las carreras deterministas observan wait_event_type='Lock' en la
segunda conexión antes de liberar la primera; no se basan sólo en scheduling JS.
El contrato fuente y hash complementan estas pruebas, no las reemplazan.

Registro global de este nuevo focal en package.json reservado a ROOT. DATA no cambia
package/lock ni el contrato histórico. `npm test` global puede detenerse en ese
inventario pendiente; no significa que este incremento esté integrado globalmente.

Ejecución DATA del 09-09: SQL transaccional PASS + 32 comprobaciones del runner,
focal 4/4 PASS, lint/build/typecheck secuencial PASS. `npm test` se detuvo en pretest
por el inventario global pendiente: 193 referencias frente a 197 tests presentes.
La primera ejecución paralela de typecheck y build encontró `.next/types` en
regeneración; el typecheck repetido después del build terminó con exit 0.

## Pendiente fuera del lote

Integración ROOT 09-09: los cinco archivos se transfirieron por patch exacto;
el focal quedó registrado una vez y el contrato compartido sólo permite esta
migración exacta adicional. Runner repetido con invitaciones R2: SQL transaccional
PASS más 32 comprobaciones. npm test completo, lint, build, typecheck y diff
secuenciales PASS. Esto cierra el registro pendiente de DATA, no su auditoría
independiente ni una ejecución QA remota.

Persistencia de renovación `pending`/`declined`, mapeo de `CoachRenewalBaseline`,
adaptador/repositorio TypeScript, conexión Guardar/Listo, snapshot mensual histórico
con tarifa/cartera, avisos/idempotencia de eventos/entrega, aceptación Alumno y QA
funcional por el dueño. No convertir pending/declined en desvinculación ni en pago
confirmado. Auditoría independiente y pruebas conjuntas ROOT preceden cualquier
autorización específica de QA remoto; no se declara producción ni cierre completo.

Auditoría independiente ROOT15 GPT-5.6 Sol medio: PASS sin hallazgos bloqueantes.
Revisó SQL, runner y evidencia local; no ejecutó personalmente el runner porque
descarga un binario público. Ejecutó 62 focales del lote y diff. SQL/hash y todas
las fuentes permanecen sin cambios; sólo este documento registra el cierre.
