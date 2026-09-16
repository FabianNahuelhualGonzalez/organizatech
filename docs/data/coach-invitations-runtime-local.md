# Invitaciones Coach — composición aislada con SDK real

## Responsabilidades y límites

- `coach-invitations-operation.ts`: captura y verifica la sesión del principal
  existente. Comprueba usuario y generación antes y después de cada paso Auth.
- `supabase-coach-invitations-repository.ts`: configura un cliente por operación
  con la credencial capturada, usando el adapter y repositorio ya auditados.
- `supabase-coach-invitations-repository.test.ts`: SDK real con Auth y fetch
  simulados; diez pruebas deterministas sin solicitudes a un proyecto remoto.

El consumidor futuro debe proporcionar configuración pública, principal existente
y un guard vivo que invalide la generación al cambiar cuenta, portal o lifecycle.
Este módulo no decide acceso, construye pantallas, monta UI, lee env, inicia sesión,
envía correo ni acepta una invitación. RLS, ownership y permisos siguen siendo
responsabilidad del servidor. No se afirma integración productiva o QA manual.

## Captura y transporte

La configuración y la identidad esperada se copian una vez al construir el
repositorio. Se admite HTTPS, o HTTP exclusivamente en localhost; se rechazan
credenciales URL, query y fragmentos. La llave de API debe ser pública publishable
o una llave anon legacy. La inspección de su rol no autentica el JWT; evita usar
configuración privada accidental. Supabase verifica la llave en el servidor.

Cada operación ejecuta getSession en el principal existente, verifica que su
usuario sea el esperado, captura exactamente su credencial y llama getUser con
esa misma credencial. Si hay cambio de usuario/generación, aborto o vencimiento
del plazo, no se construye el siguiente transporte. Auth no abortable puede
terminar tarde: cada continuación comprueba el estado antes de hacer otra llamada.

La opción accessToken del SDK evita inicializar un segundo cliente Auth, storage,
listeners o auto-refresh. El transporte conserva la credencial verificada, no
consulta nuevamente una sesión global mutable. Las ocho RPC conservan allowlists
explícitas y POST; retry(false) desactiva reintentos del transporte.

Se reutiliza el plazo total del repositorio (captura + RPC, 8 segundos por defecto).
AbortSignal y comprobaciones posteriores impiden publicar respuestas tardías en
otra generación. Un timeout/aborto de un write no garantiza rollback remoto:
el consumidor debe reconciliar el requestId original mediante readOwnOperation,
sin crear otra intención ni anunciar que el correo fue enviado. recorded y
reserved siguen significando persistencia/reserva, no entrega.

## Verificación

Las pruebas interceptan todo fetch del SDK en un dominio .invalid y usan fixtures
sintéticos. Cubren las ocho RPC, cabeceras capturadas, allowlists, configuración
mutable, identidad inválida, sesión ausente, verificación fallida, cambio de cuenta
o generación, Auth bloqueado, aborto, SDK bloqueado, respuesta tardía, HTTP 503,
fallo de red, respuesta malformada y sanitización de errores.

La implementación instalada de SupabaseClient se inspeccionó para confirmar que
accessToken no inicializa Auth. Se consultó documentación oficial de RPC y
retry(false). No se añadieron dependencias ni se modificaron lockfile o env.

PASS ROOT: 44 focales de invitaciones/pagos (incluyen 10 del SDK), 37 de integración,
SQL pagos transaccional y 32 comprobaciones concurrentes con la migración R2 de
invitaciones, npm test completo (pre/main/post), lint, build, typecheck y diff,
en secuencia. Auditoría independiente GPT-5.6 Sol medio ROOT15: PASS sin hallazgos
bloqueantes; ejecutó 62 focales del lote y diff, verificó integridad y revisó evidencia.
No hay auditoría propia,
Auth/PostgREST remoto, migración aplicada, commit, push ni Preview nuevo.
