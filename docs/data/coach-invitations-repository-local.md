# Coach: adaptador/repository local de invitaciones

Estado: **PASS de integración local y auditoría independiente GPT-5.6 Sol medio**.
Sin UI; captura real de sesión y QA remoto siguen pendientes.
Base DATA: `00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`, branch
`codex/coach-dashboard-data-01`. Continúa la actividad autorizada del 9 de septiembre.

## Incremento exclusivo

Seis archivos nuevos en `src/features/coach-clients/data/`:
`coach-invitations-contract.ts`, `coach-invitations-deadline.ts`,
`coach-invitations-validation.ts`, `coach-invitations-repository.ts`,
`coach-invitations-repository.test.ts`, `coach-invitations-validation.test.ts`.
El séptimo archivo del patch es este documento. Los 20 archivos previos,
incluidas migración/pruebas SQL y preferencias, permanecen congelados e intactos.
Stash protegido: `7e618d67efb4290082a4f6be258c1f75640856c8`, sin tocar.

## Contrato y responsabilidad de integración

- `createCoachInvitationsRpcAdapter` recibe exclusivamente el puerto RPC de un
  cliente Supabase **ya autenticado y fijado a la identidad**; no crea SDK/Auth,
  no lee sesión mutable, tokens, env ni credenciales. Exige las ocho RPC existentes
  y su allowlist; usa POST (`get:false`, `head:false`) y `abortSignal`.
- `createCoachInvitationsRepository` recibe `captureOperation(signal)`.
  La captura debe verificar identidad y fijar transporte a esa sesión; devuelve
  `identity:{userId,generation}`, `client` e `isCurrent(snapshot)`.
  El integrador debe comparar **ambos** campos con la sesión vigente. El repositorio
  copia/congela el snapshot y lo comprueba antes/después de RPC, incluso si rechaza.
- Métodos: `createInvitation`, `resendInvitation`, `regenerateInvitation`,
  `cancelInvitation`, `revokeRelationship`, `readInvitation`, `readOwnOperation`,
  `readRelationship`. Todas las mutaciones requieren el requestId explícito del
  llamador. No genera IDs ni reintenta/regenera/reenvía automáticamente.
- UUID canónico y allowlists exactas; correo normalizado por espacios exteriores
  ASCII/minúsculas y límites UTF-8 de servidor. Rechaza ownership, campos extra,
  símbolos, propiedades ocultas, getters y prototipos inesperados.
- Presupuesto único captura+transporte: 8 segundos por defecto, configurable de
  1 a 30.000 ms. Abort del llamador y timeout se distinguen; una captura tardía
  no puede iniciar RPC y una respuesta tardía no puede confirmar el resultado.
  El puerto subyacente tampoco debe aplicar reintentos de escritura implícitos.
- `recorded` sólo confirma persistencia; `reserved` **no es correo enviado**.
  Replay cancelado sigue cancelado. `rate_limited` conserva serverNow/retryAt
  recibidos y valida su orden. `readOwnOperation` puede devolver null legítimamente.
- Respuestas se validan por keys, tipos, referencias/acción/requestId esperados,
  estados y rangos. Se construyen DTO nuevos congelados, sin ownership, payload,
  código ni recibos inventados en las operaciones. Sólo el detalle propio pending
  admite el código aprobado; expired/cancelled/accepted exigen code null.
- Fechas ISO de años 0001–9999 con zona explícita y hasta seis decimales; comparación
  a microsegundos, calendario válido y vigencia exacta de 168 horas. El read de
  invitación no trae serverNow: **no se inventa expiración usando el teléfono**.
  Snapshots de episodios no son un lookup ni una validación nueva del perfil.
- Errores sanitizados: 42501→forbidden, 22023→invalid_input, P0002→not_found,
  55000→state_conflict, 40001→retry_required (no version_conflict de preferencias).
  Messages/details/hints/cause no se propagan. Rechazos 55000 de invitación propia
  ya pending/active mantienen este mismo contrato y nunca producen éxito.

Abort/timeout/unavailable no demuestran que el servidor haya revertido una
mutación. La integración debe reconciliar el **mismo requestId** mediante lectura
antes de ofrecer otra acción; este repositorio no toma esa decisión de producto.

## Validación y pendiente de integración

```sh
./node_modules/.bin/tsx --test src/features/coach-clients/data/coach-invitations-repository.test.ts src/features/coach-clients/data/coach-invitations-validation.test.ts
npm run typecheck
npm run lint
npm run build
git diff --check
```

PASS local: 26 tests mock sin I/O, typecheck, lint, build y diff check. Cobertura:
ocho RPCs/allowlists, referencias, sesión/generación stale, captura/transportes
colgados, abort/capturas tardías, errores hostiles sanitizados, microsegundos,
estados/código, campos ficticios, rate limit y snapshots.

Registro global DATA pendiente: el contrato histórico ejecutado directamente
falla `193 !== 196` (SQL focal anterior más dos focales nuevos aún sin package).
No se modificó package ni se declaró PASS de suite general. ROOT registra los
dos focales nuevos una sola vez y los integra al gate en su entorno; no debe
debilitarse el contrato histórico. No se reejecutó SQL en este incremento.

Integrado byte-idéntico en ROOT y registrado una sola vez. Lote18 pasó
invitaciones30, DOMAIN130, SQL+40checks, npmtest pre/main/post, lint/build/typecheck
y diff-check. Auditor GPT-5.6 Sol medio PASS: focal independiente49/49, sin
hallazgos bloqueantes. Evidencia `/tmp/organizatech-coach-invitations-integrated.GOScwN/`.
Faltan integración de captura real y PostgREST, además de QA manual del dueño
cuando exista superficie aprobada. Auditor no comprobó estas fases ni reejecutó SQL.
Sin aceptación/dispatcher/UI, SQL remoto, navegador, commit, push o despliegue.
Este PASS del lote no equivale a Coach completo listo para QA ni producción.

La guía Supabase motivó mantener el cliente fijado, POST explícito, cancelación
y separación entre errores de transporte y confirmación de negocio.
[Referencia RPC](https://supabase.com/docs/reference/javascript/rpc).
