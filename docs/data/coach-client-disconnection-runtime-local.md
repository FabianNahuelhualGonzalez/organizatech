# Desvinculación Coach — controller y runtime aislados

Estado: CÓDIGO, VALIDACIONES LOCALES Y AUDITORÍA INDEPENDIENTE PASS para este lote.
Coach completo, sus migraciones y QA manual siguen pendientes.

## Alcance

Conecta únicamente las RPC existentes de cancelar solicitud, terminar vínculo,
leer esos recursos y reconciliar un request. No crea solicitudes, acepta alumnos,
envía correos, elimina entrenamientos, altera pagos ni agrega SQL. La selección
es explícita por tipo e ID y no se infiere del correo ni de una fila comercial.

El controller puro reside en `coach-clients/hooks`; la composición SDK y proyección
mínima en `coach-clients/integration`. Configuración pública y principal existente
son inyectados; no lee env, storage ni crea otra sesión de Auth. Reutiliza la
captura autenticada, allowlists, validadores de DTO y deadline total del repository.

## Invariantes

- Leer y abrir/cerrar la confirmación nunca escriben. Confirmar es explícito.
- Cancelar una solicitud pendiente o vencida no termina ningún vínculo. Una
  solicitud aceptada no se convierte implícitamente en otro tipo de operación.
- Terminar un vínculo requiere el episodio seleccionado aún activo; el servidor
  conserva el episodio y sus fechas, sin borrar el historial del alumno.
- Un requestId por intento; doble pulsación no duplica. Reintentos explícitos
  requieren reconciliar y conservan el ID/cuerpo original. Nunca retry automático.
- Recibo y estado actual son hechos distintos: un recibo válido requiere leer
  después la solicitud cancelada o vínculo cerrado antes de declarar resolución.
- No expone código de invitación, nombre, correo ni actividad en el controller.
- Cambios de cuenta, generación o selección invalidan permanentemente el runtime;
  respuestas tardías no publican resultados. Dispose no equivale a rollback remoto.

## Verificación

Pruebas unitarias del controller y pruebas del SDK instalado con TODO fetch/Auth
interceptado en un dominio `.invalid`. Cubren ambos tipos, allowlists, recursos
incorrectos, estados no cancelables, concurrencia, abort, timeout, reconciliación,
datos obsoletos y ausencia de filtración de identidad/código en snapshots.
Logs y hashes: `/tmp/organizatech-coach-disconnection-root.OAcbOG/`.

Gates ROOT secuenciales terminados (sesión22100, exit0): invitaciones88
(controller32 + runtime16 + regresión40), pagos84, dominio144, npmtest completo
(pre/main/posttest), lint, build, typecheck y diff. Ningún proceso pendiente.
Los cinco archivos DOMAIN se transfirieron con inventario final y hash idéntico;
el contrato b2e7c258... ya estaba integrado y no se reescribió.

Auditor GPT-5.6 Sol, esfuerzo medio, READ-ONLY: PASS sin hallazgos HIGH/MEDIUM/LOW
verificables. Ejecutó focal88 y diff propios; verificó10hashes/5protegidos/8logs,
baseline, branch/HEAD y stash. Los gates globales se inspeccionaron como evidencia,
no se atribuyen como ejecución propia al auditor. Informe `sol-audit.md` y manifest
inmutable SHA504804a1... en el directorio de evidencia. Sólo dos documentos de
estado se reconciliaron después; `post-audit-integrity.json` conserva sus hashes
finales y comprueba ocho archivos de código/contrato/tests/config sin cambios.

Clasificación: **Sin cambio visible**; no monta ni conecta UI productiva. El caller
de una futura integración visible deberá disponer este runtime y refrescar cartera
al recibir una resolución confirmada, usando requestId como identidad estable.
No promete revocación de acceso de consumidores todavía no conectados a estos
episodios: ese gate de integración y seguridad sigue pendiente en el producto.

## Límites

Sin commit/push, navegador, QA manual, correos, usuarios reales ni SQL remoto.
Las tres migraciones preparadas previamente siguen pendientes de autorización
exacta para QA. Este bloque no implica QA Coach completo, no valida diseño Alumno
aplazado y no permite producción. El dueño conserva commit y pruebas manuales.
