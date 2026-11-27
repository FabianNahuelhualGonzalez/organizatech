# Ficha del alumno vinculado — propuesta de producto y permisos

Estado: cinco migraciones aplicadas a BBDD QA el 2026-11-26; interfaz local pendiente de despliegue y QA funcional/visual. Producción no modificada.
Base: `codex/coach-student-record-v1` desde `origin/qa` (`a3520d4`).

## Objetivo y punto de entrada

Desde `Panel Coach > Alumnos > alumno activo > detalle`, abrir una pantalla
`Ficha del alumno`. Se conserva la ficha comercial existente en el detalle.
La ficha agrupa sólo datos de ese alumno autorizados al Coach actual. Un alumno
pendiente o desvinculado no puede abrirla. No se agregan accesos al menú global.

## Alcance visual propuesto para aprobación

| Tipo | Alta o modificación exacta |
| --- | --- |
| Button | Reutilizar el acceso existente `Ver su ciclo y rutinas` del detalle activo como `Abrir ficha del alumno`; habilitarlo para abrir la ficha. |
| Section | Nueva pantalla `Ficha del alumno`, con nombre autorizado, estado del vínculo y las secciones `Entrenamiento`, `Evaluaciones`, `Documentos compartidos` y `Fotos de check compartidas`. |
| Button | `Crear primera rutina y ciclo`, `Crear rutina`, `Modificar rutina`, `Quitar rutina del ciclo` y `Volver al ciclo vigente` dentro de Entrenamiento; deshabilitar escrituras cuando el ciclo esté cerrado o haya cambiado. |
| Button | `Enviar evaluación` reutiliza la selección de plantilla y envío manual existentes; `Ver respuesta` abre una evaluación completada del alumno seleccionado. |
| Button | `Abrir PDF` sólo en documentos médicos compartidos. `Ver foto` sólo en fotos autorizadas. El PDF completo del historial de entrenamiento queda pendiente de su fuente de sesiones y métricas. |
| Checkbox | En cada foto del check del alumno: `Compartir con mi coach`, inicialmente desmarcado. El alumno puede marcarlo o desmarcarlo individualmente. |
| Modal | Confirmación para `Quitar rutina del ciclo`, con indicación de que el historial permanece; visor de una foto compartida. |
| Card/Drawer | Ninguno nuevo en esta propuesta. |
| Eliminaciones | Ninguna. |

Wireframe textual previo (estructura, no especificación de estilos):

```text
Panel Coach > Alumnos > [alumno activo] > detalle
  [Abrir ficha del alumno]

Ficha del alumno                                [Volver]
  [Nombre autorizado] · [Vínculo activo]
  Entrenamiento
    [Ciclo actual] [Crear rutina] [Modificar rutina] [Quitar rutina del ciclo]
    [Historial de ciclos] [Volver al ciclo vigente]
  Evaluaciones
    [Enviar evaluación] [Enviada / Respondida] [Ver respuesta]
  Documentos compartidos
    [PDF médico autorizado] [Abrir PDF]
  Fotos de check compartidas
    [Fecha del check] [Foto autorizada] [Ver foto]

Alumno > Fotos de progreso > Mis checks
  [Fecha del check]
    [Foto frente]  [ ] Compartir con mi coach
    [Foto perfil]  [ ] Compartir con mi coach
    [Foto espalda] [ ] Compartir con mi coach
```

El control de regreso usa `AppBackButton`. Los estados vacío, carga, fallo y
vínculo terminado no muestran datos previos de otra selección o sesión. El texto
final, geometría y estados visuales se revisan antes de conectar la pantalla.

Aprobación previa de producto para la conexión visual: dueño de Organizatech,
2026-11-26, respuesta «avanza» en este hilo a la solicitud explícita de aprobar
el alcance y el wireframe documentado de esta ficha para el segundo PR hacia QA.
La aprobación final después de revisar Preview, capturas y QA mobile continúa
pendiente. El PDF completo del historial de entrenamiento y el alta de ejercicios
personalizados no forman parte de este segundo PR.

## Datos y comportamiento

- **Identidad y perfil:** nombre y correo ya autorizados por la proyección de
  vínculo; fecha de vinculación. Cualquier otro dato personal requiere allowlist
  y aprobación propia. La ficha comercial existente conserva su ownership.
- **Entrenamiento:** el Coach activo puede leer ciclo actual, rutinas, historial
  y PDF de entrenamiento del alumno; crear y modificar rutinas vigentes. Quitar
  una rutina la retira del ciclo vigente sin borrar entrenamientos ni historia.
  Los ciclos cerrados son sólo lectura. Alumno y Coach conservan acceso a editar
  durante el vínculo; un write registra actor, fecha y versión y rechaza conflictos.
- **Anamnesis / evaluaciones:** reutilizar las plantillas, envío manual y
  respuestas completadas de `Evaluaciones`. El Coach decide qué plantilla
  enviar al alumno nuevo; no hay envío automático ni cuestionario duplicado.
  Las respuestas sensibles siguen sujetas al consentimiento existente. En la
  ficha se filtran por alumno/episodio autorizados en backend.
- **PDF:** distinguir PDF del historial de entrenamiento (del alumno y su Coach
  actual) de documentos médicos compartidos individualmente para el Coach de
  ese episodio. La descarga revalida el vínculo y el permiso del archivo.
- **Fotos de check:** cada foto empieza privada; el alumno autoriza o revoca
  acceso a su Coach activo con una casilla individual. Sólo las fotos autorizadas
  aparecen en la ficha. Revocar oculta la foto y bloquea nuevas lecturas de
  inmediato, incluso si figuraba en un reporte enviado. El reporte y su texto
  permanecen como registro sin conceder acceso a un archivo revocado. Los blobs
  que alguien haya descargado previamente no pueden retirarse de su dispositivo.
  Una autorización de un vínculo anterior no se transfiere a un Coach nuevo.

## Autorización y aislamiento

Toda lectura y escritura cruza una comprobación de identidad autenticada,
membresía Coach, relación activa con el alumno y permiso específico del recurso
en backend. Un ID aportado por el cliente no concede acceso. El cliente sólo
envía campos permitidos y nunca cambia `user_id`, `owner_id`, `profile_id` ni
equivalentes. El cambio de alumno, sesión, desvinculación o revocación invalida
las respuestas y vistas pendientes. Las fotos y documentos siguen en storage
privado y cada lectura revalida autorización, sin URLs permanentes.

## Implementación secuenciada

1. Contratos y pruebas locales de lectura de ficha por vínculo activo, incluidas
   respuestas de Evaluaciones, documentos compartidos y PDF de entrenamiento.
2. Mutaciones locales de entrenamiento por Coach con actor, versión y
   concurrencia; conservar historia al quitar una rutina.
3. Permiso individual de fotos y cierre de cualquier camino de lectura por
   reporte tras revocación; pruebas de vínculo terminado y Coach nuevo.
4. UI según el wireframe aprobado, separada de la infraestructura, sin lógica de
   dominio ni queries en `organizatech-app.tsx`. QA visual y funcional del dueño.

Las migraciones versionadas se prepararon localmente y se aplicaron a la BBDD QA
existente por indicación del dueño. Producción queda fuera de esta etapa.

## Comprobaciones de aceptación

- Coach A ve y modifica únicamente entrenamiento vigente de su alumno activo;
  Coach B y el Coach desvinculado reciben rechazo backend.
- Crear, modificar o quitar una rutina no modifica el historial cerrado. Una
  versión antigua no sobrescribe cambios del alumno o de otro dispositivo.
- Una evaluación existente del alumno muestra sus respuestas consentidas sin
  crear un segundo sistema de preguntas.
- Cada PDF visible requiere permiso vigente al abrirlo; un documento privado
  o de otra relación no aparece.
- Una foto privada nunca aparece al Coach. Autorizar una foto no comparte las
  demás; revocarla bloquea una nueva lectura, incluso desde un reporte antiguo.
- Cambiar de alumno o cerrar sesión no conserva datos sensibles de la ficha.

## Estado técnico verificado al redactar

- El detalle Coach aún construye `cycle: null` y no conecta `onOpenCycle`.
- Evaluaciones ya crea plantillas, permite escoger destinatarios vinculados,
  enviar manualmente y ver respuestas completadas con consentimiento sensible.
- El alumno crea checks y selecciona fotos para enviar un reporte; no existe
  una casilla persistente y revocable por foto. La bandeja Coach ya lee reportes.
- El PDF del historial de ciclos se genera y descarga en el cliente desde el
  detalle del historial; no hay evidencia de un PDF persistido para reutilizar.
  La ficha necesitará una lectura autorizada de los datos para generarlo.
- El backend tiene una función para listar documentos médicos compartidos de un
  alumno con vínculo activo; falta la presentación en su ficha.

Nota de compatibilidad de la migración de fotos: los reportes anteriores de
fotos aún existentes se reconocen como autorización previa del alumno. Una foto
ya eliminada no se vuelve a compartir ni a descargar desde esos reportes; su
texto permanece. Un nuevo envío seleccionando fotos autoriza las seleccionadas,
pero reintentar un mismo envío nunca restaura un permiso revocado.

## Avance local del 2026-11-25

- Preparados dos archivos de migración locales: sujeto y lectura de Evaluaciones
  por episodio activo; permiso individual de fotos y cierre de lectura por
  Storage/reporte al revocar. El dueño ejecutó la prueba contra PostgreSQL
  aislado local: `COACH_STUDENT_RECORD_LOCAL_POSTGRES=PASS (17 checks; Unix socket only)`.
- Preparados los gateways del alumno para consultar y cambiar permisos de fotos;
  el lector de Evaluaciones Coach por episodio; y la compatibilidad del parser
  de reportes con un reporte cuyo contenido quedó sin fotos autorizadas.
- Todo sigue desconectado de la UI. Pendientes: revisión final del diff;
  permisos y mutaciones Coach de entrenamiento; lectores de documentos/PDF;
  conexión visual en un cambio separado con QA manual del dueño.
- La prueba local monta un esquema sintético mínimo y aplica las dos migraciones;
  no reproduce toda la cadena histórica ni el servicio Storage desplegado.
  No aplicar migraciones ni promover a QA/PROD basándose sólo en este resultado.
- Las funciones de ciclo actuales comprueban `p_user_id = auth.uid()` incluso
  cuando `p_portal_scope = 'coach'`. Las nuevas lecturas y mutaciones delegadas
  requieren autorización por episodio activo y actor explícito en backend;
  pasar el ID del alumno a una función existente no concede ese permiso.
- Preparada una tercera migración local de lectura de ciclos, planes y versiones
  del alumno `usuario` por vínculo Coach activo, y su lector cliente con
  validación de identidad antes y después del RPC. No materializa el ciclo ni
  altera estados; muestra como cerrado un ciclo cuya fecha final ya pasó.
  El dueño ejecutó el harness ampliado contra PostgreSQL aislado local:
  `COACH_STUDENT_RECORD_LOCAL_POSTGRES=PASS (23 checks; Unix socket only)`.
  Su esquema sintético no sustituye la validación de toda la cadena histórica
  de migraciones ni de Storage desplegado.
- Preparada una cuarta migración local para crear, modificar o retirar una
  rutina dentro de un ciclo Usuario activo mediante una nueva versión del plan.
  Reutiliza el validador y el persistidor existentes, serializa con los writes
  del alumno, comprueba episodio activo y versión esperada, registra actor y
  conserva versiones anteriores. El helper privado de acceso incorpora el
  vínculo Coach activo; los RPC de alumno siguen derivando su propio actor de
  `auth.uid()`. Esta ampliación del guard requiere revisión de seguridad.
- La edición delegada pasó el harness separado que aplica las migraciones
  principales de entrenamiento y prueba alta, modificación, retiro, reintento,
  conflicto y desvinculación:
  `COACH_STUDENT_TRAINING_EDIT_LOCAL_POSTGRES=PASS (16 checks; Unix socket only)`.
  El plan actual exige entre una y siete rutinas. Decisión del dueño de producto
  del 2026-11-26: el Coach puede iniciar un ciclo al crear la primera rutina;
  al retirar la última cierra el ciclo y conserva su historial. Son operaciones
  de ciclo propias, distintas de la edición del plan activo.
- La primera ejecución del harness de edición se detuvo en
  `training cycle ownership denied`: el trigger histórico de `training_cycles`
  seguía exigiendo `auth.uid() = user_id`. El ajuste pendiente de revalidación
  sólo permite el UPDATE delegado cuando coinciden una versión inmutable nueva,
  un registro de actor/episodio, el vínculo activo y una allowlist de columnas;
  los UPDATE directos conservan el rechazo. El reemplazo del trigger cambia
  únicamente esa rama de UPDATE; la ejecución posterior pasó.
- Preparado un gateway de la ficha para listar PDFs médicos ya compartidos
  mediante el lector SQL existente y fotos individualmente autorizadas.
  Revalida el episodio antes y después de consultar documentos y al descargar;
  Storage conserva la comprobación de acceso al archivo. Sus tres pruebas
  focalizadas, typecheck y lint pasaron. No hay conexión visual todavía.
- Preparada una quinta migración local para los dos límites aprobados: crear
  un ciclo con su primera rutina y cerrar el ciclo al retirar la última.
  Reutiliza la persistencia versionada y la protección del entrenamiento en
  curso; agrega registros privados de actor/episodio y excepciones acotadas
  en el trigger histórico para insertar/activar/cerrar únicamente desde esos
  RPC. El dueño ejecutó el harness de edición ampliado contra PostgreSQL
  aislado local: `COACH_STUDENT_TRAINING_EDIT_LOCAL_POSTGRES=PASS (24 checks; Unix socket only)`.
  Incluye creación del primer ciclo, modificación y retiro de rutina, cierre
  de la última, idempotencia, conflicto de versión, desvinculación y rechazo
  de escrituras directas. Esta prueba aplica una selección de migraciones
  reales sobre un esquema sintético; quedan pendientes la cadena histórica
  completa, Storage desplegado y QA visual/funcional con la interfaz conectada.

## Revisión de compatibilidad local del 2026-11-26

- Orden de migraciones: las cinco nuevas migraciones siguen a las 76 existentes.
  La relación Coach–Alumno y sus campos de identidad ya existen desde
  `20260909044235`; las respuestas y estados de Evaluaciones desde
  `20260919225532` y `20260920172644`.
- La clave compuesta `(id, student_user_id)` de `private.progress_assets`, las
  fotos asociadas a checks y los items de reportes existen desde
  `20260923184225`; respaldan el FK y el backfill del permiso individual.
- La política restrictiva `progress photo restricted select` llama a
  `private.can_select_progress_photo_object`, que a su vez consulta
  `private.can_read_progress_object` para el bucket final. La migración nueva
  reemplaza este último helper para exigir permiso individual vigente. La
  política restrictiva de documentos usa el mismo helper para el bucket médico,
  conservando su autorización específica.
- Las columnas, restricciones y límites de versión usados por los nuevos RPC
  corresponden al esquema de ciclos de `20260829200846`; el cambio de
  entrenamiento del `20261122205316` conserva `auth.uid()` como dueño en su
  RPC público. El harness de edición aplica la cadena relevante de entrenamiento,
  pero la relación Coach–Alumno se representa con una tabla sintética.
- Esta revisión local se hizo antes de aplicar las migraciones en QA. No se
  ejecutó `supabase db reset` ni se verificaron las 81 migraciones juntas.
  La validación funcional pendiente corresponde a la BBDD QA existente y
  `qa.organizatech.cl`, incluyendo descarga y revocación con Storage QA.
  Sólo tras QA funcional y visual aprobada se considera producción.

## Aplicación en BBDD QA — 2026-11-26

- Proyecto confirmado: `organizatech-qa` (`fjjebhaqtrdbpxzxztmh`), distinto de
  `organizatech` de producción. El historial previo terminaba en
  `20261122205316_allow_training_before_cycle_start`.
- Se aplicaron en orden y con resultado `success: true` las migraciones
  `20261126200839_coach_student_evaluation_read_v1`,
  `20261126200850_progress_photo_individual_sharing_v1`,
  `20261126200900_coach_student_training_read_v1`,
  `20261126200911_coach_student_training_edit_v1` y
  `20261126200922_coach_student_training_cycle_edges_v1`.
- Supabase asignó esas versiones al aplicarlas. Los archivos locales y sus
  referencias fueron renombrados para coincidir exactamente con el historial
  remoto y evitar una segunda ejecución al sincronizar la rama.
- Verificación posterior: existen las tres tablas privadas nuevas, el RPC de
  creación está disponible para `authenticated` y denegado a `anon`, el helper
  privado no es ejecutable directamente por `authenticated`, y ambas políticas
  restrictivas de Storage siguen presentes. No se hicieron lecturas de datos
  personales ni escrituras de prueba sobre alumnos reales.
- Sigue pendiente desplegar el código en `qa.organizatech.cl` y realizar pruebas
  funcionales con cuentas de prueba, incluyendo revocación de fotos, PDFs y
  conflictos de versión. Esto no equivale a QA visual aprobada.
- El alias `qa.organizatech.cl` apunta todavía al despliegue de `qa` en
  `f99e0b5` tras integrar el PR #98 de infraestructura; Vercel lo reporta
  `READY`. Los cambios de interfaz permanecen sin commit en el worktree;
  la BBDD QA ya está preparada, pero la pantalla nueva aún no está publicada.

## Conexión visual local en preparación

- El detalle de un alumno activo reutiliza el Button de ciclo previamente
  deshabilitado como `Abrir ficha del alumno`, sin duplicar el acceso.
  La pantalla nueva muestra las Section `Entrenamiento`, `Evaluaciones y
  anamnesis`, `Documentos compartidos` y `Fotos de check compartidas` con
  paginación. Usa el lector por episodio activo; al revalidar, borra los datos
  anteriores mientras se verifica el vínculo.
- El alumno dispone del Checkbox `Compartir con mi coach` para cada foto en
  `Mis checks`; sólo aparece con vínculo activo y refleja el permiso persistido.
  El reporte anterior sigue siendo un registro distinto del permiso actual.
- En Entrenamiento están los Button `Crear primera rutina y ciclo`, `Crear
  rutina`, `Modificar rutina` y `Quitar rutina del ciclo`; el Modal de retiro
  explica la conservación del historial. El editor reutiliza el catálogo
  global, la validación y el plan versionado existentes. Permite nombre, día,
  objetivo, fechas al abrir ciclo, selección de ejercicios del catálogo global,
  técnica, series, repeticiones, carga y descargas. Conserva las otras rutinas
  del snapshot al editar. Los ejercicios personalizados existentes se conservan
  al modificar una rutina; el editor todavía no permite crear uno personalizado.
- Al consultar un ciclo histórico, el Button `Volver al ciclo vigente` restaura
  la vista editable del ciclo activo. Las cargas tardías anteriores no reemplazan
  los datos de una revalidación más reciente.
- `Enviar evaluación` abre el flujo manual existente; `Ver respuesta` reutiliza
  el componente de respuestas. PDF médicos y fotos se descargan mediante
  Storage privado con revalidación. El PDF completo del historial de
  entrenamiento depende de métricas/sesiones que no devuelve el lector nuevo;
  falta conectar su fuente autorizada antes de ofrecer ese Button.
- Esta conexión visual local no está lista para commit/PR o QA: requiere la
  separación de infraestructura y conexión visual en PRs distintos, evidencia
  Before/After, Preview y QA manual del dueño según `docs/visual-governance.md`.
  La migración en BBDD QA debe preceder al despliegue de esta interfaz en QA.

### Separación para entrega

| PR | Archivos | Destino y orden |
| --- | --- | --- |
| Infraestructura | Las cinco migraciones `20261126200839`–`20261126200922`, ambos runners PostgreSQL, `src/features/coach-student-record/data/`, `src/features/training-cycle-builder/data/coach-student-training-gateway.ts`, cambios en `coach-reports/data/`, `evaluations/data/`, `progress-records/data/` y sus pruebas focalizadas. Este documento puede acompañarlo. | Ya aplicadas a BBDD QA; probar permisos/RPC/Storage antes de desplegar la conexión visual. |
| Conexión visual | `src/features/coach-student-record/components/` y `model/`, cambios en `coach-clients/components/`, `coach-portal/components/`, `evaluations/components/` y `progress-records/components/`. | PR separado dependiente del anterior; Preview, Before/After y QA manual móvil/funcional del dueño. |

El worktree contiene ambos grupos sin commit. La escritura del índice Git está
bloqueada en este entorno; el dueño prepara los commits selectivos y push.

## Corrección de UX solicitada en QA — 2026-11-26

El dueño rechazó el editor Coach anterior y pidió reutilizar la pantalla y el
flujo productivos de creación de ciclos del Usuario. Esta instrucción sustituye
la propuesta visual anterior para la edición de rutinas. En el detalle de la
ficha, el Button `Crear o modificar rutina en un ciclo nuevo` abre el mismo
constructor de ciclos. Si existe un ciclo activo, el Button primero muestra el
modal compartido de confirmación. Al elegir `Sí` se finaliza el ciclo actual;
sus sesiones/resultados permanecen en el historial y entonces se abre el
constructor. Al elegir `No`, no cambia ningún ciclo. El Coach
puede duplicar el ciclo anterior, crear desde el catálogo o generar una
sugerencia; las pantallas de fechas, días, ejercicios, series, repeticiones,
cargas, técnica, video de YouTube y revisión son las mismas del Usuario.

Al activar, la pantalla de éxito dice `La rutina para [nombre y apellido] fue
creada exitosamente` y ofrece `Ver ciclo completo`. Ese detalle muestra las
rutinas, ejercicios, series, repeticiones, kg, descargas y enlace de YouTube.
La creación de ejercicios personalizados sigue fuera de alcance en la cuenta
delegada y el borrador Coach es temporal; la UI lo informa expresamente antes
de que el Coach salga del flujo. La comparación con rendimiento real en la
pantalla de duplicación se oculta para el Coach hasta disponer de una lectura
delegada de las sesiones del alumno; no se presentan métricas inventadas.

La migración `20261126210619_coach_student_cycle_replacement_close_v1` ya está
aplicada en BBDD QA y agrega un cierre delegado versionado, auditable e
idempotente de un ciclo con varias rutinas. El PR de la interfaz corregida sigue
pendiente; `qa.organizatech.cl` aún muestra el editor anterior hasta desplegar
esa nueva versión. Producción permanece sin cambios.
