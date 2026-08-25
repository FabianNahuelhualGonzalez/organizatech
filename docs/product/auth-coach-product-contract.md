# Contrato de producto AUTH-COACH

- Estado: aprobado por el dueño de producto
- Versión: 1.1
- Fecha de consolidación: 2026-08-16
- Fuente de verdad: este documento
- Alcance actual: registro Coach, autorización multipportal y portal Coach provisional
- Alcance futuro documentado: correos Coach, vinculación Coach-alumno, funciones Coach, chat y documentos

Este contrato congela las decisiones de producto aprobadas para evitar que una
implementación, auditoría o tarea futura complete vacíos mediante supuestos. Una
decisión marcada como pendiente no se puede implementar sin aprobación expresa
del dueño de producto.

## 1. Identidad, membresías y portales

### AC-001 — Una identidad por persona

Una persona utiliza una sola identidad de Supabase Auth. No se crean dos cuentas
Auth para separar su actividad como Usuario y como Coach.

### AC-002 — Membresías independientes

La misma identidad puede tener membresía Usuario, membresía Coach o ambas. Las
membresías son autorizaciones de negocio independientes y no se infieren desde
la pestaña seleccionada, parámetros de URL, metadata editable ni estado cliente.

### AC-003 — Acceso al portal Usuario

El portal Usuario requiere una membresía Usuario backend vigente. Tener solamente
membresía Coach no concede acceso al portal Usuario.

### AC-004 — Acceso al portal Coach

El portal Coach requiere una membresía Coach backend vigente. Tener solamente
membresía Usuario no concede acceso al portal Coach. El rechazo utiliza el mensaje
aprobado: `Cuenta Coach no registrada. Crea una cuenta Coach para iniciar sesión.`

### AC-005 — Google fuera del alcance actual

Google Login/Registro se implementará en una etapa independiente. No se simula ni
se habilita parcialmente dentro de AUTH-COACH-01.

## 2. Registro y perfil Coach

### AC-006 — Campo profesional canónico

El nombre interno definitivo del campo es `professional_title`. Es obligatorio
para crear la membresía Coach, se almacena como texto libre autodeclarado y no
requiere certificado o documento en esta primera etapa.

Los datos personales comunes pertenecen al perfil común de la identidad. Los
datos profesionales específicos pertenecen al registro o perfil Coach. No se
mantendrá `study_title` como columna paralela ni como alias silencioso.

### AC-007 — Alcance del perfil Coach

El perfil Coach tendrá capacidades administrativas limitadas exclusivamente a
sus alumnos vinculados. No es un rol administrador global de Organizatech.

## 3. Relación Coach-alumno

### AC-008 — Cardinalidad

Un Coach puede supervisar muchos alumnos. Un alumno puede haber tenido distintos
Coaches a lo largo del tiempo, pero sólo puede tener un Coach activo a la vez.
La unicidad activa debe imponerse en PostgreSQL y no solamente en el frontend.

### AC-009 — Autosupervisión

Una persona con ambas membresías puede vincular su perfil Coach con su propio
perfil Usuario. Esta autosupervisión es una relación Coach-alumno normal y ocupa
el único cupo activo. Mientras exista, el Usuario no puede vincularse con otro
Coach.

### AC-010 — Historia sin eliminación

Desvincular no elimina la relación ni sus datos. Cada periodo de vinculación se
conserva con sus fechas, participantes y estado. No se modelará esta historia con
un booleano `active_profile` o `0/1`.

Estados de ciclo de vida previstos:

- `pending`
- `active`
- `unlink_requested`
- `ended`
- `blocked`
- `expired`

La implementación exacta de estas tablas y estados pertenece a una tarea futura.

## 4. Código de vinculación

### AC-011 — Emisión y entrega

El Coach genera un código de vinculación dirigido a un alumno. El sistema lo
envía al correo indicado. El alumno puede abrir el enlace recibido o ingresar
manualmente el código en la sección de su perfil que el dueño diseñará después.

### AC-012 — Propiedades del código

El código será de un solo uso, estará asociado al Coach y al destinatario, tendrá
fecha de expiración y podrá revocarse antes de utilizarse. El código original no
se conservará como secreto legible permanente.

### AC-013 — Activación atómica

Al canjear el código, el backend verifica la identidad autenticada, el destinatario,
la vigencia del código y la ausencia de otro Coach activo. Si el alumno ya tiene
Coach, la vinculación se rechaza. Las invitaciones incompatibles se invalidan
cuando el alumno obtiene una relación activa. Las carreras concurrentes deben
resolverse en PostgreSQL conservando como máximo una relación activa.

## 5. Desvinculación

### AC-014 — Desvinculación inmediata del Coach

Sólo el Coach dispone de la acción normal para desvincular inmediatamente a un
alumno. La acción requiere confirmación y registra actor, fecha y motivo opcional.

### AC-015 — Solicitud del alumno y plazo de 48 horas

El alumno puede solicitar la desvinculación. La solicitud cambia la relación a
`unlink_requested` y fija una fecha autoritativa de término igual a la hora de
PostgreSQL más 48 horas.

Durante el plazo:

- la relación continúa activa;
- Coach y alumno mantienen sus capacidades vigentes;
- el Coach puede finalizar la relación inmediatamente;
- el Coach no puede vetar ni reiniciar el plazo;
- el alumno puede cancelar su propia solicitud antes del vencimiento.

Si la solicitud continúa vigente al cumplirse las 48 horas, el sistema cambia la
relación a `ended`. La ejecución puede ocurrir en el siguiente ciclo del proceso
programado, por lo que el compromiso es "a partir de las 48 horas", no un segundo
exacto controlado por el navegador.

### AC-016 — Bloqueo y soporte

El alumno puede bloquear inmediatamente al Coach por seguridad, suspendiendo su
acceso sin esperar 48 horas. Soporte puede intervenir de forma excepcional y toda
intervención debe quedar auditada.

### AC-017 — Automatización futura

La finalización automática se ejecutará en base de datos mediante una transición
idempotente que sólo afecte solicitudes todavía vigentes y vencidas. Supabase Cron
es la opción prevista, pero no se instala ni configura dentro de AUTH-COACH-01.

## 6. Administración del entrenamiento

### AC-018 — Capacidades del alumno

El alumno conserva las capacidades que tiene actualmente aunque exista un Coach
activo. No se reduce su autonomía sobre su propio entrenamiento.

### AC-019 — Capacidades del Coach actual

El Coach activo puede consultar la información autorizada y administrar el
entrenamiento actual y futuro del alumno. Puede modificar el ciclo activo aunque
haya sido creado por un Coach anterior. Los ciclos cerrados permanecen como
historial.

### AC-020 — Concurrencia y auditoría

Como alumno y Coach pueden modificar el entrenamiento, una implementación futura
debe registrar actor, fecha y versión y evitar sobrescrituras silenciosas entre
cambios concurrentes.

## 7. Acceso después de desvincular

### AC-021 — Conservación sin acceso operativo

Cuando la relación termina no se eliminan perfil, entrenamientos, ciclos, PDF,
chat ni documentos. El antiguo Coach pierde acceso al dashboard actual, al
historial global y a los PDF de entrenamiento mientras la relación permanezca
inactiva, y no puede crear, modificar ni eliminar entrenamientos.

### AC-022 — Reanudación con el mismo Coach

Si la misma pareja vuelve a vincularse, se crea un nuevo periodo de relación y se
restaura el acceso al contexto privado conservado de esa pareja, sujeto a las
reglas vigentes.

### AC-023 — Acceso del nuevo Coach

Un nuevo Coach activo puede consultar el perfil permitido, panel principal,
comparación semanal, ciclo actual, historial de ciclos y PDF de entrenamiento.
Puede administrar el entrenamiento actual y futuro. Nunca accede al chat ni a los
documentos privados compartidos con otros Coaches.

## 8. Chat y documentos

### AC-024 — Chat por relación

El chat pertenece a la pareja Coach-alumno. Después de desvincular, el texto
anterior permanece visible para sus participantes en modo lectura, pero no se
pueden enviar mensajes nuevos. Un Coach diferente nunca puede consultar ese chat.

### AC-025 — Documentos por relación

Los documentos personales se comparten individualmente y sólo con el Coach
seleccionado. Compartir un archivo no comparte la carpeta ni otros documentos.
Un Coach diferente nunca accede a archivos compartidos en otra relación.

### AC-026 — Conservación y suspensión

Los documentos compartidos permanecen almacenados al desvincular, pero su descarga
queda suspendida mientras la relación esté inactiva. Si la misma pareja vuelve a
vincularse, recupera el acceso autorizado previamente.

### AC-027 — Storage privado

Los documentos se almacenarán en un bucket privado. Una autorización permanente
es un permiso persistente registrado en la base, no una URL pública permanente.
Cada descarga futura requerirá autorización vigente y una URL temporal.

### AC-028 — PDF de entrenamiento

Los PDF del historial de entrenamiento forman parte de la información global del
alumno, no de los documentos privados de una pareja. Permanecen almacenados y el
alumno y su Coach activo pueden descargarlos. Un antiguo Coach tiene ese acceso
suspendido mientras esté desvinculado.

## 9. Portal Coach provisional

### AC-029 — Destino Coach independiente

Una autorización `coach_authorized` abre un portal Coach propio y no continúa al
portal Usuario. Una autorización `user_authorized` conserva el portal Usuario.
Si una identidad tiene ambas membresías, se respeta el portal seleccionado de
forma explícita y no existe fallback cruzado.

### AC-034 — Inicio provisional aprobado

El inicio Coach provisional muestra exclusivamente el copy aprobado, el nombre
derivado de `first_name` y `last_name` de `coach_registrations`, y un menú móvil.
`Mi perfil` y `Cerrar sesión` son las únicas opciones funcionales. Las demás
opciones permanecen semánticamente deshabilitadas y no montan pantallas, enlaces,
navegación ni handlers de dominio futuros.

### AC-035 — Perfil Coach de solo lectura

El perfil Coach provisional utiliza la fila autoritativa ya obtenida al autorizar:
`user_id`, `created_at`, `first_name`, `last_name`, `birth_date`, `gender`,
`phone_number` y `professional_title`. El correo visible procede únicamente de
la identidad autenticada y la edad se deriva de `birth_date`; no se almacena ni
se toma de metadata, `profiles` o estado cliente.

No se habilitan edición, avatar, writes, policies, RPC ni migraciones para este
perfil. La navegación de regreso utiliza el control canónico de la aplicación.

### AC-036 — Funciones previstas posteriores

El portal Coach futuro incluirá, bajo autorización y RLS:

- perfil profesional Coach;
- búsqueda únicamente entre alumnos propios;
- alumnos activos, pendientes y desvinculados;
- vinculación y desvinculación;
- perfil permitido del alumno;
- panel principal y comparación semanal;
- ciclo actual e historial de ciclos;
- creación y modificación de entrenamiento;
- descarga de PDF de entrenamiento;
- mensajería;
- documentos compartidos individualmente.

Estas funciones están especificadas para orientar el modelo, pero no están
autorizadas para implementarse anticipadamente desde el shell provisional.

## 10. Correos Coach futuros — AUTH-COACH-02

AUTH-COACH-01 no envía correos Coach adicionales ni agrega proveedores,
dependencias, variables de entorno, funciones o plantillas ejecutables. La
confirmación normal de Supabase Auth para una identidad nueva se conserva.

AUTH-COACH-02 implementará entrega exactamente una vez desde un evento backend
idempotente. Los reintentos no duplicarán el correo y una falla de entrega no
revertirá la membresía ya creada.

### AC-037 — Identidad existente agrega Coach

Asunto: `Ahora también eres Coach en Organizatech`

```text
Hola, {nombre}:

Ya estabas registrado como Usuario y ahora también eres Coach en Organizatech.

Muchas gracias por seguir confiando en nosotros. Esperamos acompañarte y ayudarte a seguir desarrollándote profesionalmente.

Equipo Organizatech
```

### AC-038 — Persona nueva crea cuenta Coach

Este correo se envía sólo después de la confirmación normal de Supabase Auth.

Asunto: `Bienvenido a Organizatech Coaching`

```text
Hola, {nombre}:

Tu cuenta Coach fue creada correctamente.

Muchas gracias por confiar en nosotros. Esperamos acompañarte y ayudarte a seguir desarrollándote profesionalmente.

Equipo Organizatech
```

### AC-039 — Crear cuenta Coach rechaza una membresía Coach existente

`Crear cuenta Coach` autentica primero de forma autoritativa el correo solicitado y
consulta después la membresía Coach own-only ligada exclusivamente al `user_id` de
esa identidad. Si la fila ya existe, el flujo termina sobre `register-email` con el
mensaje exacto: `Este correo ya se encuentra registrado como Coach. Intente con otro correo.`

La regla se limita al registro: `Iniciar sesión Coach` continúa autorizando una fila
Coach propia y una identidad Usuario-only autenticada puede agregar su primera
membresía Coach. Una contraseña incorrecta no permite consultar ni revelar la
membresía y conserva el mensaje genérico aprobado para una identidad ya registrada.

El rechazo no crea ni actualiza filas, no activa ni aplica sesiones, no navega ni
monta el portal, no envía correos y no ejecuta `signOut` local o global. Los campos
del nuevo intento, incluido `professional_title`, se descartan y la fila anterior
permanece lógica y materialmente intacta.

En el incidente observado no se creó una segunda cuenta Coach y la fila existente
no fue sobrescrita. La idempotencia de `register_own_coach` permanece como defensa
backend ante concurrencia, pero la UI de registro no puede convertir esa defensa en
autorización, activación o navegación.

## 11. Seguridad obligatoria

### AC-030 — Autoridad backend

La autorización se deriva de datos backend autoritativos. Query params, pestañas,
metadata editable, formularios y objetos cliente nunca conceden membresías,
ownership ni relaciones.

### AC-031 — Ownership y allowlists

Todo write utiliza allowlist explícita. El frontend no puede proporcionar ni
modificar `user_id`, `coach_id`, `student_id`, `owner_id`, `profile_id`, roles o
campos equivalentes de ownership.

### AC-032 — RLS y restricciones

Las tablas expuestas deben usar RLS, políticas por identidad, privilegios mínimos
y restricciones de base de datos. La regla de un solo Coach activo debe sobrevivir
peticiones concurrentes y clientes manipulados.

### AC-033 — Trazabilidad

Vinculaciones, solicitudes, desvinculaciones, bloqueos, cambios de ciclos y acciones
administrativas futuras deben conservar actor, fecha y estado resultante.

## 12. Decisiones pendientes

No se pueden completar mediante supuestos:

- duración exacta de los códigos de vinculación;
- contenido y diseño de correos distintos de las dos plantillas Coach aprobadas;
- ubicación y diseño de la casilla para ingresar el código;
- significado de eliminar un chat: sólo para quien lo elimina o para ambos;
- procedimiento excepcional para retirar un documento compartido por error,
  exigencia administrativa o eliminación de cuenta;
- modelo operativo y permisos del soporte que intervenga en desvinculaciones;
- detalle visual de las funciones futuras del portal Coach;
- URLs permanentes de los frames aprobados de Figma.

## 13. Fuera del alcance de AUTH-COACH-01

- tabla de relaciones Coach-alumno;
- códigos o correos de vinculación;
- Supabase Cron;
- panel, entrenamiento, comparación, ciclos, calendario, mensajes y demás funciones Coach;
- envío de los correos Coach documentados para AUTH-COACH-02;
- chat y mensajería;
- documentos y Storage;
- Google Login/Registro;
- cambios en `training_sessions` o `exercise_entries`;
- ejecución de SQL en QA o producción.

## 14. Gobierno del contrato

- Sólo el dueño de producto puede aprobar o cambiar decisiones.
- Cada tarea debe citar los IDs AC que implementa y los que mantiene fuera de alcance.
- Claude debe auditar contra este documento y no completar silenciosamente vacíos.
- Un cambio de producto se documenta antes de modificar código o SQL.
- El roadmap registra estado; no modifica las reglas de este contrato.
- Las referencias visuales deben usar enlaces permanentes a Figma o archivos
  versionados, nunca rutas temporales del sistema operativo.
