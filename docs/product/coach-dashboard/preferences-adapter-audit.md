# Preferencias Coach — adaptador Supabase — segundo lote

Fecha: 2026-09-08. DATA `codex/coach-dashboard-data-01`, base/HEAD
`00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`. Sin UI conectada ni SQL remoto.

## Alcance e inventario

Se añaden dos archivos al inventario del primer lote:

- `src/features/coach-dashboard/data/supabase-coach-preferences-repository.ts`
- `src/features/coach-dashboard/data/supabase-coach-preferences-repository.test.ts`

`package.json` registra el tercer test focal. El contrato visual conserva todas
sus assertions y actualiza únicamente el hash de package tras revisar el diff.
README documenta el adaptador y precisa los defaults PG* del runner. El runner
sólo cambia su comentario; no se cambian SQL, dependencias, lock ni env.

Quince archivos DATA congelados. SHA-256 agregado (rutas relativas ordenadas,
ruta + NUL + contenido de cada archivo):
`d3a29186d9b7bb2fef2b69a073c0dfecfecec28b737843e5cf60e0cd3459f238`.

- Package: `17669b2dba7aa7a57944457a574cff2fdccf8a6861cb6edf17bb3b673aebc78a`.
- Lock: `3651f947e7f6d9c7fc2079b73c863d8a71728adae24ab857b60be2e5b43dedc5`.
- Migración: `1dcba62528dac569acaa18d84437cd3a965d5ebd4274f9cfef1d1d20f2ba2cee`.
- Stash protegido: `7e618d67efb4290082a4f6be258c1f75640856c8`, intacto.

## Resultado técnico

PASS: 23 pruebas focales, typecheck, lint general, suite npm test completa,
build y whitespace de archivos tracked y nuevos. Los ocho tests nuevos ejercitan
SDK Supabase2.105.4 real con HTTP simulado: headers/allowlists, confirmación del
endpoint Chat, errores sanitizados, ausencia de retry, abort y cambio de cuenta.
No se enviaron solicitudes a QA/PROD ni se utilizaron credenciales reales.

Logs: `/tmp/organizatech-coach-adapter-{focal,typecheck,lint,npm-test,build}.log`.

## Auditoría independiente

PASS estático del delta: proceso Claude real read-only, limitado a Read/Glob/Grep,
completado exit0 sin hallazgos bloqueantes. Revisó la API instalada del SDK,
token capturado, deadline, abort/retry, allowlists y aislamiento de configuración.
No ejecutó tests; distingue su revisión de los logs del coordinador.

- Prompt: `/tmp/organizatech-coach-adapter-claude-audit-prompt.md`.
- Resultado: `/tmp/organizatech-coach-adapter-claude-audit.json`.

Observaciones no bloqueantes: la configuración pública aprobada puede contener
un subpath que produzca endpoint incorrecto; el filtro de secretos identifica
`sb_secret_`, no inspecciona roles de JWT legados. No es un validador de secretos:
la integración sólo puede suministrar la clave pública frontend aprobada. Se
instancia un SDK por operación, con Realtime inerte y sin conexión. El aislamiento
Auth está respaldado por inspección de la versión instalada y tests indirectos;
se debe preservar lock y revisar esa garantía al actualizar dependencias.

No se utilizaron llaves privadas reales. El PASS del primer lote no se usó como
sustituto de esta auditoría; el scan sellado anterior no se reabrió ni alteró.

## Integración y QA pendientes

El adaptador recibe configuración pública aprobada y el principal existente;
fija el token verificado por operación mediante `accessToken`, sin otra sesión
Auth ni refresh. Las tres RPC usan POST, retry false y deadline compartido.

Falta conectar controller/UI y generación de sesión; probar recuperación de
writes inciertos antes de reintentos, DTO/mappers y permisos hospedados con QA
del dueño. Un timeout no promete rollback. Las64 pruebas SQL y el scan sellado
corresponden al primer lote sin cambios SQL. Ninguno equivale a QA del flujo Coach.

No hubo commit, push, migración remota ni modificación de producción.
