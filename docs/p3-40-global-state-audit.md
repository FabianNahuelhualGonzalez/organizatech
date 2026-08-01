# P3-40 — Auditoría del estado realmente global, actualización post-hotfix PR #61

Checkpoint estático pre-merge actualizado después del hotfix PR #61 y de la cancelación de P3-39C1. Fecha de inspección y actualización: 2026-08-01.

## 1. Base y metodología

### Hechos observados

- Workspace: /Users/fabiannahuelhual/conductor/workspaces/organizatech/hyderabad.
- Rama: revisar-texto-adjunto.
- Base original auditada y HEAD local conservado: c792abe7012c444cd32edba047d43ad5e48541fb.
- origin/main después de ejecutar git fetch origin: a959058724b14c3f47d3ebc30286539d75e3fc1c.
- origin/main contiene a959058724b14c3f47d3ebc30286539d75e3fc1c y apunta exactamente a ese merge.
- Merge-base entre HEAD y origin/main: c792abe7012c444cd32edba047d43ad5e48541fb.
- a959058 es el merge de PR #61, con padres c792abe7012c444cd32edba047d43ad5e48541fb y ad96c90e8be28bd95aba6e0b0149ccab68ef1d03.
- El workspace no se actualizó por merge ni rebase: se preservó el documento local pendiente. Antes de esta actualización, el único delta era docs/p3-40-global-state-audit.md sin trackear.
- No había merge, rebase, cherry-pick ni revert pendiente.
- stash@{0} estaba protegido e intacto: objeto 7e618d67efb4290082a4f6be258c1f75640856c8, descripción On fix/workout-readiness-active-reentry: preserve pre-carousel dirty reentry test file.
- La única operación Git mutante autorizada en esta actualización fue git fetch origin. No se ejecutaron commit, push, PR, merge, rebase, reset, clean ni stash. No se leyó ni creó ningún archivo .env.

La metodología tiene dos capas: el inventario global completo se conserva sobre la base original c792abe; el delta de producción se inspeccionó directamente desde los objetos Git de origin/main en a959058, sin modificar el working tree. El diff c792abe..a959058 cambia sólo TrainingCompletionSummaryScreen.tsx y active-workout-visual-integration-contract.test.ts, con 23 inserciones y 185 eliminaciones. Por ello, todas las filas salvo la decisión de share conservan la evidencia de la base original.

La auditoría fue de código estático. Se inspeccionaron el root, auth/session, navegación, overlays, Active Workout, Progress, Cycle History, Training Plan, Routine Builder, Profile, Notifications, persistencia browser, repositorios y SQL versionado sólo para establecer ownership. Se usaron find, grep, sed y comandos Git; rg no estaba disponible y no se instaló ninguna herramienta.

El archivo src/components/organizatech-app.tsx aloja 51 useState, 2 useReducer y 17 useRef dentro del componente principal. Esa ubicación física no se trató como prueba de globalidad. No hay imports productivos de Zustand, React Context ni providers de dominio bajo src; Zustand está declarado como dependencia, pero no es owner de estado productivo en esta base.

### Criterio de clasificación

Se considera global real sólo el estado o infraestructura cuyo lifecycle y consumo atraviesan la aplicación completa. El estado de una persona autenticada puede ser compartido por varias features y, aun así, sigue siendo user/session scoped. El estado propio de una feature no se vuelve global por estar elevado al root. Los snapshots calculables se clasifican como derivados y no como nuevas fuentes de verdad.

## 2. Resumen ejecutivo

### Hechos observados

1. No existe un store global productivo. Los únicos singletons de módulo confirmados son el cliente browser de Supabase y el stack de ownership de overlays; ambos son infraestructura, no dominio serializable.
2. Los únicos conjuntos de estado realmente transversales son el boundary de sesión/identidad/epoch, la navegación contextual y los snapshots compartidos de entrenamiento. El owner canónico de estos últimos sigue siendo Supabase en modo autenticado o localStorage en demo; son user/session scoped y no justifican un store universal.
3. Active Workout, Progress, Routine Builder y Cycle History ya tienen reducers, hooks o controllers feature-local. Parte de su orquestación todavía vive en organizatech-app.tsx.
4. La mayor parte de los modelos de Dashboard, Progress, Notifications, Profile y Training Plan son derivados. Almacenarlos duplicaría fuentes de verdad.
5. El patrón correcto ya existe en dos superficies: los operation owners de Active Workout y el controller/coordinator por identidad de Cycle History descartan respuestas stale. Debe reutilizarse como garantía, no convertirse en estado serializable.
6. SIGNED_OUT invalida el epoch, limpia datos principales y Active Workout, pero deja vivos varios intents UI: panel de notificaciones, selección de Progress, overrides, edición de rutina y cuatro modales. El modal destructivo de ciclo puede reaparecer bajo otra identidad.
7. Las lecturas de Profile están protegidas por epoch; los handlers de guardar datos personales y subir avatar no validan owner después del await. Una respuesta de A podría volver a poblar memoria React después de SIGNED_OUT o sobre B.
8. Varias mutaciones largas de rutina/ciclo tampoco capturan una identidad única. En el guardado legacy de rutina, cada llamada vuelve a resolver auth.getUser; un cambio de identidad entre iteraciones podría intentar escribir parte del draft de A bajo B. RLS de filas no evita ese caso si el cliente deriva correctamente el nuevo user_id.
9. El modelo puede publicar supabaseUser sin una sesión efectiva después de un registro con confirmación pendiente. La UI termina en Login, pero canEditProfilePersonalData sólo exige user + client y la invariante user autenticado = session.user no está codificada.
10. Dos flujos de cierre presentan regresión: update password no inspecciona el error devuelto por signOut y logout borra primero el scope browser, antes de confirmar que signOut tuvo éxito.
11. Los repositorios observados usan allowlists, derivan ownership desde Auth y filtran por id/user_id. No se observó mass assignment remoto directo. Esto es evidencia del repositorio, no certificación de RLS/grants desplegados.
12. El merge a959058 de PR #61 retiró del resumen de cierre la integración visual no aprobada de compartir. TrainingCompletionSummaryScreen ya no posee ShareWorkoutCard, shareModel, handlers, locks, refs ni estado de share.
13. P3-39C1 fue cancelada y su hoja fue archivada. No existe dependencia futura con esa tarea. La infraestructura de compartir permanece en el repositorio, pero desconectada de componentes productivos.
14. Decisión de producto y arquitectura: ShareWorkoutCard no debe volver a montarse en TrainingCompletionSummaryScreen. Ninguna tarea de infraestructura, ownership, encapsulación o refactor autoriza cambios visuales implícitos; una integración visual futura requiere aprobación explícita del dueño de producto y alcance separado.

### Recomendación

No crear un store universal. Ejecutar P3-41 a P3-45 por boundaries: identidad/epoch primero; datos compartidos de entrenamiento después; navegación y Active Workout; planificación/Progress; por último Profile/Notifications/Cycle History y limpieza del root. Un provider sólo debe exponer una API acotada; nunca tokens, refs de freshness o campos de ownership mutables.

## 3. Matriz completa de ownership

Las ubicaciones corresponden a la base original indicada en la sección 1, salvo las filas marcadas como hotfix a959058. “Canon” describe la fuente vigente; “P3-x” es una propuesta de secuencia, porque el repositorio no contiene especificaciones observables para P3-41 a P3-45.

| Estado o grupo; archivo; mecanismo; owner actual | Productores y consumidores | Canon, derivación y persistencia | Guards y riesgo stale/cross-user | Clasificación | Recomendación y dependencia | Evidencia reproducible |
|---|---|---|---|---|---|---|
| browserClient; src/lib/supabase/client.ts; singleton de módulo; infraestructura Supabase | Lo crea getSupabaseBrowserClient; Auth y repositories consumen el SDK | Canon de la sesión/token: Supabase Auth SDK; persistSession y autoRefreshToken pertenecen al SDK, no a un store de app | El raw token es sensible; ampliar su distribución aumentaría superficie de exposición | global real, infraestructura, lifecycle sensible | Mantener singleton privado; exponer identidad/capacidades mínimas, no tokens. No mover a Zustand. P3-41 | grep -nE 'browserClient|persistSession|autoRefreshToken' src/lib/supabase/client.ts |
| supabaseSession, supabaseUser, dataMode, dataSource, isSupabaseConfiguredState; organizatech-app.tsx:413-425; useState; root | Bootstrap/onAuthStateChange/applySessionState producen; auth UI, repositories y todas las features consumen estado/capacidad | Auth SDK es canon; los estados React son snapshot de sesión. Sin persistencia propia de la app | Cambio de identity/scope avanza epoch y limpia datos. El raw session duplica el objeto sensible del SDK. Registro con confirmación puede publicar user sin session y canEditProfilePersonalData no exige sesión efectiva | global real a nivel app, user/session scoped, lifecycle/owner sensible | Encapsular en SessionBoundary/provider mínimo; imponer authenticatedUser = session.user, mantener raw session privado y no serializable. P3-41 | organizatech-app.tsx:603-759,921-922,1852-1893,1271-1334; session-data-epoch.ts |
| sessionDataEpochRef, sessionDataMountedRef, activeBrowserStorageScopeRef, incomingWorkoutDraftRecoveryScopeRef; organizatech-app.tsx:490-493; useRef; root | capture/advance/isCurrent y session boundary los modifican; loaders, persistencia y Active Workout los consumen | Canon imperativo de generation, userId y scope; no persistido | Protege cambio de usuario y unmount. No implementa latest-request-wins dentro del mismo owner; mover refs por separado rompería el boundary | global real, infraestructura, ref imperativa, lifecycle/owner/epoch sensible | Mantener centralizado detrás de API de request/operation owner. No exponer setters ni persistir. P3-41 | organizatech-app.tsx:516-601,1271-1381; session-data-epoch.ts |
| bootstrapSession y onAuthStateChange; effect; root | INITIAL_SESSION, SIGNED_IN, SIGNED_OUT, PASSWORD_RECOVERY y TOKEN_REFRESHED producen transiciones; toda la app consume sus resultados | Auth SDK/evento es canon; screen/status son proyecciones de transición | SIGNED_OUT fuerza invalidación y limpia core. TOKEN_REFRESHED conserva epoch, pero vacía Profile/avatar. Bootstrap y listener pueden iniciar refresh en la misma generation; no hay latest-wins y el effect captura closures iniciales | global real, infraestructura, lifecycle sensible | Convertir en state machine/controller de sesión sin cambiar orden de invalidación, limpieza y navegación; hacer explícito owner/mode/result de refresh. P3-41 | organizatech-app.tsx:603-759,1271-1381,1537-1568,1786-1791 |
| loginEmail/password, registerName/email/password/confirm, recoveryEmail, newPassword/confirm, passwordUpdateSuccessRef; organizatech-app.tsx:401-409,429; useState/useRef; root | Formularios auth y handlers producen/consumen | Drafts de formulario en memoria; no canon remoto ni persistencia | Passwords viven más de lo necesario mientras existe el root; resets no son uniformes entre identidades | feature-local, UI transitoria, ref imperativa sensible | Encapsular por pantalla auth, limpiar secrets en éxito/cancel/unmount. No provider/store. P3-43 | organizatech-app.tsx:398-429,3993-3995,4137-4138 |
| statusMessage, isAuthLoading, isBusy; organizatech-app.tsx:410,425-428; useState; root | Auth, Profile, routine/cycle y navegación escriben; múltiples pantallas consumen | Mensajes/flags transitorios; no hay un canon único de operación | isBusy/status compartidos permiten que catch/finally de una operación vieja pisen otra; no llevan owner | UI transitoria, lifecycle sensible, fuente duplicada | Separar por controller/operación; usar operation owner donde haya awaits. No generic busy global. P3-41/P3-43/P3-44/P3-45 | grep -nE 'setStatusMessage|setIsBusy' src/components/organizatech-app.tsx |
| screen y screenHistory; organizatech-app.tsx:398-399; useState; root/App Shell | navigateTo, goBack, auth transitions y notification intents producen; renderer y todas las pantallas consumen | Estado contextual de navegación es canon en memoria; active flow persiste sólo flows recuperables, TTL 24 h | Auth reset reemplaza history; restore valida scope/mode/version/TTL. Mezclar navegación con feature state crea transiciones no atómicas | global real de aplicación; parcialmente persistido; lifecycle sensible | Controller/provider de navegación con intents tipados y reset auth explícito. No store universal. P3-43 | organizatech-app.tsx:1397-1467,2043-2105; app-navigation*.ts; app-flow-storage.ts:90-148 |
| isMenuOpen, isNotificationPanelOpen, isTopbarHidden; organizatech-app.tsx:437-438,442; useState; App Shell root | Topbar, drawer, scroll y navigation producen; overlays consumen | UI en memoria, no persistida | SIGNED_OUT sólo cierra menu. El panel puede sobrevivir y reaparecer bajo la identidad siguiente; topbar hidden también sobrevive | UI transitoria, shell-local | Mantener en App Shell; resetear/keyear por identity y cerrar todos los overlays en auth boundary. P3-41/P3-43 | organizatech-app.tsx:760-770,1336-1381,3636-3660 |
| activeOverlayOwners y refs del hook; src/ui/overlays/use-overlay-focus-management.ts:55-199; array de módulo + hook/ref; infraestructura UI | Montaje/desmontaje de drawer, panel, modal y avatar editor producen; focus trap/Escape consumen | Canon del overlay superior durante el mount; sin persistencia | Cleanup quita owner. Convertirlo en cache de dominio o duplicar stacks rompería orden de foco | global real, infraestructura, ref imperativa, UI transitoria | Mantener único y privado. No store. P3-43 | grep -RInE 'activeOverlayOwners|useOverlayFocusManagement' src/ui src/features src/components/profile |
| exercises, entries, trainingSessions; organizatech-app.tsx:430,435-436; useState; root | refreshData, saves y completion producen; Dashboard, Active Workout, Progress, Plan y Notifications consumen | Supabase es canon autenticado; localStorage sólo es canon demo | Cambio de scope limpia antes de cargar y reads validan epoch. Faltan request IDs latest-wins para concurrencia del mismo usuario | user/session scoped, compartido de dominio, persistido remoto/demo, lifecycle sensible | TrainingData provider/controller acotado por identity, con generation por recurso. Repositories/persistencia quedan fuera. P3-42 | organizatech-app.tsx:1271-1323,1537-1568; data/repository.ts |
| cycleScopedPlan, cycleScopedExercises, cycleScopedLoadError, isCycleScopedDisplayLockedRef; organizatech-app.tsx:431-434; useState/useRef; root | loadCycleScopedPlanIntoState y ciclo lifecycle producen; Dashboard, Workout, Builder y blockers consumen | Plan remoto es canon; templates son derivados. Cuatro campos representan una carga lógica | Epoch evita cross-user; falta owner por cycleId/latest request. Estados separados admiten combinaciones transitorias; el lock imperativo evita flash de legacy | user/session scoped, persistido, derivado, ref imperativa, lifecycle sensible | Controller/reducer atómico keyed por cycleId; derivar templates y preservar explícitamente display lock. P3-42/P3-44 | organizatech-app.tsx:924-958,1669-1701,4470-4490 |
| trainingPlan; organizatech-app.tsx:453; useState; root/Training Plan | updateTrainingPlan, scope restore, routine restore, legacy refresh y ciclo remoto producen; Builder, Workout, lifecycle y cálculos consumen | Demo/legacy: draft local persistido. Con ciclo activo: snapshot Supabase domina mediante displayTrainingPlan | Escritura directa verifica active scope; existe dualidad draft local/snapshot remoto y ventanas de drift | user/session scoped, feature-owned, persistido | Encapsular y tipar draftPlan frente a persistedPlan; mantener displayTrainingPlan derivado. P3-44, sobre P3-41/P3-42 | organizatech-app.tsx:774-783,924-930,1311-1315,1643-1649,2131-2139 |
| persistedActiveCycle, persistedCycleHistory, isPersistedCyclesLoading; organizatech-app.tsx:482-484; useState; root/training domain | refreshPersistedTrainingCycles y lifecycle de ciclo producen; Plan, Progress, Workout, menu count y Cycle History consumen | training_cycles de Supabase es canon; estos son caches/proyecciones | Token de epoch descarta otro usuario, pero dos refresh del mismo owner pueden resolver fuera de orden | user/session scoped, persistido remoto, lifecycle/freshness sensible | Mover como unidad al TrainingData boundary con request generation. No hacerlos propiedad del cache de Cycle History. P3-42 | organizatech-app.tsx:1625-1667 |
| routineBuilderState: activeDay/setupByDay; organizatech-app.tsx:443-452 y routine-builder-state.ts; useReducer; root físico/feature semántico | Acciones allowlisted de selección, nombre, filas, replace/reset producen; cards y save consumen | Draft en memoria es canon; routine draft localStorage es recuperación con TTL 48 h y proyección explícita de 11 campos | Loader valida scope/mode/version/TTL y normaliza. Effect de guardado calcula userKey pero no comprueba activeBrowserStorageScopeRef contra él | feature-local, user/session scoped, persistido | Mantener reducer y envolver en hook/controller Routine Builder. Añadir guard de scope capturado; no Zustand global. P3-44 | organizatech-app.tsx:443-452,825-855,1428-1467; routine-builder-state.ts; app-flow-storage.ts:150-279 |
| isEditingRoutinePlan, routineEditorReturnScreen, activeRoutineDay, routineNotice; organizatech-app.tsx:440-441,454,480; useState; root/flow de rutina | Navegación, restore, edit/save/cancel producen; Builder, Dashboard y Workout consumen | Intent de flujo; activeRoutineDay y edición parcial se proyectan a drafts; routineNotice no persiste | No forman transición atómica con reducer/navigation y no todos se limpian en SIGNED_OUT | feature-local/user contextual, UI transitoria, parcialmente persistido, lifecycle sensible | Controller/coordinator de Routine Builder con handoff tipado a navegación/Workout. P3-43/P3-44 | organizatech-app.tsx:825-855,1336-1381,2032-2105 |
| isNewCycleConfirmOpen, isDeleteCycleConfirmOpen, isRoutineSuccessOpen, isRoutineUpdateConfirmOpen; organizatech-app.tsx:485-489; useState; root | Botones/handlers producen; cuatro modales consumen | Sólo intención UI, sin persistencia | No owner/epoch ni reset en SIGNED_OUT. Un intent destructivo iniciado por A puede reaparecer para B y ejecutar callback con el owner actual si B confirma | UI transitoria, feature-local, owner sensible | Colocar junto a la feature y resetear/keyear por identity; no store. P3-41/P3-44 | organizatech-app.tsx:1336-1381,3921-3947 |
| isNewCycleTransitionRef; organizatech-app.tsx:486; useRef; root/Training Plan | startNewTrainingCycle adquiere/libera; bloquea doble ejecución | Lock sólo en memoria | No captura identity/epoch; finally puede liberar/alterar UI tras cambio de owner | ref imperativa, lifecycle/owner sensible | Operation owner ligado a SessionDataRequestToken; mantener privado al controller. P3-41/P3-44 | organizatech-app.tsx:2560-2623 |
| ActiveWorkoutControllerState completo: índice, drafts, readiness/loading/error, start/attempt/link/recovery y completionSummary; active-workout-controller-state.ts y useActiveWorkoutController.ts; useReducer hook; feature | Acciones explícitas de start/recovery/edit/readiness/finish/reset producen; root y pantallas Active Workout consumen | Canon declarativo de la feature; parte se proyecta al workout draft TTL 24 h; summary queda en memoria | Reducer clona/allowlista campos. Reset de identity lo limpia. Debe coordinarse con refs síncronas; no es global | feature-local, user/session scoped, parcialmente persistido, lifecycle sensible | Encapsular reducer + orquestación sin cambiar su contrato. No universalizar. P3-43 | active-workout-controller-state.ts:14-34,494-562; useActiveWorkoutController.ts:65-171; organizatech-app.tsx:461 |
| activeWorkoutAttemptIdRef, pendingReadinessLinkRef, activeWorkoutReadinessContextRef; organizatech-app.tsx:468,476-477; useRef; root/Active Workout | Start/recovery/link/reset producen; awaits, draft y completion consumen | Espejo imperativo fresco de attempt/context; reducer es vista declarativa | Previene lectura same-tick stale. Alto riesgo de divergencia si se mueve o “deduplica” separado del reducer | feature-local, ref imperativa, lifecycle/owner sensible | Internalizar como unidad con reducer; no reemplazar por estado React asíncrono ni serializar. P3-43 | organizatech-app.tsx:1470-1535,2789-3050; src/features/active-workout/active-workout-visual-integration-contract.test.ts:683 |
| workoutStartInFlightRef, dailyReadinessSaveInFlightRef, workoutCompletionInFlightRef; organizatech-app.tsx:469-471; useRef/SessionOperationOwner; Active Workout | tryAcquire/settle/finalize producen/consumen | Owner por operación en memoria, sin persistencia | Captura request token y exige owner+epoch al commit/finally; evita doble acción y que un finally stale libere un lock nuevo | infraestructura feature-local, ref imperativa, lifecycle/owner/epoch sensible | Mantener garantía e internalizarla; no generic busy/provider. P3-41/P3-43 | active-workout-session-boundary.ts:65-118; organizatech-app.tsx:545-589,2789-3489 |
| latestExercisePerformance/Observation, loading/error/didQuery y requestKey refs; useActiveWorkoutExerciseHistory.ts; hook/useState/useRef; feature | Efectos por ejercicio/ciclo producen; GuidedTrainingScreen consume | Resultado remoto derivado, sin persistencia browser | Mount + request key + session token independientes descartan stale; repositories derivan Auth y filtran user_id | feature-local, derivado remoto, lifecycle/freshness sensible | Mantener en hook; no subir a root/store. P3-43 | useActiveWorkoutExerciseHistory.ts:75-220; active-workout-history-load.ts |
| Readiness form y completion summary post-hotfix; TrainingReadinessScreen.tsx y TrainingCompletionSummaryScreen.tsx en a959058; useState sólo en Readiness y componente puro en Completion; owner Active Workout | Sliders/submit producen el draft Readiness; el controller produce summary y Completion sólo lo presenta | Readiness es UI en memoria; summary llega por props. No existen shareModel, estado, refs, handler ni persistencia de compartir en Completion | Readiness se destruye al desmontar. El contrato hotfix exige ausencia de hooks, use client, navigator y símbolos share en Completion | feature-local, UI transitoria/presentacional; sin share UI | Mantener. ShareWorkoutCard no debe montarse en Completion. P3-43 queda independiente de compartir | git show origin/main:src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx; git diff c792abe7012c444cd32edba047d43ad5e48541fb..a959058724b14c3f47d3ebc30286539d75e3fc1c -- src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx |
| ShareWorkoutCard y módulos workout-share model/action/image; share-workout-card.tsx y src/lib/training/workout-share-*.ts; componente/funciones aisladas; sin owner de UI actual | No hay consumidor productivo que monte ShareWorkoutCard ni acción accesible desde la interfaz; sólo definiciones, dependencias internas y tests/contratos las consumen | Infraestructura desconectada; no es fuente de estado global ni persistencia activa de interfaz | El contrato de Active Workout prohíbe la reconexión en Completion. Riesgo: un refactor podría introducir un import visual implícito | feature-local, infraestructura dormante/desconectada, no global | Mantener desconectada. Sin dependencia P3-41–P3-45. Cualquier integración visual futura requiere aprobación explícita y tarea separada | git grep -n 'ShareWorkoutCard' origin/main -- src; git ls-tree -r --name-only origin/main |
| progressControllerState: selectedDay/selectedExerciseId/selectedWeek; organizatech-app.tsx:456 y progress-controller-state.ts; useReducer; root físico/Progress semántico | Selects, Dashboard/Notifications y resets de ciclo producen; selector de Progress consume | Intención UI en memoria; sin persistencia | Reducer mantiene dependencias atómicas, pero applySessionState/SIGNED_OUT no lo resetean. El selector evita mostrar datos de A al recalcular contra fuentes actuales, pero sobrevive intención UI de A | feature-local, UI transitoria, user-contextual | Encapsular/keyear por identity/cycle; exponer intents acotados. P3-44 | progress-controller-state.ts:12-129; organizatech-app.tsx:456-467,1336-1381 |
| progressControllerView, comparisonModel, calendarNormalizedEntries/Sessions, metrics/currentMetrics/summary/weeklyEquivalentProgress; organizatech-app.tsx:959-1015 y progress libs; selector/useMemo; root | Selecciones y training snapshots producen; Progress, Dashboard, Notifications y completion consumen | Totalmente derivados, sin persistencia propia | Heredan freshness de entradas; almacenar agregaría drift | derivado, compartido de dominio | Mantener selectors puros y no almacenar. P3-42/P3-44 | organizatech-app.tsx:959-1015; progress-controller-state.ts:96-129 |
| cycleHistory legacy; organizatech-app.tsx:481; useState; root/fallback | Scope restore y cierre de ciclo demo producen; count/adaptador legacy consumen | Canon demo/fallback en localStorage, sin TTL | Guard de escritura exige active scope; loader sólo valida array, por lo que storage manipulado puede causar fallo/DoS de feature | persistido, demo/user scoped, fallback legacy | Encapsular y normalizar con allowlist; no eliminar fallback legacy. P3-42/P3-45 | organizatech-app.tsx:785-789,1311,2627; app-flow-storage.ts:306-335 |
| CycleHistory snapshot/pdfSnapshot; CycleHistoryProductiveContainer.tsx; useState bridge; feature | Controllers publican; pantalla consume | Controller es canon; bridge no persiste | Lifecycle se crea por identityKey, cleanup invalida todos los controllers; key del container fuerza remount | feature-local, lifecycle sensible | Mantener local por identidad. P3-45 | organizatech-app.tsx:3895-3907; CycleHistoryProductiveContainer.tsx:34-90 |
| CycleHistoryAppState y coordinator cache/inFlight/versions/request IDs; cycle-history-app-controller.ts y cycle-history-coordinator.ts; closures/controllers por instancia | load/retry/toggle/invalidate producen; container/service consumen | Cache en memoria de ready/empty; detail/PDF derivados, no persistencia | lifecycleVersion, request IDs, cycleVersions y sessionVersion implementan latest-wins e invalidación | feature-local, infraestructura, freshness sensible | Mantener privado; nunca singleton multiusuario ni store global. P3-45 | cycle-history-app-controller.ts:11-190; cycle-history-coordinator.ts:38-220 |
| profilePersonalData/loading/error; organizatech-app.tsx:417-419; useState; root/Profile | Bootstrap/refresh/save producen; Profile, view model y Notifications consumen | Fila profiles propia es canon remoto | Reads usan mount+epoch. handleSaveProfilePersonalData no captura/verifica token después del await; una respuesta de A puede poblar memoria de B | user/session scoped, persistido remoto, lifecycle/owner sensible | Profile controller/provider bajo sesión, con operation owner; nunca aceptar id/user_id desde formulario. P3-41/P3-45 | organizatech-app.tsx:1029-1081,1202-1245,1570-1614; profile-repository.ts:42-81 |
| profileAvatar/resetKey/loading/error y cuatro refresh refs; organizatech-app.tsx:420-423,472-475; useState/useRef; root/Profile | Bootstrap, resume, image error y upload producen; avatar/menu/Profile consumen | profiles.avatar_path/version + bucket privado son canon; signed URL es derivada/efímera | Reads tienen epoch/in-flight/throttle. Upload no valida owner post-await; Storage+profiles no son una operación atómica | user/session scoped, persistido remoto, derivado, ref imperativa, lifecycle sensible | Encapsular refs y snapshot en Profile controller; agregar owner y compensación explícita. P3-41/P3-45 | organizatech-app.tsx:1031-1081,1191-1269,1616-1623; profile-avatar-repository.ts |
| sessionName y profileViewModel; organizatech-app.tsx:400,1021-1028; useState/useMemo; root | Auth/Profile escriben sessionName; Profile/menu/Notifications consumen view model | profileViewModel selecciona profile y Supabase user como fuentes; sessionName duplica el nombre | Un commit stale de Profile también contamina sessionName | sessionName: duplicado/derivable; viewModel: derivado | Eliminar el almacenamiento sólo cuando pueda derivarse con el mismo fallback. P3-45 | grep -nE 'sessionName|profileViewModel' src/components/organizatech-app.tsx |
| Profile forms, avatar controls/editor, UserAvatar.imgFailed; ProfileScreen.tsx:131-136,235-249; ProfileAvatarEditor.tsx:34-56; UserAvatar.tsx:18; estado/ref local | Inputs, file picker, crop, image events producen; sólo componentes Profile consumen | Draft/file/blob URL/fallo visual en memoria; sin persistencia de dominio | Object URL tiene cleanup e image load mount guard. Form status/edit/file selection no están keyed por identity | feature-local, UI transitoria, ref imperativa | Mantener local; key/reset por identity para drafts/files. No provider/store. P3-45 | grep -RInE 'use(State|Ref|Effect)' src/components/profile |
| seenNotificationRecords; organizatech-app.tsx:439; useState; root/Notifications | Scope load y markNotificationsSeen producen; notification selector consume | Único estado persistido de Notifications; localStorage scoped y máximo 60 records | Sanitiza id/seenAt. El updater React hace side effect y lee active scope mutable; puede persistir en scope equivocado si cambia identity/replay | user/session scoped, persistido, lifecycle sensible | Reducer puro + efecto con scope/token capturado fuera del updater. P3-41/P3-45 | organizatech-app.tsx:1303-1318,3636-3644; notification-state.ts; browser-storage.ts:178-224 |
| appNotifications, notificationView/lists/counts/badge/subtitle; organizatech-app.tsx:1089-1149; useMemo/selectors; root/Notifications | Profile, plan, sesiones, Progress y seen records producen; topbar/panel consumen | Catálogo completamente derivado; sólo seen records persiste | Hereda freshness de Profile/Training; no posee riesgo cross-user adicional | derivado, feature-local presentation | Mantener puro; no crear tabla/store de notificaciones. P3-45 | notification-model.ts; notification-state.ts; notification-selector.ts; organizatech-app.tsx:1089-1149 |
| dashboardDayOverride; organizatech-app.tsx:455; useState; root físico/Dashboard semántico | Notificaciones y navegación a Dashboard producen; selectors/tarjeta de Dashboard consumen | Intención de selección visual en memoria; sin persistencia propia | No se resetea en clearUserSessionState, por lo que una preferencia de A puede sobrevivir sobre los datos ya saneados de B | feature-local, UI transitoria, user-contextual | Mover/keyear con Dashboard por identity y limpiar en auth reset. No store. P3-43/P3-45 | organizatech-app.tsx:455,979-991,1336-1381,3650-3660 |
| Dashboard carousel y chart tooltip; dashboard-screen.tsx:94-114 y weekly-progress-svg.tsx:20-42; useState/useRef/useMemo; componentes | Scroll/pointer/props producen; sólo Dashboard/chart consumen | UI derivada/transitoria, sin persistencia | Effects sincronizan props; sin ownership remoto | feature-local, UI transitoria, ref imperativa, derivado | No mover. P3-45 | grep -RInE 'use(State|Ref|Memo)' src/features/dashboard/components |
| displayTrainingPlan, selected/displayExercises, displayEntries/Sessions, blockers, week/calendar, workout presentation, profile/notification view models, cycle counts; organizatech-app.tsx:921-1150; expresiones/useMemo; root | Estados canónicos anteriores producen; múltiples pantallas consumen | Sin persistencia propia; todas son proyecciones | Heredan staleness de sus fuentes. Guardarlas crearía verdad duplicada | derivado | Mantener selectors/memos; extraer funciones si ayuda testabilidad, nunca nuevos setters. P3-42/P3-44/P3-45 | sed -n '921,1150p' src/components/organizatech-app.tsx |
| active flow, routine draft y workout draft; app-flow-storage.ts y workout-draft-storage.ts; adapters localStorage; owner de persistencia browser | Effects del root guardan; bootstrap/navigation recuperan | localStorage scoped demo o supabase:UUID; TTL 24 h/48 h/24 h | Validan scope/mode/version/TTL. Routine/active flow writes no comparan siempre active scope ref; workout loader usa spread del objeto parseado antes de normalizar, aunque writes remotos consumen campos explícitos | persistido, user/session scoped, lifecycle sensible | Mantener boundaries separados; capturar scope antes de persistir y proyectar allowlist al leer/escribir. P3-41/P3-43/P3-44 | organizatech-app.tsx:793-898; app-flow-storage.ts; workout-draft-storage.ts:83-173 |
| password recovery flow; browser-storage.ts:38-40,230-275; sessionStorage adapter; auth feature | PASSWORD_RECOVERY/bootstrap producen; route resolver consume | Registro versionado en sessionStorage, TTL 1 h; migra/elimina clave vieja de localStorage | Valida tiempos y limpia expirado; no contiene token de recuperación. URL hash pertenece a Supabase flow | feature-local, persistido temporal, lifecycle sensible | Mantener sessionStorage boundary y cleanup; no mover a generic store/localStorage. P3-41/P3-43 | browser-storage.ts:230-275,350-362; organizatech-app.tsx:4915-4942 |
| repositories y SQL de ownership; data/profile/training repositories y supabase/migrations; boundary I/O | Handlers llaman; Supabase/Auth/RLS ejecutan | Remoto es canon para modo Supabase | Repositories derivan auth.getUser, filtran id/user_id y proyectan payloads. Las funciones inspeccionadas save_training_workout_readiness_v2, link_training_workout_readiness_session_v2, create_training_session_with_entries y create_training_session_with_cycle_entries usan auth.uid, validaciones de ownership y search_path fijo. Estado desplegado y grants no verificados | infraestructura, user/session scoped, security boundary | Mantener allowlists y owner server-side; auditar RLS/grants en QA read-only antes de PROD. Ningún provider debe aceptar ownership editable. P3-41/P3-42/P3-45 | grep -RInE 'auth\.getUser|\.eq\("(id|user_id)|user_id:' src/lib --include='*repository.ts'; grep -InE 'create( or replace)? function|security definer|set search_path|auth\.uid\(\)' supabase/migrations/20260620_training_workout_readiness.sql supabase/migrations/20260709_p0_d1_harden_training_session_entries_writes.sql |

### 3.1. Normalización literal de derivación, persistencia y guards

Esta submatriz forma parte de la matriz completa. Hace explícitos, para cada grupo y en el mismo orden, los tres campos que en la tabla principal se describen junto con el canon y el riesgo. “Ninguna” significa sólo memoria durante el mount. “Gap” significa que no se observó la protección indicada.

| Grupo | ¿Derivado? | Persistencia y ubicación exacta | Guards lifecycle/owner/epoch/freshness |
|---|---|---|---|
| browserClient | No; singleton de infraestructura | Almacenamiento browser administrado por Supabase Auth SDK; backend/clave exactos no inspeccionados | Singleton de módulo + lifecycle del SDK; tokens no expuestos a hijos |
| Snapshot Auth: session/user/mode/source/config | No; snapshot del canon SDK | Ninguna propia de React; la sesión persiste sólo mediante el SDK | identity + scope + generation; gap de invariante user sin session |
| Refs sessionData/active scope/recovery scope | No | Ninguna | mounted + generation + userId + scope; no latest-wins same-owner |
| Bootstrap/listener Auth | Parcial: screen/status son proyecciones del evento | Marker recovery en sessionStorage, clave organizatech:password-recovery-flow | isMounted + request token; gap de refresh duplicado/closure inicial |
| Formularios Auth/password ref | No | Ninguna | Root mount + clearAuthForms; gap de lifecycle demasiado amplio |
| statusMessage/isAuthLoading/isBusy | No | Ninguna | Auth token sólo en algunos flujos; gap de operation owner genérico |
| screen/screenHistory | No; canon de navegación en memoria | localStorage organizatech:active-flow:scope, versión 1, TTL 24 h; history exacto no persiste | Auth reset + scope/mode/version/TTL |
| Menu/panel/topbar | No | Ninguna | Cleanup de overlays; gap de reset completo por identity |
| activeOverlayOwners | No | Ninguna | Owner por instancia, sólo top activo, cleanup en unmount |
| exercises/entries/trainingSessions | No; caches del canon del modo | Supabase remoto; en demo localStorage organizatech:exercises:demo, organizatech:entries:demo y organizatech:training-sessions:demo | scope + epoch; gap de latest-request-wins same-owner |
| cycleScopedPlan/exercises/error/display lock | Parcial: templates/blockers sí; plan/error/lock no | Supabase remoto; sin segunda persistencia propia del snapshot | epoch + display lock; gap de owner latest por cycleId |
| trainingPlan | No para el draft; displayTrainingPlan sí es derivado | localStorage organizatech:training-plan:scope; snapshot activo en Supabase | active scope al guardar + epoch al cargar remoto; dualidad explícita requerida |
| persistedActiveCycle/history/loading | No; caches/proyecciones remotas | Supabase training_cycles y relaciones | epoch; gap de latest request same-owner |
| routineBuilderState | No; canon del draft | localStorage organizatech:routine-draft:scope, versión 1, TTL 48 h | scope/mode/version/TTL + normalización; gap de comparación active scope al guardar |
| Edit/return/day/notice de rutina | No | Parcial en routine draft; routineNotice no persiste | Resets de flujo parciales; gap de transición atómica/identity reset |
| Cuatro flags de modales | No | Ninguna | Gap: sin owner/epoch y sin reset SIGNED_OUT |
| isNewCycleTransitionRef | No | Ninguna | Lock booleano; gap de identity/epoch |
| ActiveWorkoutControllerState | Parcial: summary/loading son snapshots derivados; draft/start son canon feature | localStorage organizatech:workout-draft:scope, versión 1, TTL 24 h para la proyección recuperable | Reducer allowlist + identity reset; operation owners externos |
| Refs attempt/link/context | No; espejos imperativos intencionales | Proyección allowlisted dentro de workout draft | Freshness same-tick + secuencia reset; deben moverse con reducer |
| Locks Active Workout | No | Ninguna | SessionOperationOwner + request token + equality al settle/finalize |
| Historial de ejercicio | Sí; resultado remoto para presentación | Ninguna browser; fuente remota Supabase | mounted + request key + session token + owner filtrado en repository |
| Readiness form/completion post-hotfix | No para los inputs Readiness; Completion sólo presenta summary derivado recibido por props | Ninguna | Readiness se destruye al desmontar; Completion no posee hooks/refs/share |
| Infraestructura ShareWorkoutCard/workout-share | No aplica a estado montado: está desconectada | Ninguna persistencia de interfaz activa | Contrato negativo en Completion; futura reconexión requiere autorización explícita |
| Selección Progress | No; canon de intención UI | Ninguna | Reducer valida dependencias; gap de reset/key por identity |
| Views/métricas Progress | Sí | Ninguna | Heredan epoch/freshness de TrainingData |
| cycleHistory legacy | No; canon demo/fallback | localStorage organizatech:cycle-history:scope, sin TTL | active scope al guardar; gap de allowlist estructural al leer |
| Cycle History snapshots React/PDF | Sí; bridge de controllers | Ninguna | key/identityKey + cleanup invalidateAll |
| Cycle History app controller/coordinator | Parcial: app state es canon feature; cache/detail/PDF son derivados | Memoria de la instancia, ninguna browser | lifecycleVersion + requestId + cycleVersion + sessionVersion |
| Profile personal data | No; snapshot del canon remoto | Supabase tabla profiles | Reads mounted+epoch; gap de owner post-await en save |
| Profile avatar/refresh refs | Parcial: path/version son snapshot; signed URL es derivada | Supabase profiles + bucket privado de avatar | Reads epoch/in-flight/throttle; gap de owner en upload y atomicidad Storage/Postgres |
| sessionName/profileViewModel | Sí/parcial: sessionName es copia almacenada; view model es derivado | Ninguna | Hereda guards de Auth/Profile; gap por commit stale |
| UI local Profile | Parcial: initial/imgFailed son derivados; drafts/file/crop son UI canónica local | Ninguna; blob URL sólo memoria y se revoca | Object URL cleanup + image mount guard; gap de key identity para form/file |
| seenNotificationRecords | No; canon de preferencia local | localStorage organizatech:seen-notifications-v2:scope, máximo 60 | scope + saneamiento; gap por ref mutable dentro del updater |
| Catálogo/view/badges Notifications | Sí | Ninguna; sólo seen records de la fila anterior | Hereda freshness de Profile/Training/Progress |
| dashboardDayOverride | No; canon de intención UI | Ninguna | Gap de reset/key por identity |
| Carousel/chart Dashboard | Parcial: modelos memoizados sí; interacción no | Ninguna | Sync por props/effects + mount local |
| Proyecciones root 921-1150 | Sí | Ninguna | Heredan todos los guards de sus fuentes |
| Active flow/routine/workout records | No; snapshots recuperables | localStorage organizatech:active-flow:scope, organizatech:routine-draft:scope y organizatech:workout-draft:scope | scope/mode/version/TTL; gaps de active-scope write y allowlist completa del workout loader |
| Password recovery marker | No; flag lifecycle | sessionStorage organizatech:password-recovery-flow, versión 1, TTL 1 h | Validación temporal + cleanup/migración de clave vieja |
| Repositories/SQL | No aplica: boundary I/O, no state React | Supabase Postgres/Storage | auth.getUser + filtros owner + allowlists; funciones nombradas con auth.uid/ownership/search_path; remoto no verificado |

## 4. Estado realmente global confirmado

### Hechos observados

| Ámbito | Estado confirmado | Motivo |
|---|---|---|
| Singleton de proceso/browser | Cliente Supabase browserClient | Una instancia compartida administra el SDK de Auth. Es infraestructura; el token no debe propagarse. |
| Singleton UI | activeOverlayOwners | Coordina el overlay superior, Escape y restauración de foco entre drawer, paneles y modales. |
| Boundary de aplicación | Identidad de sesión, scope y epoch | Todos los commits user-scoped dependen de una identidad vigente y de su invalidación. |
| Boundary de aplicación | screen/screenHistory y política de restore/reset | Decide qué feature está activa y aplica transiciones de Auth y flujos recuperables. |
| Datos compartidos, no universales | exercises, entries, trainingSessions y ciclo/plan activos | Los consumen tres o más features, pero pertenecen exclusivamente a la sesión vigente y al modo de datos. |

No se confirmó ningún objeto de dominio que deba vivir como singleton mutable fuera del árbol React. Tampoco se confirmó un motivo para introducir un store universal. “Compartido” no equivale a “sin owner”: los datos de entrenamiento deben estar subordinados a identity/scope/epoch.

### Recomendación

Usar, como máximo, providers acotados para SessionBoundary, Navigation y TrainingData. Las features deben consumir snapshots e intents; no deben mutar user_id, scope, epoch, token ni caches de otras features.

## 5. Estado alojado en root que debería encapsularse

### Recomendaciones

| Prioridad | Grupo en root | Owner destino | Garantía que debe preservarse |
|---|---|---|---|
| 1 | supabaseSession/user, mode/source, session refs, bootstrap | SessionBoundary | Invalidar antes de commits/cleanup, mismo owner en todos los awaits, TOKEN_REFRESHED sin cambio artificial de epoch, raw session privado |
| 2 | exercises/entries/trainingSessions, ciclos y plan cycle-scoped | TrainingData controller/provider | Scope por identity, limpieza antes de load, source switch legacy/cycle, display lock y latest-request-wins |
| 3 | screen/history y active-flow restore | Navigation controller/provider | Reset de historial en Auth, intents tipados, restore con TTL/scope, handoff con Workout/Routine |
| 4 | reducer + refs/locks de Active Workout | Active Workout orchestrator | Same-tick refs, SessionOperationOwner, reset por identity, draft boundary, freshness del historial y fallback legacy |
| 5 | trainingPlan, Routine Builder, lifecycle de ciclo y modales | Training Plan/Routine controllers | Distinguir draft local de snapshot remoto; batch ligado a una identidad; no eliminar fallback |
| 6 | selección de Progress | Progress controller | Reset/key por identity/cycle; métricas siguen derivadas |
| 7 | Profile snapshot/avatar/refresh refs | Profile controller bajo sesión | Owner post-await, signed URL derivada, file/form local, no ownership editable |
| 8 | seenNotificationRecords | Notifications controller mínimo | Transición pura y persistencia con scope capturado |
| 9 | auth drafts, generic status/busy, overlays y modales | Pantalla/feature/App Shell | Lifecycle corto, reset por identity y operación; no generic store |

Encapsular no significa reescribir arquitectura. Cada paso debe poder hacerse como extracción puntual con contratos estáticos existentes y sin mover simultáneamente identity, persistence y UI.

## 6. Estado que debe permanecer feature-local

### Hechos y recomendación

- Active Workout: reducer, attempt/link/context refs, locks por operación, historial de ejercicio, readiness form y completion summary. Pueden quedar juntos dentro de un orchestrator, pero no en un store global. El completion summary no posee estado ni UI de compartir después del hotfix.
- ShareWorkoutCard y los módulos workout-share permanecen feature-local y desconectados. “Feature-local” no autoriza montarlos: no existe integración visual aprobada.
- Progress: selectedDay, selectedExerciseId y selectedWeek. Dashboard/Notifications deben enviar intents estrechos, no poseer el reducer.
- Cycle History: container, app controller, coordinator cache, PDF controller y snapshots. Su instancia por identity es una garantía de seguridad.
- Routine Builder: activeDay/setupByDay, draft de edición, modales y mensajes propios.
- Profile: valores/errores del formulario, archivo seleccionado, crop/zoom/offset, blob URL, drag refs e imgFailed.
- Dashboard: carousel day/ref, índice y tooltip del gráfico.
- Dashboard: dashboardDayOverride debe quedar con la feature y resetearse por identity.
- App Shell: menu/panel/topbar y refs de foco, siempre reseteados por auth boundary.
- Password recovery: estado y persistencia temporal de la feature Auth.

Nada de lo anterior debe ascender por conveniencia de acceso. Si otra feature necesita activar una transición, debe usar un intent/callback tipado.

Ninguna extracción de estado, infraestructura o refactor puede introducir cambios visuales implícitos. Una propuesta visual futura debe tener aprobación explícita del dueño de producto, alcance propio y QA visual separado.

## 7. Estado derivado que no debe almacenarse

### Hechos observados

No deben recibir setter, persistencia ni segunda fuente canónica:

- hasSupabaseSession y canEditProfilePersonalData.
- persistedActiveCyclePlan, displayTrainingPlan, selectedExercises y displayExercises.
- displayEntries y displayTrainingSessions.
- flags y mensajes de blockers cycle-scoped.
- calendarNormalizedEntries y calendarNormalizedTrainingSessions.
- currentWeek, metrics, currentMetrics, summary y weeklyEquivalentProgress.
- hasTrainingEntries, hasRoutinePlan, routineDays, visibleDay, dayExercises y visibleRoutine.
- activeWorkoutExercise, lineage/id, variant, target/current summaries y counts.
- progressControllerView y comparisonModel.
- visibleCycleHistoryCount y visibleCycleNumber.
- profileViewModel, incluida la resolución del nombre.
- completedTrainingDays, todayTrainingNotificationContext y topbar model.
- appNotifications, notificationView, grupos, conteos, badge, subtitle y aria label.
- detalles, breakdown, métricas y pdfModel de Cycle History fuera de la cache privada de su coordinator.

### Recomendación

Extraer selectors puros cuando reduzca el root, pero conservar una sola dirección de datos. La memoización es una optimización; no transforma un modelo derivado en fuente de verdad.

## 8. Lifecycle, owner, epoch y freshness críticos

### Hechos observados

| Boundary | Garantía actual | Gap observado |
|---|---|---|
| Mount del root | sessionDataMountedRef y epoch forzado en cleanup bloquean commits después de unmount | No todas las mutaciones usan el token |
| Cambio de identity/scope | applySessionState avanza epoch, resetea Active Workout y limpia snapshots antes de cargar scope nuevo | Deja intents UI, Progress y varios flags de feature |
| SIGNED_OUT | Avanza epoch forzado, invalida Active Workout, limpia storage del scope saliente, sesión y datos | No cierra NotificationPanel ni cuatro modales; tampoco resetea Progress, overrides ni todo el flujo de rutina |
| TOKEN_REFRESHED | Con mismo user/scope no avanza epoch | applySessionState limpia Profile/avatar en cada evento; las mutaciones de Profile sin owner pueden intercalarse |
| Invariante Auth | hasSupabaseSession exige session+user | El registro con confirmación puede publicar result.data.user sin session; canEditProfilePersonalData sólo exige user+client |
| Sign-out | SIGNED_OUT centraliza invalidación correcta | Update password no inspecciona el error de signOut; logout elimina storage antes de saber si signOut tuvo éxito |
| Bootstrap/refresh | Epoch evita commits de otra identity | Bootstrap y listener pueden refrescar en la misma generation sin latest-wins; refreshData absorbe error y callers pueden continuar restore/navigation |
| Reads Profile/Training | Capturan SessionDataRequestToken y verifican post-await | No hay latest-request-wins para dos requests del mismo owner en refreshData/ciclos/plan |
| Writes Profile/avatar | Repository deriva Auth y allowlista payload | Handler root no verifica owner post-await; commit visual stale/cross-user posible |
| Batch legacy de rutina | Cada repository call deriva Auth y filtra owner | No hay identidad única para todo el batch; un cambio entre iteraciones puede redirigir payload del draft previo al usuario nuevo |
| Ciclo create/delete | Lock booleano o busy evita dobles clicks locales | Locks/finally no llevan identity/epoch |
| Active Workout | SessionOperationOwner exige token+lock vigente en settle/finalize | Garantía se perdería si refs/reducer se separan |
| Cycle History | Controller/coordinator por identity con lifecycle/request/cycle/session versions | Depende de remount/identityKey; no volverlo singleton |
| Browser writes | Scope UUID, version y TTL en varios records | Routine/active-flow effects no verifican siempre active scope; localStorage no es frontera de confidencialidad |
| Notifications seen | Sanitiza y limita records | Side effect dentro del updater usa scope ref mutable |

### Recomendación

La unidad mínima de una operación user-scoped debe capturar una vez owner = {userId, scope, generation, operationId}. Todo commit, catch y finally debe verificar que el owner sigue vigente. Los batches deben conservar el mismo owner lógico de principio a fin; reconsultar Auth sirve para verificar, no para cambiar silenciosamente el destinatario de un payload ya preparado.

## 9. Persistencia y boundaries

### Hechos observados

| Record | Ubicación y scope | TTL/validación | Sensibilidad y owner |
|---|---|---|---|
| Auth session/refresh | Almacenamiento del navegador administrado por Supabase Auth SDK; backend y clave exactos no se inspeccionaron | SDK | Tokens sensibles; canon exclusivo de Auth SDK |
| exercises/entries/trainingSessions | localStorage sólo para demo | Validación legacy parcial | Datos de entrenamiento del scope demo compartido en ese navegador |
| trainingPlan | localStorage, demo o supabase:UUID | Normalización al leer; sin TTL | Draft user-scoped; puede coexistir con snapshot remoto |
| cycleHistory legacy | localStorage scoped | Sólo array; sin TTL | Historial de entrenamiento; requiere normalización más fuerte |
| activeFlow | localStorage scoped | Versión 1, mode/userKey, TTL 24 h | Ruta/flow de la sesión |
| routineDraft | localStorage scoped | Versión 1, mode/userKey, TTL 48 h, recovery normalizada, allowlist de 11 campos al escribir | Rutina editable y navegación asociada |
| workoutDraft | localStorage scoped | Versión 1, mode/userKey, TTL 24 h, IDs/readiness/drafts normalizados | Datos de entrenamiento y observaciones en texto plano |
| seenNotifications | localStorage scoped | id/seenAt sanitizados, máximo 60 | Preferencias user-scoped |
| password recovery marker | sessionStorage | Versión 1, TTL 1 h; clave vieja localStorage eliminada | Sólo estado del flow, no token |
| Profile/avatar/training/cycles | Supabase Postgres/Storage | Auth, RLS/policies/RPC según SQL versionado | Canon remoto user-owned |

Las claves usan prefijos organizatech:* y scope demo o supabase:UUID. La migración legacy se dirige a demo, no a una identidad autenticada. Logout elimina el scope saliente previsto. Sin embargo, localStorage es legible por JavaScript del mismo origen y por usuarios con acceso al dispositivo; scope y TTL reducen mezcla accidental, no sustituyen una frontera de confidencialidad ni una CSP robusta.

### Recomendaciones

- Mantener cada adapter de persistencia fuera de stores serializables.
- Capturar identity/scope antes de cada save y rechazar si cambia.
- Proyectar records allowlisted también al leer workout/cycle history; no conservar propiedades extra de JSON manipulado.
- No eliminar fallbacks legacy sin autorización y migración explícita.
- No persistir tokens, refs, operation owners, signed URLs ni modelos derivados.

## 10. Riesgos de seguridad y regresión

### Escenarios de riesgo derivados de hechos observados

La base factual está registrada en las matrices de las secciones 3, 8 y 9. Los ítems siguientes son escenarios e inferencias de riesgo construidos desde esas líneas de código; no son afirmaciones de explotación runtime. Las acciones propuestas están separadas en la sección 11.

1. **ALTO — cambio de identidad durante mutaciones largas.** handleSaveProfilePersonalData, handleUploadProfileAvatar, saveInitialRoutine, startNewTrainingCycle y deleteCurrentTrainingCycle no están gobernados de extremo a extremo por un owner/epoch. El batch legacy de rutina vuelve a resolver Auth en cada iteración; payload preparado por A podría intentar escribirse bajo B tras un cambio externo de sesión.
2. **ALTO — intent UI cross-user retenido.** SIGNED_OUT no resetea NotificationPanel ni los cuatro modales. El confirm de borrado iniciado por A puede reaparecer bajo B y, si se confirma, invocar el callback con la identidad vigente. También sobreviven selección de Progress y otros flags/overrides, aunque sus selectors limitan exposición de datos.
3. **ALTO en memoria UI — commits stale de Profile/avatar.** Las lecturas están protegidas, las escrituras no verifican el token al resolver. Una respuesta de A puede poblar state tras logout o en la sesión B; el repository sí protege la fila remota, pero no el commit React.
4. **ALTO de invariante — user sin sesión efectiva.** En registro con confirmación pendiente se aplica user = session.user o result.data.user aunque session sea null; el scope resultante es demo y canEditProfilePersonalData se deriva de user+client. La pantalla actual termina en Login y no se observó explotación, pero el modelo permite que “user presente” no signifique “autenticado”.
5. **MEDIO-ALTO — error de signOut ignorado al actualizar contraseña.** El handler arma passwordUpdateSuccessRef y espera signOut sin inspeccionar el error devuelto. Puede navegar/limpiar recovery mientras la sesión sigue activa y dejar el ref preparado para un SIGNED_OUT posterior no relacionado.
6. **MEDIO — logout destructivo antes de confirmación.** handleLogout borra el scope local antes de comprobar signOut. Si falla, la sesión continúa, pero plan, drafts, flow, history y preferencias vistas ya se perdieron.
7. **MEDIO-ALTO — freshness same-user.** refreshData, refreshPersistedTrainingCycles y loadCycleScopedPlanIntoState protegen epoch, pero no latest-request-wins por recurso/cycleId. Bootstrap y listener también pueden lanzar refresh para la misma generation. Una respuesta vieja puede reemplazar una nueva.
8. **MEDIO — continuidad tras error de refresh.** refreshData traduce el error a null/estado y sus callers no reciben éxito/fallo; bootstrap/listener/login pueden continuar restore o navegación. El effect auth con dependencias vacías también captura la versión inicial de handlers/dataMode; la consecuencia runtime requiere prueba dirigida.
9. **MEDIO — fuentes duplicadas de Training Plan.** trainingPlan browser/legacy y persistedActiveCycle remoto confluyen en displayTrainingPlan. Sin tipos/owner explícitos puede persistirse o mostrarse el snapshot equivocado durante transiciones.
10. **MEDIO — persistencia browser.** Workout/routine/history contienen entrenamiento en texto plano; XSS/devtools/shared device pueden leerlo. Routine/active-flow writes carecen del mismo guard de active scope usado por trainingPlan. Los scopes huérfanos pueden quedar tras cierre abrupto.
11. **MEDIO — seen notifications.** El side effect dentro del updater React usa una ref mutable y podría escribir records bajo otro scope durante cambio/replay.
12. **MEDIO — avatar no atómico.** Storage y update de profiles son operaciones separadas; un fallo intermedio puede dejar objeto huérfano o referencia rota.
13. **BAJO-MEDIO — validación local.** cycleHistory valida sólo array; workout draft preserva propiedades extra al reconstruir con spread. No se observó mass assignment a Supabase porque consumers remotos proyectan campos explícitos.
14. **BAJO — intención de Progress/Profile local no keyed.** Puede sobrevivir estado UI de la identidad anterior; las fuentes remotas se limpian y los selectors hacen fallback, por lo que no se observó lectura BOLA directa.
15. **BOUNDARY NO CERTIFICADO — RLS/grants.** El repo evidencia auth.getUser, filtros id/user_id, payloads allowlisted, policies de avatar privado y, sólo para las cuatro funciones nombradas en esta auditoría, auth.uid/ownership/search_path. No se verificó el estado desplegado de QA/PROD ni column-level grants. RLS de filas no sustituye hardening de columnas.

### BOLA/IDOR y mass assignment

- No se observaron setters frontend de owner_id o profile_id en estas superficies.
- user_id y profiles.id se derivan del usuario autenticado en repositories; updates/deletes observados filtran owner.
- Profile allowlista campos personales y excluye id/email/ownership/avatar/streak.
- El path canónico de avatar está subordinado al UUID autenticado y el SQL versionado restringe el bucket privado al owner.
- Las funciones inspeccionadas save_training_workout_readiness_v2, link_training_workout_readiness_session_v2, create_training_session_with_entries y create_training_session_with_cycle_entries derivan auth.uid, validan ownership relevante y fijan search_path.
- Los IDs restaurados desde localStorage son input no confiable; no otorgan ownership y deben seguir revalidados server-side.
- No se afirma que la instancia remota tenga las migrations/policies/grants observadas. La verificación futura debe ser QA read-only primero.

## 11. Recomendaciones ordenadas para P3-41 a P3-45

Esta asignación es una **propuesta de esta auditoría**, no una descripción de tickets observada en el repositorio.

La cancelación de P3-39C1 no cambia la secuencia ni las decisiones de estado global:

| Tramo | Impacto de la cancelación/hotfix |
|---|---|
| P3-41 | Sin cambio: SessionBoundary, identity y operation owners no dependen de compartir |
| P3-42 | Sin cambio: TrainingData y fuentes canónicas no dependen de compartir |
| P3-43 | Sólo cambia el guardrail: Completion debe permanecer sin ShareWorkoutCard, hooks o acciones de share; no hay integración pendiente |
| P3-44 | Sin cambio: Training Plan, Routine Builder y Progress son independientes de compartir |
| P3-45 | Sin cambio de ownership: Profile, Notifications, Cycle History y limpieza del root no pueden reconectar UI como efecto lateral |

### P3-41 — SessionBoundary y operaciones user-scoped

1. Encapsular identity/scope/epoch y una API de request/operation owner.
2. Preservar el orden: invalidar owners y memoria, limpiar scope saliente y recién después publicar sesión nueva.
3. Cerrar/resetear overlays, modales, Progress y flows feature-local al cambiar identity.
4. Aplicar owner a Profile/avatar, batch de rutina y ciclo create/delete; catch/finally stale no deben tocar estado nuevo.
5. Mantener TOKEN_REFRESHED con el mismo epoch si user/scope no cambia y evitar reset innecesario de Profile.
6. Imponer authenticatedUser = session.user; las capacidades de escritura deben requerir sesión efectiva.
7. Inspeccionar el resultado de signOut antes de navegar/limpiar; no borrar el scope hasta confirmar cierre o recibir SIGNED_OUT.
8. Hacer que refreshData entregue un resultado explícito y que bootstrap/listener no continúen restore/navigation después de fallo.
9. Mantener raw session/token dentro del boundary/SDK.

**Gate:** pruebas estáticas y runtime posteriores deben demostrar A → SIGNED_OUT → B con requests pendientes, sin commits ni intents de A sobre B.

### P3-42 — TrainingData boundary y fuente canónica

1. Agrupar exercises, entries, trainingSessions, persisted cycles y carga cycle-scoped bajo identity.
2. Añadir latest-request-wins por recurso y cycleId.
3. Hacer atómico el snapshot cycle-scoped; conservar display lock y source switch legacy/cycle.
4. Diferenciar Supabase canon, demo local canon y snapshots derivados.
5. Mantener repositories/storage como adapters y el fallback legacy.

**Gate:** no duplicar datos en Progress/Workout/Plan y no cambiar ownership remoto ni training_sessions/exercise_entries fuera del alcance de un ticket autorizado.

### P3-43 — Navegación, App Shell y Active Workout

1. Extraer screen/history/restore/reset a un controller de navegación con intents tipados.
2. Mantener menu/panel/topbar en App Shell, con reset por identity y un solo stack de overlays.
3. Encapsular reducer, refs attempt/link/context, operation owners, draft boundary e historial de Active Workout como una unidad.
4. Mantener formularios Auth y Readiness locales. TrainingCompletionSummaryScreen debe seguir presentacional y sin estado, handlers o componentes de compartir.
5. No convertir refs de freshness ni identity en estado serializable.

**Gate:** equivalencia de back/history, reentry, pause/resume, recovery, doble click y SIGNED_OUT; además, el diff no puede montar ShareWorkoutCard ni añadir acciones de share en Completion.

### P3-44 — Training Plan, Routine Builder y Progress

1. Mantener routineBuilderReducer, pero trasladar su lifecycle a un controller feature-local.
2. Tipar draftPlan local frente a persistedPlan remoto y conservar displayTrainingPlan derivado.
3. Hacer que saves/batches usen un owner inmutable durante toda la operación.
4. Mover modales/notice/edit flow al owner de la feature y resetear por identity.
5. Encapsular selección de Progress y keyearla por identity/cycle; mantener todas las métricas como selectors.

**Gate:** recuperación de drafts 48 h, source switch, lifecycle de ciclos, navegación desde Dashboard/Notifications y fallback legacy sin regresión.

### P3-45 — Profile, Notifications, Cycle History y reducción final del root

1. Profile controller user-scoped con reads/writes owner-safe; signed URL derivada y form/file/crop locales.
2. Derivar sessionName/profileViewModel desde fuentes canónicas.
3. Notifications siguen derivadas; seen records usan transición pura y persistencia con scope capturado.
4. Conservar Cycle History controller/coordinator por identity y endurecer sólo el adapter legacy.
5. Remover del root únicamente estado ya transferido y duplicados realmente derivables; no tocar owners/refs por “limpieza”.
6. Ejecutar auditoría final de imports/consumidores para confirmar que no apareció un segundo canon.

**Gate:** QA manual y pruebas de seguridad se ejecutan en el ticket de implementación correspondiente; P3-40 no las afirma.

Guardrail común a P3-41–P3-45: una tarea de infraestructura, ownership, provider, controller, refactor o limpieza no incluye autorización visual. No se puede reconectar la infraestructura de compartir ni alterar la interfaz de Completion como cambio incidental.

## 12. Decisión de arquitectura y producto: hotfix PR #61 y P3-39C1 cancelada

### Hechos Git observados

- Después de git fetch origin, origin/main apunta exactamente a a959058724b14c3f47d3ebc30286539d75e3fc1c.
- a959058 es el merge de PR #61: Remove unapproved workout share card from completion summary.
- El delta directo desde c792abe modifica sólo:
  - src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx;
  - src/features/active-workout/active-workout-visual-integration-contract.test.ts.
- La estadística del delta es 23 inserciones y 185 eliminaciones; 85 líneas se eliminan del componente.
- En a959058, TrainingCompletionSummaryScreen:
  - no importa ni monta ShareWorkoutCard;
  - no declara use client, hooks, shareModel, refs, flags, status ni handleShareWorkout;
  - no usa Web Share, clipboard ni navigator;
  - conserva el resumen existente, la tabla y el CTA Ir al panel principal.
- El contrato estático del hotfix prohíbe ShareWorkoutCard, builders de modelo/payload, executeWorkoutShareAction, handleShareWorkout, shareModel, navigator y Compartiendo... dentro de esa pantalla; también exige ausencia de useEffect, useRef y useState.
- El componente ShareWorkoutCard, su CSS y los módulos workout-share model/action/image continúan en el árbol. No tienen un consumidor productivo que los conecte con la interfaz; permanecen como infraestructura aislada con tests/contratos.
- El hotfix no modifica organizatech-app.tsx, providers, auth/session, navegación, repositories, storage, Supabase ni las restantes features auditadas.

### Decisiones de alcance comunicadas

Los siguientes puntos son decisiones de producto proporcionadas para esta actualización; no se infieren sólo del SHA:

- P3-39C1 fue cancelada.
- Su hoja de planificación fue archivada y no es una fuente activa de requerimientos.
- No existe merge, inventario o controller de preparación pendiente asociado a P3-39C1.
- ShareWorkoutCard no debe volver a montarse en TrainingCompletionSummaryScreen.
- La infraestructura de compartir permanece desconectada de la interfaz.
- La existencia de código aislado no constituye aprobación para mostrarlo, conectarlo ni expandirlo.
- Cualquier integración visual futura requiere una nueva decisión, una tarea separada y aprobación explícita del dueño de producto.

### Decisión de arquitectura

El share desconectado no es estado global, no pertenece al SessionBoundary, no requiere provider/store y no debe incorporarse al orchestrator de Active Workout. Tampoco debe eliminarse incidentalmente como parte de una limpieza: conectar, rediseñar o retirar esa infraestructura exige alcance explícito.

Las recomendaciones P3-41–P3-45 permanecen válidas e independientes. La única modificación es el guardrail de P3-43 y P3-45: los refactors deben conservar el completion summary presentacional y no pueden introducir cambios de DOM, componentes, estilos, copy o navegación de share.

## 13. Comandos reproducibles

### Fetch autorizado y evidencia del hotfix

~~~text
git fetch origin
git rev-parse origin/main
git merge-base --is-ancestor a959058724b14c3f47d3ebc30286539d75e3fc1c origin/main
git rev-list --parents -n 1 a959058724b14c3f47d3ebc30286539d75e3fc1c
git merge-base c792abe7012c444cd32edba047d43ad5e48541fb a959058724b14c3f47d3ebc30286539d75e3fc1c
git diff --name-status c792abe7012c444cd32edba047d43ad5e48541fb..a959058724b14c3f47d3ebc30286539d75e3fc1c
git diff --stat c792abe7012c444cd32edba047d43ad5e48541fb..a959058724b14c3f47d3ebc30286539d75e3fc1c
git show origin/main:src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx
git show origin/main:src/features/active-workout/active-workout-visual-integration-contract.test.ts
git grep -n 'ShareWorkoutCard' origin/main -- src
git ls-tree -r --name-only origin/main | grep -E 'share-workout-card|workout-share'
~~~

### Preconditions y base

~~~text
pwd
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git merge-base HEAD origin/main
git status --porcelain=v1
git rev-parse --git-path MERGE_HEAD
git rev-parse --git-path rebase-merge
git rev-parse --git-path rebase-apply
git rev-parse --git-path CHERRY_PICK_HEAD
git rev-parse --git-path REVERT_HEAD
git stash list --format='%gd%x09%H%x09%gs'
git rev-parse stash@{0}
~~~

Para confirmar que no hay operación pendiente, verificar que MERGE_HEAD, CHERRY_PICK_HEAD y REVERT_HEAD no existan y que rebase-merge/rebase-apply no sean directorios.

### Inventario

~~~text
grep -nE 'use(State|Reducer|Ref)[<(]' src/components/organizatech-app.tsx
find src -type f | sort
grep -RInE 'import.*(createContext|useContext)|React\.createContext|from "zustand"|from '\''zustand'\''' src --include='*.ts' --include='*.tsx'
grep -nE 'SIGNED_OUT|TOKEN_REFRESHED|onAuthStateChange|applySessionState|clearUserSessionState' src/components/organizatech-app.tsx
grep -RInE 'activeOverlayOwners|useOverlayFocusManagement' src --include='*.ts' --include='*.tsx'
grep -RInE 'auth\.getUser|\.eq\("(id|user_id)|user_id:' src/lib --include='*repository.ts'
grep -InE 'security definer|set search_path|auth\.uid\(\)' supabase/migrations/*.sql
sed -n '398,493p' src/components/organizatech-app.tsx
sed -n '603,910p' src/components/organizatech-app.tsx
sed -n '921,1388p' src/components/organizatech-app.tsx
sed -n '1537,1701p' src/components/organizatech-app.tsx
sed -n '2032,2105p' src/components/organizatech-app.tsx
sed -n '2789,3489p' src/components/organizatech-app.tsx
~~~

### Validación del entregable

~~~text
git status --short --branch
git diff --check
git diff --stat
git diff --name-status
grep -nE '^(<<<<<<<|=======|>>>>>>>)' docs/p3-40-global-state-audit.md
git status --porcelain=v1
git diff --name-only
git ls-files --others --exclude-standard
git stash list --format='%gd%x09%H%x09%gs'
git rev-parse stash@{0}
~~~

Como el documento es nuevo y no trackeado, git diff no lo incluye hasta staging. Sin mutar el índice, su contenido puede validarse adicionalmente con:

~~~text
git diff --no-index --check /dev/null docs/p3-40-global-state-audit.md
git diff --no-index --stat /dev/null docs/p3-40-global-state-audit.md
git diff --no-index --name-status /dev/null docs/p3-40-global-state-audit.md
git diff --no-index -- /dev/null docs/p3-40-global-state-audit.md
~~~

El exit 1 de git diff --no-index significa “hay diferencias” y es esperado para un archivo nuevo; los diagnostics de --check deben permanecer vacíos.

### Resultados post-escritura observados

- git fetch origin terminó con exit 0.
- git rev-parse origin/main devolvió a959058724b14c3f47d3ebc30286539d75e3fc1c y merge-base --is-ancestor confirmó que origin/main contiene ese commit.
- El diff c792abe..a959058 mostró únicamente TrainingCompletionSummaryScreen.tsx y active-workout-visual-integration-contract.test.ts.
- git status --short --branch mostró la rama revisar-texto-adjunto y sólo ?? docs/p3-40-global-state-audit.md.
- git status --porcelain=v1 y git ls-files --others --exclude-standard confirmaron que el único delta es docs/p3-40-global-state-audit.md.
- git diff --check terminó con exit 0 y sin diagnostics.
- git diff --stat, git diff --name-status y git diff --name-only no mostraron deltas trackeados, porque el documento nuevo permanece sin staging.
- git diff --no-index --check /dev/null docs/p3-40-global-state-audit.md no produjo diagnostics; su exit 1 es el esperado por existir el archivo nuevo.
- git diff --no-index --stat y --name-status identificaron un único archivo agregado: docs/p3-40-global-state-audit.md.
- git diff --no-index -- /dev/null docs/p3-40-global-state-audit.md produjo el diff exacto completo del documento sin mutar el índice.
- La búsqueda de marcadores de conflicto no encontró coincidencias.
- HEAD continuó en c792abe7012c444cd32edba047d43ad5e48541fb; origin/main quedó en a959058724b14c3f47d3ebc30286539d75e3fc1c; su merge-base continuó en c792abe7012c444cd32edba047d43ad5e48541fb.
- MERGE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD, rebase-merge y rebase-apply continuaron ausentes.
- stash@{0} continuó en 7e618d67efb4290082a4f6be258c1f75640856c8 con la descripción protegida original.
- No se ejecutaron npm test, npm run typecheck ni npm run build.

## 14. Limitaciones

- Es una auditoría estática del inventario original en HEAD c792abe más el delta hotfix inspeccionado desde origin/main en a959058; no valida comportamiento runtime.
- No se ejecutaron npm test, npm run typecheck ni npm run build porque el único cambio es documental y no forman parte de las validaciones solicitadas para este checkpoint.
- No hubo QA manual ni navegación en browser.
- No se consultó ni modificó Supabase QA/PROD. El SQL del repositorio no demuestra qué migrations, RLS, policies o grants están desplegados.
- No se verificó column-level hardening remoto. Debe hacerse primero en QA y en modo SQL read-only.
- No se inspeccionaron otros worktrees ni una implementación cancelada de P3-39C1.
- La cancelación de P3-39C1, el archivo de su hoja y la prohibición visual son decisiones de alcance comunicadas para esta actualización.
- origin/main confirma el merge Git a959058; no se verificó un deployment de Vercel ni se afirma cobertura runtime de producción.
- Los contenidos propuestos para P3-41 a P3-45 son decisiones habilitadas por esta auditoría, no especificaciones de tickets encontradas en la base.
- Las severidades describen riesgo técnico reproducible por lectura; requieren pruebas controladas en el ticket de remediación antes de afirmar exploitabilidad runtime.

## 15. Gate obligatorio de cierre y no cambio visual

P3-40 no depende de ningún merge futuro de P3-39C1. Para P3-41–P3-45 y cualquier refactor posterior se debe confirmar:

1. P3-39C1 permanece cancelada y su hoja archivada no se usa como mandato técnico.
2. No se presenta shareModel memoizado, preparation controller, execution lock, mount/invalidate/dispose ni isMounted/version/prepared como trabajo pendiente.
3. TrainingCompletionSummaryScreen no importa ni renderiza ShareWorkoutCard.
4. Completion conserva una única presentación del resumen, su tabla y el CTA Ir al panel principal.
5. Permanecen ausentes handlers, hooks, navigator, estados y mensajes de compartir dentro de Completion.
6. ShareWorkoutCard y workout-share no adquieren importadores productivos ni se conectan a la interfaz por una tarea de infraestructura/refactor.
7. No se modifican DOM, clases, CSS, copy, espaciado o navegación como efecto incidental de una extracción de estado.
8. Una integración visual futura sólo puede comenzar con tarea nueva y aprobación explícita del dueño de producto; no puede reactivar P3-39C1 ni reutilizar su hoja archivada.
9. Conectar, rediseñar o eliminar la infraestructura aislada requiere autorización propia; P3-45 no la borra como “limpieza” genérica.
10. Se revalidan base, status, diff documental exacto, marcadores de conflicto, único delta autorizado y stash@{0} intacto.

Este gate sustituye íntegramente el antiguo gate post-merge. No queda ninguna dependencia pendiente de P3-39C1.

READY FOR P3-40 UPDATED PRE-MERGE AUDIT
