# Coach — contrato previo de invitaciones y revocación

Estado: preparación técnica local de la actividad autorizada. No es una migración
ejecutada, API existente, decisión nueva de producto ni aprobación de QA.
La aceptación visible en el perfil del alumno permanece aplazada expresamente.

## Base local verificada

Base aprobada `00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`:

- `supabase/schema.sql`: perfil común ligado a `auth.users.id`.
- `supabase/migrations/20260816020743_auth_coach_multiportal_authorization.sql`:
  `coach_registrations.user_id` identifica membresía Coach y lectura propia.
- `supabase/migrations/20260816073510_auth_user_multiportal_authorization.sql`:
  `user_registrations.user_id` es autoridad Usuario independiente; crear perfil
  común no equivale a crear esa membresía.
- `supabase/migrations/20260826041258_auth_separate_coach_contact_email.sql`:
  contacto profesional separado de identidad/ownership. RPC de registro propio,
  no creación de relaciones entre personas.

Inventario read-only de schema/migrations no encontró persistencia ni RPC de
vínculos/invitaciones Coach. Existen emails de Auth y Calendario, pero no prueban
un envío ni una aceptación de relación Coach. Esto no es una inspección remota.

## Fronteras

Invitar no vincula, no descubre una cuenta por correo y no concede acceso a
entrenamientos. Aceptar requiere el futuro actor Alumno y consentimiento explícito.
Cancelar una invitación invalida su código; desvincular cierra un vínculo existente.
Ninguna de estas acciones borra rutinas, sesiones ni ejercicios del alumno.

El registro Coach identifica al dueño de su cartera, no sustituye la autorización
del alumno. Su `contact_email` profesional tampoco acredita propiedad de una
cuenta Usuario. El frontend no envía ownership ni puede marcar aceptación,
entrega de correo, fecha de vinculación, fecha de baja o estado de otra cuenta.

Separar al menos estas responsabilidades de persistencia, sin fijar todavía
nombres de tablas/endpoints definitivos:

1. Invitación propia: destinatario normalizado, emisión/expiración del servidor,
   estado, versión y material de código sólo recuperable por su dueño autorizado.
2. Episodio de vínculo: Coach y Alumno acreditados, aceptación y revocación.
   Un único episodio activo por alumno respaldado por constraint/índice único,
   no sólo por consultas previas o estado del navegador.
3. Operación de envío: identidad idempotente, reserva de cuota, estado de
   procesamiento y confirmación de proveedor. Separada de la invitación.

Sin grants directos amplios. Ownership, RLS y allowlists son obligaciones del
servidor; campos privados de tarifa siguen fuera de cualquier proyección Alumno.
La existencia de un vínculo nunca amplía automáticamente RLS de entrenamiento.

## Código y tiempos confirmados

- Formato visual LLd-LLd-LLd con el alfabeto aprobado sin I/O/0/1. Generación
  aleatoria segura exclusivamente servidor, no secuencia ni identificador de
  cuenta. Normalizar guiones/letras no corrige ni adivina caracteres ambiguos.
- Expiración a siete días desde emisión según reloj de servidor, no el teléfono.
  Un reenvío no extiende esa expiración ni cambia silenciosamente el código.
- Código recuperable desde detalle propio pendiente según handoff, no público,
  no disponible a otros coaches ni incluido en logs/errores/telemetría.
- Al expirar no reenviar ni aceptar. La recuperación visible de expirados y
  su copy necesitan resolver el detalle pendiente del handoff antes de conectarlos.
- Hasta tres nuevas reservas de reenvío en ventana móvil de veinticuatro horas,
  separadas sesenta segundos, contando el envío inicial para el primer intervalo.
  Misma operación lógica no es una reserva nueva. Fallo o respuesta incierta
  del proveedor no libera automáticamente cuota ni duplica la operación.

## Concurrencia e idempotencia

Validar ownership/estado/expiración y reservar cuota en una transacción corta.
Orden uniforme de locks; unicidad de operación por actor y requestId, con
comparación de payload para impedir reutilizar una clave para otro destinatario.
Lectura posterior de estado reconcilia un timeout antes de ofrecer otro envío.

Evitar mantener locks durante HTTP al proveedor. La cola/operación se confirma
localmente y el despacho ocurre con su propio contrato; una reserva no autoriza
a mostrar el paso «correo enviado». Si se usa worker, sus permisos/capacidad
deben ser específicos de este flujo, no secretos reaprovechados de Auth/calendario.
Su configuración y despliegue requieren el alcance aprobado correspondiente.

Cancelar y aceptar deben serializarse contra la misma invitación. Desvincular
y cualquier futura lectura compartida deben consultar la revocación actual,
no una autorización capturada indefinidamente en caché o JWT. Reinvitar abre
una solicitud nueva, no reactiva ni hereda un consentimiento anterior.

No hacer lookup global de alumno por email ni revelar si ya tiene otro Coach al
invitar. La futura aceptación debe acreditar destinatario y unicidad sin filtrar
información del otro Coach. No habilitar ese consumidor hasta su fase autorizada.

## Resultados que la UI puede afirmar

| Evidencia del servidor | Resultado permitido |
| --- | --- |
| Solicitud reservada/encolada | Operación pendiente, sin recibo de envío |
| Proveedor aceptó | Recibo de envío aceptado; no prometer llegada al buzón |
| Confirmación de entrega verificada | Entrega confirmada |
| Fallo confirmado | Error recuperable con estado real y sin éxito optimista |
| Timeout/resultado ambiguo | Reconciliar la misma operación, no duplicar envío |
| Cancelación/revocación confirmada | Actualizar cartera y cerrar con confirmación real |

El `CoachClientInvitationReceiptView` ya distingue aceptación del proveedor de
entrega. Los callbacks de copiar/WhatsApp son intenciones, no prueba de éxito;
la integración reportará éxito sólo después de la acción correspondiente.
«Ir a mi lista» usa la pestaña Pendientes tras invitación confirmada, no una
fila ficticia añadida como resultado de pulsar Enviar.

## Condiciones antes de ejecutar el siguiente lote de persistencia

- Verificar esquema e identidad canónica en la base aprobada; no asumir que
  endpoints del handoff o un correo Auth de invitación crean una relación Coach.
- Congelar DTO mínimos propios, paginación/contadores autoritativos y writes
  allowlisted. Una página parcial no representa la cartera completa.
- Definir límites antiabuso para creación de invitaciones además de los reenvíos
  ya aprobados. No inventar topes de clientes ni política comercial.
- Mantener pendientes fuentes de actividad/ciclo/constancia, alcance exacto de
  datos compartidos y conservación de identidad histórica tras revocación.
  Registrar vínculo no concede lectura general de perfiles o entrenamientos.
- Resolver destino real del enlace y contrato de correo sin publicar enlaces
  a una pantalla de perfil que todavía no se ha implementado.

Pruebas locales exigidas: ownership cruzado, anon/usuario sin Coach, allowlists,
expiración exacta, cooldown/límite exactos, duplicados lógicos, carrera de reenvío,
cancelación concurrente, aceptación futura por destinatario/únicoCoach, revocación,
timeout y retorno tardío, proveedor aceptado distinto de entregado, ausencia de
datos privados en respuestas. SQL debe probarse localmente antes de auditoría;
remoto sólo con inventario/hash/destino QA y autorización de esa ejecución.
