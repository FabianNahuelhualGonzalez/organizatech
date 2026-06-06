# Fase 2.2BL - Decision controlada de merge con feature flag OFF

## 1. Resumen ejecutivo

La Fase 2.2BL prepara la decision final previa al merge del PR #30. No
autoriza merge, SQL Production, cambios Vercel ni activacion de Training
Cycles.

Estado verificado el 6 de junio de 2026:

```text
PR #30: OPEN, Ready for review, no mergeado
Base: main
Head: feature/training-cycles-controlled-next-cycle
HEAD: 9734e1fa81645911b763cb828be0eae97b6ca7eb
Mergeability: MERGEABLE / CLEAN
Checks Vercel: SUCCESS
Preview: READY, target = null / Preview
Production: commit 2963487
ENABLE_TRAINING_CYCLES_REPOSITORY: ausente/no configurada segun evidencia manual 2.2BI
SQL cycle-scoped Production: pendiente y bloqueado
```

La recomendacion tecnica mantiene la alternativa C aprobada:

```text
1. Confirmar manualmente los scopes de variables Vercel inmediatamente antes
   del merge.
2. Autorizar y ejecutar el merge en una fase separada.
3. Validar el deployment Production con repository cycle-scoped OFF.
4. Confirmar que el fallback legacy sigue operativo.
5. Mantener SQL Production bloqueado para una ventana posterior.
6. Mantener la activacion de Training Cycles bloqueada para una tercera fase.
```

El PR esta tecnicamente preparado para solicitar una autorizacion de merge,
pero el merge debe seguir bloqueado hasta completar el checklist manual final
y recibir autorizacion explicita de Arquitectura.

## 2. Estado del PR #30

```text
URL: https://github.com/FabianNahuelhualGonzalez/organizatech/pull/30
Estado: OPEN
Draft: no
Ready for review: si
mergedAt: null
Base: main
Head: feature/training-cycles-controlled-next-cycle
HEAD: 9734e1fa81645911b763cb828be0eae97b6ca7eb
Mergeability: MERGEABLE
Merge state: CLEAN
```

No se observaron conflictos ni cambios de base/head. Esta fase no cambia el
estado del PR ni ejecuta el merge.

## 3. Estado de checks

Checks visibles para el HEAD del PR:

```text
Vercel: SUCCESS
Vercel Preview Comments: SUCCESS
Checks pendientes: ninguno visible
Checks fallidos: ninguno visible
```

Los checks deben repetirse inmediatamente antes del merge. Cualquier check
fallido, pendiente o asociado a un HEAD diferente invalida esta preparacion.

## 4. Estado del Preview

```text
URL: https://organizatech-h4rxrw7bq-fanahuelhualg-8514s-projects.vercel.app
Deployment ID: dpl_CqSFZ55tYkm5rSckAuKRnCQ8yY6P
Estado: READY
Target: null / Preview
Git branch: feature/training-cycles-controlled-next-cycle
Git commit: 9734e1fa81645911b763cb828be0eae97b6ca7eb
```

El deployment corresponde al HEAD actual del PR y no es Production. La
validacion QA previa cubrio plan, render, persistencia, dashboard/progreso y
`planned_date` cycle-scoped.

## 5. Estado de Production pre-merge

Production permanece en:

```text
Commit: 2963487b59e262de2a1161f761eb790ef31d974b
Deployment ID: dpl_45yrYdeKE5z9CWDrFVLisekAEA1R
Estado: READY
Target: production
```

No se observo un deployment Production asociado al PR #30.

Un merge a `main` generaria, por la integracion Git de Vercel, un nuevo
deployment Production para el commit resultante en `main`. El Deployment ID,
URL y SHA productivos solo podran confirmarse despues del merge.

El merge no debe ejecutarse si antes aparece un deployment Production
inesperado o si cambia el baseline anterior sin una nueva revision.

## 6. Estado de feature flag Production

La Fase 2.2BI removio manualmente de Production:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY
```

Estado aprobado:

```text
Production: ausente/no configurada
```

El conector disponible no expone de forma confiable el inventario o valor de
variables sensibles. Por eso esta conclusion usa la evidencia manual aprobada
en 2.2BI.

Control obligatorio:

```text
Repetir una confirmacion visual read-only inmediatamente antes del merge y
verificar que ENABLE_TRAINING_CYCLES_REPOSITORY no exista para Production.
```

No crear, editar ni guardar variables durante ese control.

## 7. Variables QA y riesgo All Environments

Variables QA relevantes:

```text
NEXT_PUBLIC_ENABLE_QA_TOOLS
NEXT_PUBLIC_SUPABASE_ENV
```

Estado requerido:

```text
NEXT_PUBLIC_ENABLE_QA_TOOLS=true: limitado a Preview/QA
NEXT_PUBLIC_SUPABASE_ENV=qa: limitado a Preview/QA
Production: sin ambas configuraciones QA
All Environments: no
```

El conector disponible no permite demostrar actualmente sus scopes. La
revision visual en Vercel Dashboard queda como gate manual obligatorio.

El codigo exige `VERCEL_ENV === "preview"` para el path QA, por lo que esas
variables no activan por si solas el repository bajo `VERCEL_ENV=production`.
El riesgo residual es operativo: variables publicas QA mal scopeadas crean
ambiguedad, pueden exponer configuracion QA en bundles no previstos y vuelven
menos confiable la separacion de ambientes.

## 8. Gate real del codigo

El gate en `src/app/page.tsx` es:

```ts
const qaTrainingCyclesRepositoryEnabled =
  process.env.VERCEL_ENV === "preview" &&
  process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true" &&
  process.env.NEXT_PUBLIC_SUPABASE_ENV === "qa";

const productionTrainingCyclesRepositoryEnabled =
  process.env.VERCEL_ENV === "production" &&
  process.env.ENABLE_TRAINING_CYCLES_REPOSITORY === "true";

const trainingCyclesRepositoryEnabled =
  qaTrainingCyclesRepositoryEnabled || productionTrainingCyclesRepositoryEnabled;
```

Lectura:

- Preview/QA requiere las tres condiciones del path QA.
- Production requiere la cadena exacta `true` en la flag server-side.
- Una flag ausente, vacia, `false` o distinta de `true` deja el path
  Production desactivado.
- `VERCEL_ENV` diferencia los paths; el path QA no se activa en Production.

La ruta `src/app/qa/training-cycles/page.tsx` aplica el mismo gate QA:

```ts
allowed:
  process.env.VERCEL_ENV === "preview" &&
  process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true" &&
  process.env.NEXT_PUBLIC_SUPABASE_ENV === "qa"
```

Por lo tanto, `/qa/training-cycles` debe mostrar acceso bloqueado bajo
`VERCEL_ENV=production`.

## 9. Fallback legacy con flag OFF

Con la flag Production ausente:

```text
productionTrainingCyclesRepositoryEnabled = false
trainingCyclesRepositoryEnabled = false
isTrainingCyclesRepositoryActive = false
```

En ese estado:

- no se cargan planes ni sesiones desde el repository cycle-scoped;
- no se llaman las RPC `create_training_cycle_with_plan` ni
  `create_training_session_with_cycle_entries`;
- los ejercicios, entries y sesiones visibles mantienen las fuentes legacy;
- el guardado de entrenamiento conserva `saveTrainingSessionWithEntries`;
- las tablas `training_cycle_*` no son necesarias para el runtime legacy;
- la ruta QA permanece bloqueada en Production.

Esto protege la operacion mientras SQL Production siga pendiente. La
proteccion depende de que la flag permanezca ausente/OFF.

## 10. Riesgo residual con SQL pendiente

El merge con flag OFF es controlable, pero no tiene riesgo cero.

Riesgos:

1. Una creacion accidental de la flag con valor exacto `true` activaria codigo
   que depende de tablas, columnas, policies y RPC aun no disponibles en
   Production.
2. Los cambios frontend comparten `OrganizatechApp`; una regresion no
   relacionada con el gate podria afectar el fallback legacy.
3. Un scope incorrecto de variables QA dificultaria demostrar la separacion
   operativa entre Preview y Production.
4. Un deployment fallido o un autodeploy no generado dejaria `main` y
   Production desalineados.
5. El codigo SQL versionado puede confundirse con SQL aplicado. Las tres
   migraciones seguiran pendientes aunque los archivos lleguen a `main`.
6. No debe asumirse que un merge exitoso autoriza activar la feature.

Mitigaciones:

- mantener la flag ausente antes, durante y despues del merge;
- revisar visualmente scopes de variables;
- verificar commit, target y estado del deployment;
- ejecutar smoke tests legacy read-only;
- revisar Network y runtime para descartar accesos cycle-scoped;
- mantener SQL y activacion como autorizaciones separadas.

## 11. Postchecks posteriores al merge

Estos postchecks solo se ejecutaran si Arquitectura autoriza el merge en una
fase posterior.

### Deployment

1. Identificar el commit resultante en `main`.
2. Confirmar un deployment Vercel asociado a ese commit.
3. Confirmar `target=production`.
4. Confirmar estado `READY`.
5. Confirmar que no se hizo promote ni redeploy manual.
6. Confirmar que no se modificaron variables durante el deployment.

### Gating

1. Confirmar nuevamente la ausencia de
   `ENABLE_TRAINING_CYCLES_REPOSITORY` en Production.
2. Confirmar `trainingCyclesRepositoryEnabled=false`.
3. Confirmar `/qa/training-cycles` con acceso bloqueado.
4. Confirmar variables QA fuera de Production y `All Environments`.

### Aplicacion legacy

1. Confirmar que la app carga.
2. Confirmar que login funciona.
3. Confirmar que Training legacy carga.
4. Confirmar que entrenamientos existentes siguen visibles.
5. Confirmar que no aparece el flujo cycle-scoped productivo.
6. Confirmar que dashboard, historial y progreso legacy cargan sin errores.
7. No crear ciclos ni entrenamientos productivos durante estos smoke tests.

### Runtime y Network

1. Revisar errores de consola y runtime.
2. Confirmar ausencia de llamadas a:
   - `create_training_cycle_with_plan`;
   - `create_training_session_with_cycle_entries`;
   - `training_cycle_routines`;
   - `training_cycle_days`;
   - `training_cycle_exercises`.
3. Confirmar ausencia de errores por tablas, columnas o RPC faltantes.
4. Confirmar que no se ejecuto SQL ni cambio de datos como parte del merge.

## 12. Rollback frontend

Si el deployment mergeado afecta el fallback legacy:

1. Mantener `ENABLE_TRAINING_CYCLES_REPOSITORY` ausente.
2. Detener pruebas funcionales y preservar evidencia.
3. No aplicar SQL como intento de corregir un fallo frontend.
4. Preparar un revert del commit de merge mediante autorizacion separada.
5. Llevar el revert a `main` por el flujo Git autorizado.
6. Confirmar el nuevo deployment Production del revert como `READY`.
7. Confirmar que vuelve el commit/comportamiento frontend aprobado.
8. Repetir smoke tests legacy y revisar Network.

No corresponde rollback SQL porque esta fase no aplica SQL Production.

No usar `git reset --hard`, reescritura de historial, redeploy manual ni
promote como respuesta improvisada.

## 13. Criterios de aborto

Abortar la autorizacion o ejecucion del merge si:

- PR #30 deja de estar `OPEN`, Ready y no mergeado;
- base, head o HEAD SHA no coinciden;
- mergeability deja de ser `MERGEABLE / CLEAN`;
- existe un check pendiente o fallido;
- Preview no esta `READY` o su target no es Preview;
- Production cambia de commit/deployment antes de la ventana;
- aparece un deployment Production inesperado;
- la flag Production existe o no puede confirmarse su ausencia;
- las variables QA aparecen en Production o `All Environments`;
- aparece `.env`, secreto, `supabase/.temp/` o archivo inesperado en el diff;
- se pretende aplicar SQL, activar la flag o hacer backfill en la misma fase;
- no existe un plan de observacion y rollback;
- no se obtiene autorizacion explicita de Arquitectura;
- cualquier herramienta intenta promover, redeployar o modificar Production.

## 14. Checklist manual final antes del merge

### GitHub

- [ ] PR #30 `OPEN`.
- [ ] PR #30 Ready for review.
- [ ] PR #30 no mergeado.
- [ ] Base `main`.
- [ ] Head `feature/training-cycles-controlled-next-cycle`.
- [ ] HEAD `9734e1fa81645911b763cb828be0eae97b6ca7eb`, o nuevo HEAD
      reauditable y explicitamente autorizado.
- [ ] `MERGEABLE / CLEAN`.
- [ ] Vercel `SUCCESS`.
- [ ] Vercel Preview Comments `SUCCESS`.
- [ ] Sin checks pendientes o fallidos.
- [ ] Diff final sin `.env`, secretos ni `supabase/.temp/`.

### Vercel

- [ ] Preview del HEAD exacto en estado `READY`.
- [ ] Preview con target Preview/null.
- [ ] Production sigue en el baseline esperado antes del merge.
- [ ] Sin deployment Production inesperado.
- [ ] `ENABLE_TRAINING_CYCLES_REPOSITORY` ausente en Production.
- [ ] `NEXT_PUBLIC_ENABLE_QA_TOOLS` fuera de Production y All Environments.
- [ ] `NEXT_PUBLIC_SUPABASE_ENV=qa` fuera de Production y All Environments.
- [ ] No guardar cambios de variables.
- [ ] No ejecutar redeploy ni promote.

### Alcance

- [ ] SQL Production permanece bloqueado.
- [ ] Supabase Production no se toca.
- [ ] No se ejecuta `db push`.
- [ ] No se ejecuta `migration repair`.
- [ ] No se activa Training Cycles.
- [ ] No se crean ni modifican datos productivos.
- [ ] Postchecks y rollback tienen responsable y ventana.
- [ ] Arquitectura autoriza explicitamente solo el merge del PR #30.

## 15. Decision solicitada a Arquitectura

Decision recomendada:

```text
Autorizar en una fase separada el merge controlado del PR #30 a main,
manteniendo ENABLE_TRAINING_CYCLES_REPOSITORY ausente en Production.
```

Condiciones:

```text
1. Completar el checklist manual final inmediatamente antes del merge.
2. No aplicar SQL Production en la fase de merge.
3. No crear ni activar la feature flag.
4. Verificar el deployment Production y el fallback legacy.
5. Abortar ante cualquier acceso cycle-scoped, error de schema/RPC o cambio
   inesperado de variables/deployment.
```

Despues de cerrar el deployment con flag OFF:

```text
Abrir una fase independiente para prechecks y aplicacion controlada de SQL
Production.
```

La activacion funcional debe seguir bloqueada hasta que SQL Production y sus
postchecks tengan aprobacion separada.

## 16. Confirmaciones de alcance 2.2BL

- No se hizo merge.
- No se aplico SQL Production.
- No se toco Supabase Production.
- No se genero Vercel Production Deployment manual.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se activaron feature flags productivas.
- No se crearon ni modificaron variables Vercel.
- No se hizo backfill.
- No se tocaron datos productivos.
- No se hizo commit.
- No se hizo push.
- `supabase/.temp/` permanece untracked y no incluido.
