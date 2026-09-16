# Creación de invitaciones — controlador de reserva y runtime aislados

## Alcance

Controlar la intención de crear una invitación, su reserva y la reconciliación
de respuestas inciertas usando las RPC ya auditadas. No enviar correo, entregar
comprobante del proveedor, aceptar un vínculo, buscar perfiles o montar UI.
No se modifican las cinco migraciones Coach, SDK, dependencias ni configuración.

El contrato es propio de `coach-clients/hooks`; implementación y pruebas de
DOMAIN se transfieren únicamente después de congelar las cinco rutas nuevas.
MAIN conecta `integration/coach-invitation-creation-runtime.ts`, prueba el SDK
instalado con Auth/fetch sintéticos y registra los tests una vez en package.
El composition root, lockfile, SQL y los otros 227 archivos previos permanecen
inmutables; sólo package y su hash de contrato existente cambian del baseline.

## Responsabilidades

La creación es una intención explícita con email normalizado y requestId único.
Editar texto o abrir/cerrar la hoja no es una escritura. Tras un resultado
incierto se conserva la intención enviada, aunque el borrador cambie: se consulta
su operación y no se genera otro id a ciegas. Una operación ya registrada exige
comprobar también el detalle actual y su id/email/generación/estado.

El puerto mínimo no admite código, propietario, perfil, episodio ni datos de
actividad. Incluso el código pendiente autorizado que retorna el repositorio
se descarta antes del controlador. `reserved` no equivale al estado
`provider-accepted`/`delivered` exigido por la hoja presentacional existente.
El resultado true del controlador significa sólo reserva propia vigente;
no habilita por sí solo ese paso visual, copiar/compartir o enviar otro correo.

Se reutiliza `normalizeRecipientEmail`: validación/normalización existente del
repositorio, sin imponer la expresión más restrictiva del prototipo. El texto
crudo se conserva separado de la intención canónica. Los errores quedan en enums,
sin mensajes privados del servidor. Los límites los decide el servidor y retornan
`serverNow/retryAt`; no se usa el reloj del teléfono para inventar elegibilidad.

Runtime captura configuración pública, principal, identidad, callback de requestId
y guardia de vigencia. La misma guardia monotónica protege controller y SDK.
La fuente conserva validación de DTO, token fijado/verificado y deadline de cada
llamada, incluido Auth. Los POST no se reintentan automáticamente. La secuencia
de creación más lectura puede implicar dos llamadas acotadas, no un único timeout
compartido entre todas las llamadas de la secuencia.

El futuro owner de pantalla debe disponer la instancia ante salida o cambio de
cuenta/generación/portal/membresía. Cerrar localmente después del envío no revierte
ni olvida la petición. Cancelar una invitación y desvincular pertenecen al
controlador separado ya existente, no a este cierre local. Tampoco hay persistencia
del intento en storage ni restauración de un nuevo controller tras recargar.

## Verificación y estado

Código integrado: PASS local. DOMAIN entregó cinco archivos congelados;
el contrato conserva SHA-256
68fa198fae4f96c6ec3279c9fb7ac202f1b89c1e195621e29bf80b0d5d067273.
MAIN leyó la entrega y aplicó sólo las cuatro altas restantes, byteidénticas al
handoff. Inventario final: diez rutas del incremento, 237 rutas totales pendientes;
227 rutas previas preservadas y cinco SQL, composition root, lock y stash intactos.

Gates ejecutados secuencialmente sobre la integración completa:

- Runtime SDK sintético: 18/18 PASS.
- Suite invitaciones: 301/301 PASS, incluidos 36 casos del nuevo controller.
- Regresión de períodos pagados: 84/84 PASS; dominio: 144/144 PASS.
- npm test completo (pretest, test y posttest), lint, build, typecheck y diff: PASS.
- Integridad del baseline y transferencia exacta DOMAIN: PASS.

No se repiten las pruebas SQL de lotes cerrados porque no hay cambio SQL.
Auditoría independiente GPT-5.6 Sol media READ-ONLY: PASS, sin hallazgos
HIGH/MEDIUM/LOW verificables en las diez rutas del incremento. El auditor ejecutó
por su cuenta invitaciones 301/301, diff e integridad; inspeccionó los otros logs
sin atribuirlos como ejecución propia. Informe `sol-audit.md`, SHA-256
203e7300e02e75b6d169f4ce0acf9979dd9a2f0ac79b7f3df46f178e1cb97863.
Manifest auditado `manifest.json`, SHA-256
06924d0096abbbed724bdcba94967b12cb5883855e86cc800af17ea30d22df6d.
Después de la auditoría sólo se actualiza este documento; las otras nueve rutas
auditadas se conservan y se comprueban con `post-audit-verify.cjs`.
Este PASS técnico local no es un PASS integral de Coach ni QA.
Evidencia: `/tmp/organizatech-coach-invitation-creation.GWJRlC/`.

La guía Supabase orientó el token verificado, límites de tiempo y ausencia de
reintentos automáticos; se consultaron changelog y referencias actuales getSession,
getUser y abortSignal. No se introducen nuevas capacidades del SDK.
No navegador, Auth real, SQL remoto, QA manual IA, commit/push ni producción.
Migraciones QA requieren el inventario exacto aprobado y un mecanismo de versiones
verificado; esta composición no resuelve ni elude esos requisitos.
