# Períodos pagados — runtime SDK y preparación explícita

Lote aislado ROOT: transporte SDK de pagos, reutilización acotada del transporte
Coach existente, compatibilidad del envelope SDK y contexto confirm/correct del
único borrador comercial. Sin montaje, UI nueva, SQL ni aplicación remota.

## Composición y seguridad de sesión

`supabase-coach-paid-periods-repository.ts` conecta las cuatro RPC allowlisted al
SDK instalado. Recibe configuración pública y principal existente; no lee env,
storage ni crea una sesión Auth. La captura existente se hizo genérica solamente
en el tipo del port, conservando comportamiento y API legacy de invitaciones.
No se amplía su allowlist de ocho RPC ni la de cuatro RPC de pagos.

El helper `coach-public-rpc-runtime.ts` extrae configuración e identidad y crea
el transporte pinned que ambos callers ya necesitan. Rechaza claves no públicas,
URL con credenciales/query/hash y HTTP no local, antes de I/O. El UUID y generación
se copian, sin seguir cambios posteriores del objeto input. No es un repository
genérico de producto; sólo suministra el port privado de estas composiciones.

Cada operación comparte el mismo deadline durante getSession, getUser y RPC.
El token capturado se verifica explícitamente con getUser y luego se conserva
exactamente para `accessToken`, que evita inicialización Auth, refresh y listeners
del SDK. Cambio de cuenta/portal/generación, timeout o aborto invalida continuaciones
tardías. Los calls usan POST, AbortSignal y retry(false). Ningún resultado incierto
genera una nueva solicitud ni una reconciliación automática; el caller conserva
requestId y decide explícitamente consultar su recibo, sin confundirlo con estado actual.

## Incompatibilidad detectada y corregida en integración

La primera prueba con el SDK real falló: su envelope incluye `success`, ausente
de la allowlist del adapter previo que se validó con puertos simulados. Evidencia
del SDK instalado: `node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts`,
retorno `success: error === null`. Se conserva el primer log local fallido en
`/tmp/organizatech-coach-paid-runtime.EK8A5O/runtime-before-fix.log`.

El validador ahora admite ese campo opcional únicamente si es booleano y coincide
con error === null. Conserva rechazo de propiedades adicionales, getters, HTTP
contradictorio, errores arbitrarios y DTOs incoherentes. No se ignora success ni se
usa para saltar validaciones. Puertos anteriores sin success siguen compatibles.
El primer log también detectó una prueba con reloj virtual adelantado antes de
comenzar la captura; se corrigió el orden del fixture, no la política de timeout.

## Borrador comercial

Se integra el patch DOMAIN de tres archivos `10123f1a…` revisado en ROOT. La nueva
apertura/preparación distingue confirmar próximo período de corregir un periodId
existente, sin falsear currentPaidPeriodEndsOn ni inferir acción desde fechas.
Un solo draft y undo; aceptar fechas es local, Listo prepara una intención y el
futuro controller será el único que pueda despacharla. Pending/declined no son
pagos ni revocaciones. Modelo puro no autoriza por sí mismo el binding al episodio.
Contrato detallado: `src/features/coach-dashboard/model/coach-renewal-period-command.md`.

## Pruebas y límites

Los diez tests nuevos ejecutan SDK real con Auth y fetch sintéticos interceptados,
dominio `.invalid` y sin ninguna llamada de red. Cubren cuatro RPC/allowlists,
headers, configuración, ausencia legítima, identidad, token verificado inmutable,
aborto, deadline compartido, errores, no retry y reconciliación explícita. Reloj
virtual Node usado para timeout; su warning experimental no es un fallo de producto.
Tests existentes de invitaciones cubren la regresión del helper extraído. Los
35 del borrador (21 previos + 14 nuevos) ya estaban registrados; sólo el nuevo
test SDK se agrega a test:coach-dashboard-paid-periods, que posttest ejecuta.

Validaciones ROOT secuenciales PASS: pagos 38/38, invitaciones 40/40, dominio
144/144, npm test completo (pre/main/post), lint, build, typecheck después del
build y git diff --check. Evidencia en /tmp/organizatech-coach-paid-runtime.EK8A5O/.
Auditoría independiente GPT-5.6 Sol medium READ-ONLY: PASS de este lote13, sin
hallazgos. Validación propia del auditor: 83/83 (pagos38 + runtime invitaciones10
+ draft35), diff PASS; manifest13, logs y baseline161 preservado verificados.
Informe y hashes posteriores a esta actualización documental en la misma evidencia.
El auditor no ejecutó suite global/build, SQL, Auth real ni QA/E2E. No ejecutar
npm test en paralelo con build/typecheck/auditoría: sus probes mutan temporalmente
el composition root y lo restauran. No se toca ese root ni package-lock en el lote.

No acredita QA PASS, datos guardados remotos, envío, consentimiento, montaje,
conexión del botón Listo, commit/push ni producción. No cambia migrations ya
auditadas; su autorización exacta de QA sigue pendiente. Guía Supabase aplicada
al port RPC, captura y abort con la documentación oficial de
[AbortSignal](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal)
y la implementación instalada del SDK; no se instalaron dependencias ni se usó navegador.
