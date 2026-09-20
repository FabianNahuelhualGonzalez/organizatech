# Contratos de integración — Coach dashboard y clientes

Estado actualizado 16-09-2026: componentes, modelos y repositorios preservados
se integran en el portal Coach mediante `CoachWorkspaceBoundary` y controllers de
feature. El composition root sólo entrega sesión, generación de identidad y
navegación global; no contiene consultas, reglas ni UI extensa de estas features.
El montaje local no equivale a Preview, QA manual ni migración aplicada.

La creación de invitación disponible en esta cadena reserva invitación/código,
pero no existe dispatcher ni recibo del proveedor de correo. Por eso la UI no
anuncia “enviado” y conserva el paso de correo con un estado explícito. Tampoco
se implementa la pantalla de alumno para ingresar el código: sigue bloqueada por
la decisión visual pendiente registrada por producto.

La composición conserva una intención incierta y expone conciliación/reintento
del mismo requestId; sólo rota el controller después de cerrar un resultado
resuelto. Activos y pendientes conservan paginación por cursor mediante una
acción controlada `Cargar más`, sin derivar totales desde las filas visibles.
Reenvío y regeneración aplican el mismo criterio: una intención incierta bloquea
cierre y cancelación, y sólo una lectura autoritativa permite resolverla o
reintentar exactamente su requestId, acción y generación originales.

## Propiedad de cada capa

| Capa | Responsabilidad | Nunca hace |
| --- | --- | --- |
| data | Leer DTO validado y guardar allowlists por operación, con identidad capturada | Formatear dinero, UI, aceptar ownership del formulario |
| model | Cartera, dinero CLP, política de invitación y borrador comercial puros | React, Supabase, reloj implícito, acceso a otros usuarios |
| hooks | Estado de pantalla y solicitud, generación de sesión, cancelar y confirmar | Calcular métricas nuevas o otorgar permisos |
| integration | DTO → dominio → view-model y callbacks habilitados | Sustituir desconocido por cero o inventar datos |
| components | Presentación controlada, accesibilidad e intenciones | Consultar servidor, inferir estado comercial, guardar al cerrar |
| composition root | Conectar la entrada pública con sesión/navegación existentes | Formularios, reglas, consultas o un store universal |

No se copiarán carpetas de los worktrees ni se importarán rutas absolutas de otros
entornos. Antes de integrar: inventario exclusivo congelado, validaciones, revisión
de dependencias y checkpoint o transferencia explícita aprobada. `package.json`,
root y wiring compartido quedan reservados al coordinador.

## Preferencias privadas

Contrato del primer lote de persistencia local:

- `read_own_coach_dashboard_preferences()` devuelve `monthlyFeeClp: number|null`,
  `version: number`, `chatInterestRegistered: boolean`.
- `save_own_coach_dashboard_fee(p_monthly_fee_clp, p_expected_version)` devuelve
  tarifa/version confirmadas. Versión esperada evita sobrescribir otra edición.
- `register_own_coach_chat_interest()` es idempotente; no cambia la versión de
  tarifa. Registrar interés no afirma que se haya enviado una notificación.
- Ownership se resuelve en servidor por `auth.uid()` y registro Coach real.
  No aceptar `user_id`, `owner_id`, `coach_id` ni datos del alumno en los writes.
- Adaptador de transporte ligado a la identidad capturada, no Auth mutable.
  Invalidar resultados tardíos al cerrar sesión/cambiar de cuenta; no despachar
  una edición anterior con la sesión de otra persona.
- El adaptador SDK recibe sólo configuración pública aprobada y principal
  existente. `accessToken` fija el token validado sin inicializar otro cliente
  Auth; cada RPC usa POST, retry deshabilitado y el mismo deadline de captura.
  No conectar formulario alguno a URL/clave/configuración del transporte.

Sólo se cierra Guardar con respuesta válida, no al iniciar la petición. Un error
o conflicto no sustituye el valor confirmado ni se presenta como guardado. Los
estados de recuperación y sus textos visibles deben respetar el diseño aprobado.
Null sin configurar no es cero confirmado; vacío de edición no puede convertirse
silenciosamente en una tarifa persistida de cero.

El puerto parseFee se implementará con `parseCoachMonthlyFeeInput` del dominio:
enteros CLP sin agrupación o miles con puntos bien formados. No usar parseInt ni
quitar indiscriminadamente caracteres; `35.000` no puede terminar guardado como35.
El símbolo $ ya está fuera del input. Preservar el string crudo mientras se edita;
parsear para validación/persistencia no autoriza reescribir el campo en cada tecla.
Vacío y agrupación incompleta son null, no valor anterior confirmado ni cero.

`CoachPreferencesSource` es un puerto del consumidor/controller, no otro cliente
de base de datos. Su implementación debe ser el repository de DATA validado y
acotado; no pasar JSON remoto crudo ni copiar módulos entre worktrees. El factory
del controller recibe parser de tarifa del dominio e `isCurrent` de la generación
actual. Crear uno por cuenta/portal/generación y llamar `dispose` al reemplazarlo.
El controller no hace logout ni resuelve autorización: SQL y DATA siguen siendo
las fronteras de acceso. Un resultado forbidden/stale limpia preferencias y hojas,
sin dejar indicador de operación pendiente ni exponer mensajes remotos.

Existe un solo envío de preferencias a la vez. Busy bloquea dobles submits,
edición/cancelación durante el write y lectura concurrente que lo pudiera pisar.
Un error mantiene el borrador sin anunciar guardado y exige lectura confirmada
antes de permitir otro write. La reconciliación actualiza baseline/version pero
no sobreescribe el borrador ni reintenta automáticamente. Cerrar una hoja no guarda.
La UI integrada ofrece recuperación explícita y no deja un botón bloqueado sin
explicar la causa. Los tests puros del controller no sustituyen el contrato del wiring.

## Dinero y datos desconocidos

`calculateCoachDashboardMoney` produce importes estimados (no cobros). Recibe
tarifa, activos, alertas y pendientes, cada uno nullable. `formatCoachClpAmount`
formatea CLP entero o devuelve null. El mapper conserva esa diferencia en
`CoachMetricView {value, label}`: el label no autoriza cambiar el valor.

`calculateCoachRenewalAmountInPlay` suma renovados + pendientes, excluye quienes
no renuevan. No inferir pagos reales ni reconstruir histórico con la tarifa
actual. Ambas funciones anteriores se conservan como proyecciones legacy.
Para las tarjetas nuevas se usa `calculateCoachCommercialMoney`: activos aceptados
como base estimada, invitaciones como potencial hipotético aparte, bajas/no-sigue
explícitos como pérdida estimada y pagos confirmados como agregado propio, nunca
cantidad multiplicada por tarifa. Un mes cerrado conserva tarifa y cartera de su
snapshot; esa persistencia histórica sigue pendiente. Si no hay fuente autorizada,
importe, gráfico o constancia deben mantenerse desconocidos, no mock productivo.

Una distribución total cero o desconocida no dibuja proporciones ficticias.
El mapper genera `stack: null`; la UI también ignora segmentos de ratio cero.
Esto no debe ocultar un importe conocido de cero en la tarjeta.

## Cartera y clientes

- `active`: relación aceptada; `cycle: null` no significa desvinculado.
- `pending`: invitación, email permitido, sin descubrimiento de nombre, iniciales,
  actividad o datos de una cuenta buscada por correo; tampoco en ARIA.
- `inactive`: identidad previamente consentida según proyección autorizada;
  ninguna actividad nueva después de revocación. Cancelar invitación no crea baja.
- Búsqueda, contadores y vacíos derivan de cartera propia autorizada, no de toda
  la base. No derivar total de una página de resultados parciales.
- La UI recibe filas discriminadas y fechas/etiquetas preformateadas; `pending`
  no puede contener `name`, `initials` ni `progressRatio`.
- Los callbacks de cartera se habilitan individualmente. Tener activos/pendientes/
  bajas disponibles no habilita En alerta sin fuente y destino aprobados.
- Volver reutiliza navegación contextual, icono canónico y nombre accesible.
  Ver ciclo no se conecta a edición del alumno en este lote: el dueño aprobó la
  capacidad futura del Coach, pero aplazó ese diseño de historial/gestión.

Al cerrar el detalle después de una mutación, la fila puede haberse reconstruido
o cambiado de pestaña. El controller debe resolver el destino actual por id de
relación/invitación y enfocar esa fila o su tab de respaldo después del cierre.
Cambiar `restoreFocusRef.current` no basta: el motor canónico toma una instantánea
al abrir. No duplicar ni modificar ese motor. Probar también cerrar confirmación
anidada (vuelve al detalle aún montado), cierre sin mutación y destino eliminado.

## Renovación comercial

El borrador distingue baseline, override crudo y fechas. Cancelar el modal restaura
exactamente su snapshot, incluido `null` (sin marca Coach); cancelar la hoja
descarta todo el borrador. Sólo Listo válido produce la intención de guardar.
La procedencia se resuelve junto con el estado; no atribuir una decisión cancelada.
Guardar renovación comercial nunca crea/finaliza un ciclo de entrenamiento.

Acuerdo posterior del dueño: período pagado mensual y ciclo de entrenamiento son
independientes. El Coach introduce las fechas de inicio y término del pago; no
aplicar seis semanas de la maqueta ni fechas del ciclo como renovación comercial.
El fin es inclusivo, posterior al inicio; un período nuevo empieza después del
último fin pagado. Corregir un período conserva su identidad y no cruza vecinos.
El borrador conserva las fechas crudas; aceptar el modal anidado aún no guarda.

Persistencia y repositorio de períodos pagados son módulos separados con cuatro
RPC: confirmar, corregir, leer último período registrado y reconciliar operación.
La versión CAS es opaca y requestId identifica una intención explícita. Un resultado
incierto se reconcilia con el mismo requestId; no repetir writes automáticamente
ni convertir un recibo histórico en estado actual. Ownership y vínculo activo se
validan en servidor. El repositorio no procesa dinero, envía avisos ni toca rutinas.
El mapeo de renovación pending/declined, fuentes de cartera, consumidor de sesión,
binding Guardar/Listo y snapshots mensuales siguen pendientes; no fabricar baseline
para presentar este lote como flujo terminado.

## Separación de gates

Los tests focales de UI/model/data no constituyen PASS integrado. Se requieren
suite completa, lint, typecheck, build, pruebas SQL locales cuando corresponda y
auditoría independiente sobre inventario congelado. No abrir navegador por IA.

Publicación y QA manual corresponden al dueño. SQL remoto necesita inventario,
hashes, dependencias, recuperación y autorización exacta para QA, nunca PROD en
este alcance. Perfil/aceptación del alumno siguen aplazados expresamente: no
afirmar recorrido extremo a extremo PASS sin ese consumidor.
