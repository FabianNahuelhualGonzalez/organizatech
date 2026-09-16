# Organizatech — Panel principal Coach y vinculación/desvinculación — Implementación modular y preparación QA

## Integración local al 2026-09-16

EN VALIDACIÓN. Los avances preservados se recuperaron selectivamente sobre la
base `3b1df2f3d023c729d62ff2b69b72a30ea5ed4b8e` y se conectaron al portal Coach
mediante una boundary y un controller propios de la feature. El composition root
sólo pasa identidad/generación y navegación transversal. No se ejecutó SQL, no se
tocaron entornos remotos y la QA visual/funcional del dueño sigue pendiente.

El runtime cubre lectura de vínculos activos e invitaciones, reserva de una nueva
invitación, reenvío/regeneración ligado a generación y cancelación/desvinculación.
Las listas productivas consumen la paginación por cursor y la creación preserva
intentos inciertos para conciliarlos o reintentar exactamente el mismo comando;
un resultado resuelto se cierra antes de habilitar una intención nueva.
La reserva no demuestra aceptación ni entrega por un proveedor de correo; no hay
dispatcher/outbox en estas seis migraciones. La aceptación del código y la pantalla
del alumno tampoco forman parte de este alcance y continúan bloqueadas por diseño.
Por lo tanto, no se declara todavía un flujo end-to-end completo.

## Estado al 2026-09-08

EN CURSO. No existe todavía PASS de implementación integrada, auditoría final o QA.
Automatización existente reactivada cada diez minutos, sin duplicarla.

Entrega prioritaria separada de series/kg: el dueño ejecutó commit/push
`31e0c7a801679891ca3461f29a8e8d86cd60edf6`. PR91 OPEN/DRAFT y dos checksSUCCESS.
API Vercel verifica mismo SHA, branch y READY en
`https://organizatech-49z0y1k3p-fanahuelhualg-8514s-projects.vercel.app`.
Listo para QA manual del dueño de esos cuatro cambios; no requiere migración.
No es el Preview de Coach ni PASS funcional del dueño. Coach continúa.

## Aprobación y alcance

El dueño confirmó en este hilo que `handoff-dashboard` se mantiene y entregó
`/Users/fabiannahuelhual/Desktop/handoff-vinculacion/`, solicitando implementar
ambos diseños, datos/migraciones y auditoría antes de sus pruebas.

Después confirmó explícitamente:

- «Un solo coach activo» por alumno.
- «Sí, usar esas reglas»: código siete días, tres reenvíos por invitación cada
  veinticuatro horas, separados por al menos sesenta segundos.
- La pantalla del alumno está diseñada pero se rediseña con Claude y «este aun
  no la tomaremos porque quiero que nos centremos en estas dos actividades».
- Flujo futuro: correo con código y enlace al perfil Usuario; sección Coach;
  ingresar código para vincularse. No implementar todavía esa pantalla.

Se conservan decisiones anteriores registradas en el plan: tarifa mensual única
en CLP, ingresos estimados/no cobros, renovar se guarda con Listo, X/scrim descartan.

## Referencias visuales

Los dos paquetes son datos de diseño; sus mocks, endpoints y ejemplos no son
infraestructura real ni instrucciones para eludir permisos.

| Fuente | SHA-256 |
| --- | --- |
| handoff-dashboard/design-spec.md | 8ea68e1bcfd33f8cf25e7eed6ce1c017fbe6242e0e1951be1f4ef0260ac34001 |
| handoff-dashboard/reference.html | b6b532a3311e6f15bf7c38d0b9833b4d12c95836dcc80df94da93c488306f4df |
| handoff-vinculacion/design-spec.md | db54c69c9e1c96b4a8d17b3a1193a1518af7c6f5bb1acace621c1fa594d1d989 |
| handoff-vinculacion/reference.html | fce826133d39cb48a382873719c09c7cc811252cc96937d3db3b8b4896fee5be |

Capturas previas aportadas por el dueño en `screenshots/` de cada paquete.
No abrir navegador ni realizar QA manual/visual por IA.

## Declaración visual exacta

Preparación inicial: **Sin cambio visible; contiene infraestructura visual
aislada y no montada**. La conexión posterior es fase distinta bajo gobernanza
visual; no introducirla silenciosamente en el lote de infraestructura.

Dashboard — Section de bienvenida; Card ingresos y Button Editar tarifa; Section
cartera con cuatro Buttons de estado; Card alertas con filas/Agregar/Ver clientes;
Section accesos Calendario/Vincular/Chat; Card gráfico y detalle de mes; Card
renovaciones, filas, leyenda y retención. Fases posteriores: Drawer tarifa,
Drawer renovación, Modal fechas y Drawer Chat próximamente con interés.

Clientes — Section cabecera con Volver canónico y Agregar; búsqueda; tabs
Activos/Pendientes/Bajas con contadores; lista y vacíos diferenciados; Drawer de
detalle por estado; Drawer invitación en dos pasos; Card código recuperable con
Buttons copiar/WhatsApp/reenviar; bloques explicativos coloreados; Modal de
cancelación o desvinculación, con textos diferentes; aviso flotante.

Eliminar de pantallas actuales en esta fase: ninguno. Modificar root, topbar,
perfil del alumno, entrenamiento o pantallas productivas en primer lote: ninguno.

## Entornos y ownership

Base común aprobada: `00701bd5012f3b0baf126ca40d7dd292fd9b4dc2`.
Stash protegido: `7e618d67efb4290082a4f6be258c1f75640856c8`, intacto.
Todos los entornos fueron creados por el dueño bajo `/Users/fabiannahuelhual/Developer/`.

| Entorno/branch codex homónima | Responsable | Archivos exclusivos |
| --- | --- | --- |
| organizatech-coach-dashboard-01 / codex/coach-dashboard-01 | coordinador | documentación, hooks/integration y conexión compartida posterior |
| organizatech-coach-dashboard-ui-01 / codex/coach-dashboard-ui-01 | coach_ui | coach-dashboard/components, coach-clients/components; CSS/tests propios |
| organizatech-coach-dashboard-domain-01 / codex/coach-dashboard-domain-01 | coach_domain | coach-dashboard/model, coach-clients/model; tests propios |
| organizatech-coach-dashboard-data-01 / codex/coach-dashboard-data-01 | persistencia | data, migraciones NUEVAS y pruebas SQL propias |

No copiar cambios sin commit de un worktree a otro; coordinar integración con
inventario explícito y checkpoint del dueño. No tocar carpeta principal ni PR91.

## Primeros lotes

1. UI: tipos de vista controlados, bienvenida/cards/listas/gráfico del dashboard,
   CSS Modules y tests; sin hojas ni conexión productiva por ahora.
2. Dominio: vínculo activo/pendiente/baja discriminado; ciclo opcional no equivale
   a vínculo; búsquedas/contadores/correo sobre cartera propia; normalización del
   código sin generación cliente; dinero CLP entero con null para desconocidos,
   overflow controlado y en juego excluyendo no-renueva.
3. Persistencia: inventario read-only terminado. En implementación local aislada:
   tarifa privada por Coach con control de versión e interés Chat idempotente,
   con migración nueva y pruebas de privilegios/ownership. No aplicar SQL remoto.
   Relaciones, invitaciones y decisiones comerciales siguen siendo necesidades
   nuevas, no capacidades existentes verificadas.

### Evidencia parcial y continuación

- UI primer lote corregido: 25 archivos nuevos aislados, 27/27 tests React
  SSR/callbacks, typecheck, lint focal y whitespace PASS. No dibuja proporciones
  ficticias cuando todos los ratios son cero; capacidades de cartera por destino.
- UI segundo lote: 20 archivos nuevos de lista/tabs/búsqueda/vacíos de Clientes,
  20/20 tests PASS. Pendientes sólo muestran email, también en ARIA. No montado
  ni importado por producto. Tercer lote Tarifa/Chat terminado: hojas controladas,
  foco compartido y sin persistencia optimista ficticia. Cuarto lote terminado:
  detalle de renovación y modal anidado de fechas; X/scrim cancelan sin guardar.
  Quinto lote terminado: detalle Cliente activo/pendiente/baja, código y
  confirmación anidada de desvincular/cancelar. Total: 79 archivos nuevos,
  110 tests focales PASS (68 Dashboard, 40 Clientes, 2 overlays compartidos),
  typecheck/lint/whitespace PASS. Pendientes sólo email; activo sin ciclo no
  pasa a baja; no APIs ni writes UI. Sexto lote terminado: invitación en dos
  pasos. La confirmación depende de respuesta real, no del clic de envío,
  y distingue aceptación del proveedor de entrega al buzón. Total UI91 archivos,
  133 pruebas PASS (69 Dashboard, 62 Clientes, 2 overlays), typecheck/lint/diff.
  El agente está cerrando ahora suite general/build y detectando registros
  compartidos pendientes sin suprimir ni modificar esas barreras por su cuenta.
- Dominio primer y segundo lote: nueve archivos nuevos aislados, 48/48 tests,
  typecheck y lint focal PASS. Incluye reservas de reenvíos cada 60 segundos,
  máximo tres por ventana móvil de 24 horas, sin extender los siete días.
  Reserva atómica/idempotencia reales siguen pendientes del backend.
- Dominio tercer lote terminado: snapshot de renovación comercial, override
  crudo/cancelación anidada y preparación de Listo sin writes de entrenamiento.
  Dos archivos nuevos; total de los tres lotes 67/67 tests, typecheck y lint focal
  PASS. Fechas civiles por puerto estricto obligatorio; sin política de duración
  ni fuentes históricas inventadas. No auditoría final ni integración aún.
- Persistencia primer lote: migración local
  `20260908201518_coach_dashboard_private_preferences.sql`; 64 comprobaciones
  PostgreSQL 17.5 efímero PASS, incluidas carreras de versión inicial/CAS,
  idempotencia Chat, aislamiento de usuarios y ACL/RLS. Pruebas data focales,
  suite completa npm test, typecheck, lint, build y diff PASS. Trece archivos
  congelados para auditoría independiente; no editar mientras se revisan.
  Sólo entorno local, no aplicar SQL remoto ni afirmar QA hospedado PASS.
- Coordinación de scripts: el 2026-09-08 se reasignó temporalmente `package.json`
  del worktree DATA al implementador de persistencia para registrar y ejecutar
  los dos tests nuevos mediante `test:coach-dashboard-preferences`, sin cambios
  de dependencias/lock. La suite general detectó correctamente tests aún no
  inventariados (190 registrados/192 en disco). No suprimir ese contrato ni
  afirmar suite PASS hasta registrar y volver a ejecutar. Ningún otro agente
  editará package mientras ese lote siga abierto; el diff vuelve a integración
  con inventario explícito al congelarlo.
- Reasignación acotada adicional al implementador DATA: registrar únicamente la
  ruta nueva de preferencias en la allowlist existente de
  `src/features/coach-portal/coach-portal-integration-contract.ts`. Se revisó el
  contrato antes de autorizarlo. Preservar todas las restricciones restantes;
  nunca usar una exclusión genérica para migraciones. Incluir este diff en el
  inventario congelado de DATA, sin que otro agente modifique el archivo a la vez.
- Verificación adicional de integridad: tras revisar que package sólo agrega el
  script focal y su ejecución en posttest, con lock byte-idéntico, se autorizó
  actualizar únicamente su hash en
  `active-workout-visual-integration-contract.test.ts` (clave package.json).
  El hash nuevo es `8e7d21947dde0b7898221a46b58e3d1d08cf2b6bbc38ace3ef8e0292b04adf06`.
  No se cambian otras claves/assertions ni UI de entrenamiento. Forma parte del
  inventario explícito DATA; suite general repetida con resultado PASS.
- Los tres archivos compartidos de DATA regresan al ownership del coordinador
  para integración posterior; no existe un segundo escritor activo. Auditoría
  Claude read-only PASS estático, sin hallazgos bloqueantes. Scan local acotado
  `cb3e6328-efb9-4901-9c4e-19f6c40ce1d7` completado: 13 archivos revisados,
  cero vulnerabilidades confirmadas. Preflight ready (3/3); acceso TAC no
  verificable por conector desconectado. Resultados y límites en
  `preferences-audit.md`; no constituye auditoría final del flujo Coach integrado.
- Reasignación UI acotada para el quinto lote: `src/ui/coach-overlays/**` pertenece
  únicamente a coach_ui en su worktree. Extrae envoltura visual/tipos/inert leases
  compartidos por Dashboard y Clientes, sin importar una feature desde otra ni
  duplicar el motor de foco. No modificar el motor canónico de overlays, root,
  globals, package ni migraciones. El adaptador Dashboard y regresión preservan
  los cuatro lotes previos; no hay otros escritores de esa ruta compartida.
- Persistencia segundo lote, responsable coordinador en el worktree DATA:
  adaptador Supabase real con token verificado por operación, sin crear otra
  sesión Auth ni renovar tokens. Dos archivos nuevos y registro de su test;
  no cambia dependencias, lock ni migración. Ocho pruebas HTTP simuladas nuevas
  PASS (23 focales en total); suite completa/typecheck/lint/build y whitespace
  PASS. Quince archivos congelados; auditoría Claude read-only del delta PASS,
  sin hallazgos bloqueantes. Evidencia y límites en `preferences-adapter-audit.md`.
  El PASS anterior de trece archivos no cubre por sí solo esta ampliación.
  Hash actual package: `17669b2dba7aa7a57944457a574cff2fdccf8a6861cb6edf17bb3b673aebc78a`.
  Se precisó además la documentación del runner:
  destino fijo local, pero el driver puede consultar opciones PG* por defecto.
- El retorno de foco tras reconstruir una fila necesita resolución por identidad
  en el controller integrado: el motor canónico captura el destino al abrir y
  no relee una ref cambiada al cerrar. No modificar ese motor ni afirmar resuelto
  el caso sólo por actualizar la ref. Prueba de integración pendiente explícita.
- Integración primer lote de controller, coordinador en su worktree propio:
  `coach-dashboard/hooks/coach-preferences-controller{,-contract,.test}.ts`.
  Puerto consumidor tipado, sin copiar datos/código sin commit de DATA/UI/model;
  la integración posterior comprobará compatibilidad estructural. Estado confirmado
  separado del borrador, guardado single-flight, reconciliación obligatoria tras
  errores, interés Chat sólo confirmado, descarte por identidad/dispose. No dinero
  de dominio, SQL, Auth, React ni copy visible dentro del controller. Se instala
  únicamente lo fijado por lock con npm ci --ignore-scripts; lock intacto.
  Quince pruebas del controller, typecheck/lint/build PASS. Se registra su test
  focal y posttest en package de integración, después de que UI congelara sus
  ajustes shared; nunca se copian scripts entre entornos. Hash package revisado:
  `19b3d49ff32ff19427a704c7682dc876a890159d2b9e88ac95b53071c51906a1`.
  Active-workout cambia sólo esa clave hash, no otras assertions. Suite completa,
  typecheck/lint/build/diff PASS. Auditoría Claude read-only de sus cinco archivos
  de código PASS, sin hallazgos bloqueantes; hash agregado congelado
  `14bf4077dc7e469ace4e04a625d3560f07766d0834eca8d6078f5de1eff033fe`.
  Este lote sigue sin montar UI productiva. Resultado en
  `/tmp/organizatech-coach-controller-claude-audit.json`; límites y observaciones
  no bloqueantes registrados en `preferences-controller-audit.md`.
- Cierre técnico UI: build PASS. La primera suite completa detectó diez tests
  nuevos no registrados (190 referencias/200 archivos) y consumidor nuevo del
  motor de overlays ausente en dos inventarios exactos. El coordinador autoriza
  registro mínimo en package y en los contratos de training-plan/user-portal-shell;
  active-workout sólo actualizará el hash de package tras verificar el diff.
  Motor, lock, PERF-06R y restantes assertions intactos. Estos cuatro archivos
  shared pertenecen temporalmente a coach_ui sólo en su worktree; se devolverá
  ownership al coordinador al congelar. No declarar suite PASS hasta repetirla.
- Suite UI repetida tras registros: npm test completo, typecheck/lint/build/diff
  PASS. Tres README precisados;95 archivos congelados,133 focales PASS.
  Coordinador verificó branch/HEAD/stash y SHA contenido:
  `ecba1c25aaedf95f43951e032732152077b0a3a56c28fc859fee39f2fdd59603`.
  Resumen de gates `/tmp/organizatech-coach-ui-gates.N78euZ/validation-summary.md`
  (no es log crudo). Agente devuelve ownership; auditoría Claude read-only
  independiente inicial terminada con una corrección requerida: validación local
  de fechas emitía alert/assertive, contra anuncio polite exigido por el handoff.
  Aunque su encabezado usa PASS, el coordinador registra REQUIERE CORRECCIÓN.
  `coach_ui` retoma sólo modal/test y comentario de restoreFocusRef; fullgate y
  auditoría delta obligatorios después. Resto del lote congelado. No confundir
  estos gates con QA manual ni integración.
- Delta UI: test RED confirmó role=alert en validación local err; GREEN cubre
  err/warn/ok como status/polite y mantiene alert para error remoto. Total134
  focales (70Dashboard/64Clientes+overlay) y npm test completo PASS. Build/tipos/
  lint/diff finales en curso antes de reauditoría. Tres archivos únicamente.
- Dominio: continuación asignada a `coach_domain_closure`, único responsable de
  ese worktree ya creado, sin nueva tarea/entorno de producto. Repite67 focales,
  typecheck/lint/build PASS. Suite encontró cinco tests no registrados (190/195);
  se autorizaron únicamente package (script con5rutas/posttest) y hash package
  en Active Workout, después de congelar los ajustes UI/integración. Once archivos
  originales intactos; lock sin cambios. Nuevo package:
  `77d2886745dc5709e562173028aee6af5d045e4802b1ebeff62a61ef3e163688`.
  Inventario195/195 exacto comprobado; suite completa final, typecheck/lint/build
  y diff PASS. Trece archivos congelados, ownership devuelto al coordinador;
  SHA contenido `d429b9ef66c18360147fa260b604634e60e2387b1650203e8449c6317cc2eead`.
  Logs finales `/tmp/organizatech-coach-domain-gates.d0rfd2/*-registered.log`.
  Auditoría Claude read-only del lote PASS, sin bloqueantes; resultado
  `/tmp/organizatech-coach-domain-claude-audit.json`. Observación de producto:
  confirmar borde entre fin del ciclo e inicio de renovación antes de conectar
  fechas/SQL; no inferir que la auditoría decide esa inclusividad por el dueño.
- Nuevo delta dominio acotado de dos archivos money.ts/money.test.ts: completar
  parser puro de tarifa para el puerto parseFee del controller. CLP entero seguro,
  dígitos o grupos de miles por punto bien formados; vacío/incompleto/inválido no
  se transforma en cero ni se trunca con parseInt. Sin decidir límites comerciales,
  tocar renovaciones o modificar shared/package/lock. Gate y auditoría anteriores
  no cubren automáticamente esta ampliación; repetirlos antes de congelar.
- Revisión temprana DTO/dominio/presentación detectó dos ajustes UI ya resueltos;
  no equivale a auditoría final independiente. Suite completa/integración/QA
  Coach pendientes. Los contratos globales de consumidores de overlays y de
  inventario de migraciones se registrarán con sus diffs explícitos, no se omiten.
- No se han copiado archivos entre worktrees ni ejecutado commit/push.
- Preparación del siguiente bloque: inventario read-only de identidad y membresías
  terminado. No hay vínculos/invitaciones Coach en el esquema local base; emails
  Auth/Calendario no suplen ese flujo. Contrato y criterios de concurrencia,
  idempotencia, evidencia de envío y revocación en
  `invitations-persistence-contract.md`. Preparación documental, no SQL aplicado
  ni ampliación de acceso al entrenamiento. Guías Supabase/Postgres influyen en
  locks cortos, privilegios mínimos y unicidad; sin copiar SQL genérico ni tocar
  roles/servicios remotos.
- Seguimiento conserva el mismo id, hilo y frecuencia de diez minutos ACTIVE.
  La herramienta devolvió actualización exitosa, pero la comprobación posterior
  del archivo muestra que su prompt sigue histórico. No afirmar que quedó
  actualizado. El encabezado vigente del plan documenta creación/inicio cumplidos,
  prioridad series/kg sin pausar Coach y separación de gates; los recordatorios
  no deben volver a solicitar creación de entornos ya verificada.

El coordinator mapeará DTO → dominio → VM. La UI recibe etiquetas/fechas/importes
formateados y callbacks explícitos; no consulta Supabase ni calcula negocio.
Fixtures exclusivamente en tests. Contratos locales pequeños, no store universal.

## Cierre de reauditorías — 2026-09-08, 22:27Z

- UI: delta de tres archivos validado con134 focales, suite completa, typecheck,
  lint, build y diff PASS. Auditoría Claude read-only delta PASS en
  `/tmp/organizatech-coach-ui-claude-delta-audit.json`; se cierra el hallazgo de
  anuncio assertive para validación local sin suavizar errores remotos.
  Inventario95 congelado, SHA agregado
  `b74234c1f6e8bbbbbd2222eed4984457e0b9fce4649099044a0fd21fddc0234e`.
- Dominio: parser CLP completado con diez pruebas nuevas;77 focales y suite
  completa/typecheck/lint/build/diff PASS. Claude delta PASS en
  `/tmp/organizatech-coach-domain-parser-claude-audit.json`. Inventario13 congelado,
  SHA agregado `2e8b125729f43cb6135d55108b564954d581567d04135d48aafe684023ed4e99`.
  El parser conserva vacío/inválido distinto de cero y no modifica renovaciones.
- Ambas auditorías son revisiones estáticas independientes: Claude no se atribuye
  haber ejecutado los gates locales del implementador. Los PASS no equivalen
  a integración, QA de navegador ni datos alojados en Supabase.
- Ownership devuelto. Se prepara revisión read-only de dependencias e inventario
  para integración explícita en el worktree del coordinador, sin copiar carpetas,
  introducir imports absolutos ni sobrescribir los registros de otros tests.
- Ciclos: el dueño ya probó Preview `31e0c7a`, solicitó separar las técnicas
  avanzadas del modo Series lineales y AUTORIZÓ implementarlo. El ajuste tiene
  gates técnicos PASS; auditoría Claude read-only en curso antes del comando
  manual de commit. Esto no pausa Coach ni equivale a publicar el ajuste nuevo.

## Condiciones que faltan para el flujo completo

Integración local de infraestructura realizada después de revisión read-only de
inventario e imports.114 archivos nuevos incorporados por parches explícitos y
cinco shared fusionados semánticamente, sin sobrescribir ROOT ni editar fuentes.
Inventario/hash por archivo y evidencia en `infrastructure-integration-review.md`.
Nuevo runtime conecta preferenciasDATA/controller/parser; nueve pruebas con SDK
real y fetch simulado PASS. En conjunto258 focales Coach, npm test completo,
typecheck/lint/build/diff PASS; auditoría Claude de integración aislada PASS.
Se cerró el comentario menor H1 de contratos de foco con ambos tests repetidos
PASS; no cambió ninguna lista de consumidores. No es PASS del flujo Coach completo.
Ninguna pantalla productiva importa la nueva UI. Esto no habilita aún datos reales
de cartera, invitaciones/correo/renovaciones ni la fase visual del producto.

Actualización ciclos: dueño ya AUTORIZÓ separación Series lineales/Modificar por
series; `/root/cycle_linear_modes` es único escritor de PR91 desde31e0c7a. Entrega
prioritaria, mientras Coach continúa en ROOT. No commit/push por agentes.

- Perfil/consentimiento alumno aplazado explícitamente; probar aceptación técnica
  con fixtures locales no equivale a experiencia final habilitada.
- El acceso Ver ciclo no tiene aún pantalla Coach aprobada ni contrato de edición.
  No habilitar writes del alumno ni asumir permisos por estar vinculado.
- Cerrar definición/fuente de histórico, constancia, retención y alertas. No hay
  datos reales de pagos que permitan una alerta Pago pendiente.
- Entrega de correo real necesita contrato/outbox y verificación en QA; persistir
  invitación no prueba que el proveedor aceptó el correo.
- Re-vincular conserva datos del alumno; no reasignar permisos de episodios viejos
  ni acceso a historial sin contrato explícito.

Consultas asíncronas enviadas al dueño el 2026-09-08, todavía sin decisión:
histórico de ingresos con tarifa vigente por mes vs tarifa actual; omitir por
ahora Pago pendiente al no existir datos de pagos. No convertir las opciones
preseleccionadas en aprobación. Estas consultas no pausan UI ni los lotes
independientes autorizados; no aplicar decisiones históricas nuevas a SQL.

## Gates y prohibiciones

Código: lint/typecheck/tests focales y completos/build/diff PASS antes de auditoría
final independiente read-only. Auditar arquitectura, UI, dominio, RLS/ownership,
concurrencia/idempotencia y privacidad. Hallazgos vuelven al implementador.

Commit y push: exclusivamente dueño; preparar inventario y comandos exactos.
QA manual: exclusivamente dueño, después de publicación y migraciones verificadas.
Migraciones locales: preparar y probar. SQL remoto requiere lista exacta/hashes,
impacto, recuperación y aprobación específica de QA `fjjebhaqtrdbpxzxztmh`.
Nunca usar service_role, recuperar credenciales previas, tocar variables, modificar
training_sessions/exercise_entries ni producción `lzycxltqbrtsnwfdotqw`.

Finalizar automatización técnica al obtener código y auditorías PASS del alcance
Coach autorizado; diferenciar entrega para commit de disponibilidad real en QA.
La aceptación alumno aplazada no se marca PASS ni bloquea la maquetación Coach.
Los cuatro cambios de series/kg de ciclos tienen código y auditoría Claude PASS
en su entorno PR91 independiente. Se entregan primero para commit/push del dueño
y verificación del nuevo Preview. No pausar esta automatización ni Coach por esa
entrega: el seguimiento cada diez minutos permanece activo para ambos diseños.
