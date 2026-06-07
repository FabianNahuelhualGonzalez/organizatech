# Fase 2.2BS - Preparacion activacion funcional Training Cycles Production

## 1. Resumen ejecutivo

Arquitectura cerro y aprobo la ejecucion SQL Production controlada posterior a
2.2BR. El schema cycle-scoped quedo instalado en Production y los postchecks
fueron aceptados.

2.2BS prepara la decision para una futura activacion funcional de Training
Cycles en Production. Esta fase no autoriza activar feature flags, modificar
Vercel, hacer redeploy, crear ciclos productivos, crear usuarios, hacer
backfill ni tocar datos productivos.

Estado de control:

```text
Training Cycles Production: apagado
ENABLE_TRAINING_CYCLES_REPOSITORY: OFF/no configurada
SQL Production adicional: no autorizado
Supabase write: no autorizado
Vercel changes: no autorizados
```

## 2. Estado post-SQL Production

Estado aprobado por Arquitectura:

```text
Migraciones aplicadas: OK
Postchecks catalogo: OK
Postchecks seguridad/grants/RLS: OK
Postchecks RPCs: OK
Postchecks datos/integridad: OK
Training legacy: OK
Training Cycles: apagado
Feature flag productiva: no activada
Ciclo 1 productivo: intacto
Backfill: no realizado
```

Migraciones aplicadas por SQL Editor manual Supabase Production, en orden:

```text
1. 20260604_training_cycle_scoped_model.sql
2. 20260604_training_cycle_scoped_policy_fix.sql
3. 20260605_training_cycle_scoped_session_entries_contract.sql
```

Estado aceptado:

- no `db push`;
- no `migration repair`;
- no backfill;
- tablas `training_cycle_*` operativas y vacias;
- sin sesiones cycle-scoped;
- sin entries cycle-scoped;
- Training legacy operativo;
- Ciclo 1 productivo intacto.

Observacion menor aceptada:

```text
training_cycle_routines mantiene una policy con roles {public}.
```

Impacto aceptado:

- `anon` no tiene grants efectivos;
- `authenticated` conserva solo `INSERT`, `SELECT`, `UPDATE`;
- el acceso efectivo queda cerrado por grants y RLS.

## 3. Training Cycles sigue apagado

La aplicacion del schema no equivale a activacion funcional.

Durante 2.2BS:

- no activar UI cycle-scoped;
- no invocar RPCs productivas;
- no crear ciclos productivos;
- no crear sesiones cycle-scoped;
- no crear entries cycle-scoped;
- no usar tablas `training_cycle_*` como fuente funcional productiva.

## 4. Feature flag Production OFF/no configurada

El gate productivo sigue siendo:

```ts
process.env.VERCEL_ENV === "production" &&
process.env.ENABLE_TRAINING_CYCLES_REPOSITORY === "true"
```

Estado requerido:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY: OFF/no configurada
```

No crear, modificar ni activar variables Vercel en 2.2BS. No hacer redeploy.

## 5. Training legacy estable

Training legacy fue validado como operativo despues de la normalizacion de
grants y policies.

Antes de cualquier activacion futura debe reconfirmarse:

- app Production carga;
- login funciona;
- Training legacy abre;
- rutinas y ejercicios legacy visibles;
- historial/progreso legacy visibles;
- sin errores de permisos;
- sin requests cycle-scoped inesperados.

## 6. Riesgos de activacion funcional

Riesgos principales:

1. Activar la flag habilita escritura real en `training_cycles`,
   `training_cycle_routines`, `training_cycle_days`,
   `training_cycle_exercises`, `training_sessions` y `exercise_entries`.
2. La primera creacion de ciclo productivo generara datos reales y
   permanentes.
3. El rollback funcional apaga la flag, pero no borra datos ya creados.
4. Si el usuario elegido ya tiene un ciclo activo en `training_cycles`, la RPC
   `create_training_cycle_with_plan` puede bloquear la creacion de un nuevo
   ciclo.
5. Ciclo 1 no debe cerrarse, editarse ni borrarse para facilitar la prueba.
6. El marcador `plan_snapshot.source = "cycle-scoped-qa"` puede generar
   ambiguedad de auditoria o semantica en datos productivos.
7. La validacion inicial debe evitar confundir datos legacy con datos
   cycle-scoped.
8. Cualquier cambio de Vercel requiere redeploy o nuevo build para tomar la
   variable server-side.

## 7. Pendiente plan_snapshot.source = "cycle-scoped-qa"

Estado actual observado en codigo y SQL:

```text
supabase/migrations/20260604_training_cycle_scoped_model.sql:
plan_snapshot.source = "cycle-scoped-qa"

src/components/organizatech-app.tsx:
isCycleScopedTrainingCycle() identifica ciclos scoped por source
"cycle-scoped-qa".

src/app/page.tsx:
el plan enviado desde Production usa trainingCyclesSnapshotSource =
"ui-main-production" dentro del payload del plan.
```

Impacto:

- el valor top-level `cycle-scoped-qa` quedaria persistido en nuevos ciclos
  productivos;
- puede ser interpretado como evidencia QA aunque el ciclo haya sido creado en
  Production;
- el frontend actual depende de ese valor para reconocer un ciclo como
  cycle-scoped;
- cambiarlo sin adaptar el frontend puede hacer que nuevos ciclos no se
  rendericen como cycle-scoped.

Opciones:

### Opcion A - Resolver antes de activar

Preparar una fase tecnica previa a la activacion:

- ajustar la RPC para persistir un valor neutral/productivo, por ejemplo
  `cycle-scoped` o `cycle-scoped-production`;
- ajustar el frontend para aceptar el valor nuevo y, si hace falta, mantener
  compatibilidad con `cycle-scoped-qa`;
- auditar y desplegar el cambio antes de activar la flag;
- no crear ciclos productivos hasta cerrar esa fase.

Pros:

- evita metadata QA en Production;
- mejora auditoria y trazabilidad;
- separa ambiente y tipo tecnico de ciclo.

Contras:

- requiere nueva fase de codigo/SQL o patch de RPC;
- retrasa la activacion funcional.

### Opcion B - Aceptar explicitamente el valor actual

Arquitectura podria aceptar `cycle-scoped-qa` como marcador tecnico legacy del
modelo cycle-scoped, no como indicador de ambiente.

Pros:

- no requiere cambios antes de activar;
- evita introducir otro patch antes de la prueba.

Contras:

- deja metadata confusa en datos productivos;
- requiere documentacion muy explicita para auditoria;
- puede complicar reportes o filtros futuros.

Recomendacion:

```text
Resolver antes de activar si se creara cualquier ciclo productivo real.
```

Si Arquitectura decide no resolverlo, debe aceptar formalmente que
`cycle-scoped-qa` es un marcador tecnico y no de ambiente.

## 8. Decision recomendada sobre usuario de prueba

Opciones:

### Usuario real Fabian

Pros:

- valida el flujo con el usuario productivo real;
- evita crear una cuenta nueva;
- prueba el comportamiento en el contexto de uso real.

Contras:

- puede existir conflicto con Ciclo 1 si pertenece al mismo usuario y sigue
  activo;
- cualquier ciclo creado queda como dato productivo real;
- mayor riesgo operativo si se mezclan datos de prueba y uso real.

### Cuenta de prueba productiva existente

Pros:

- reduce riesgo sobre datos reales de Fabian;
- permite confirmar el flujo sin tocar Ciclo 1;
- facilita aislar evidencias.

Contras:

- debe existir ya o requeriria autorizacion separada para crearla;
- debe confirmarse que no tenga ciclos activos;
- sigue creando datos productivos, aunque sean de prueba controlada.

### Cuenta de prueba nueva

Pros:

- aislamiento maximo.

Contras:

- crear usuario nuevo no esta autorizado en 2.2BS;
- requiere fase separada;
- agrega superficie de administracion.

Recomendacion:

```text
Usar una cuenta de prueba productiva existente y autorizada, si existe y no
tiene ciclo activo.
```

Si no existe cuenta de prueba autorizada, usar usuario real Fabian solo con
confirmacion read-only previa de que no se tocara Ciclo 1 ni se forzara cierre
de ciclos. No crear usuario nuevo sin autorizacion separada.

## 9. Decision recomendada sobre primer ciclo productivo

Opciones:

### Crear un unico ciclo controlado

Pros:

- valida el flujo end-to-end real;
- confirma creacion de ciclo, plan, sesion y entry;
- permite postchecks de datos concretos.

Contras:

- crea datos productivos permanentes;
- si falla, requiere rollback funcional y analisis;
- no se debe borrar automaticamente la evidencia.

### No crear ciclo aun

Pros:

- menor riesgo;
- permite validar activacion visual y acceso sin escribir datos;
- da margen para resolver `cycle-scoped-qa` primero.

Contras:

- no valida persistencia completa;
- deja la activacion funcional incompleta.

Recomendacion:

```text
No crear ciclo productivo aun hasta resolver o aceptar explicitamente
plan_snapshot.source.
```

Cuando se autorice la prueba funcional, crear solo un ciclo controlado, con un
usuario autorizado, sin tocar Ciclo 1 y con postchecks definidos antes de
activar.

## 10. Checklist previo a activacion

- [ ] 2.2BS aprobada por Arquitectura.
- [ ] Decision tomada sobre `plan_snapshot.source`.
- [ ] Usuario de primera prueba definido.
- [ ] Confirmado que el usuario elegido no requiere tocar Ciclo 1.
- [ ] Confirmado que no se creara usuario nuevo sin autorizacion.
- [ ] Confirmado que no habra backfill.
- [ ] Confirmado que no se borraran datos.
- [ ] Feature flag sigue OFF/no configurada.
- [ ] Vercel variables revisadas visualmente.
- [ ] App, login y Training legacy estables.
- [ ] Schema cycle-scoped Production instalado y postchecks OK.
- [ ] Tablas `training_cycle_*` vacias antes de la prueba.
- [ ] Sin sesiones ni entries cycle-scoped antes de la prueba.
- [ ] Rollback funcional preparado.
- [ ] Evidencia requerida definida.
- [ ] Autorizacion separada para activar feature flag.

## 11. Checklist de activacion feature flag

Esta lista es para una fase posterior. No ejecutar en 2.2BS.

1. Confirmar autorizacion explicita para tocar Vercel.
2. Confirmar ambiente Vercel Production.
3. Configurar `ENABLE_TRAINING_CYCLES_REPOSITORY=true` solo en Production.
4. Confirmar que variables QA no estan en Production ni All Environments.
5. Ejecutar redeploy/build Production solo si la fase lo autoriza.
6. Confirmar deployment READY.
7. Confirmar runtime:

```text
VERCEL_ENV=production
trainingCyclesRepositoryEnabled=true
```

8. Confirmar que Training legacy fallback sigue disponible via rollback de
   flag.
9. No crear ciclo hasta que el runtime este confirmado.

## 12. Postchecks posteriores a activacion

Postchecks sin crear ciclo:

- app carga;
- login funciona;
- Training abre;
- repository cycle-scoped activo;
- no aparece fallback legacy incorrecto;
- Ciclo 1 no fue modificado;
- tablas `training_cycle_*` siguen vacias;
- no se crean sesiones o entries automaticas.

Postchecks si se autoriza un unico ciclo:

- se crea un solo ciclo activo controlado;
- `training_cycles` registra `cycle_type`, `goal`, `duration_weeks`,
  `planned_start_date` y `planned_end_date`;
- `training_cycle_routines` tiene al menos una rutina;
- `training_cycle_days` tiene el dia esperado;
- `training_cycle_exercises` tiene el ejercicio esperado;
- al guardar entrenamiento, `training_sessions.cycle_id` y `cycle_day_id`
  quedan poblados;
- `exercise_entries.training_cycle_exercise_id` queda poblado;
- `exercise_entries.exercise_id` puede ser `null`;
- no se crea legacy artificial;
- Training legacy no queda contaminado;
- Ciclo 1 sigue intacto.

## 13. Rollback funcional

Rollback funcional autorizado en una fase posterior:

1. apagar o remover `ENABLE_TRAINING_CYCLES_REPOSITORY`;
2. redeploy solo si la fase lo autoriza;
3. confirmar `trainingCyclesRepositoryEnabled=false`;
4. confirmar fallback legacy;
5. confirmar app/login/Training legacy;
6. preservar datos creados como evidencia;
7. no borrar ciclos, sesiones o entries;
8. no tocar Ciclo 1 salvo autorizacion explicita;
9. no ejecutar SQL de rollback sin fase separada.

El rollback funcional no revierte datos productivos ya creados.

## 14. Criterios de aborto

Abortar antes de activar si:

- feature flag aparece activa antes de autorizacion;
- `plan_snapshot.source` no fue resuelto ni aceptado;
- no hay decision sobre usuario de prueba;
- el usuario elegido tiene un ciclo activo que obligaria a tocar Ciclo 1;
- Vercel variables QA aparecen en Production o All Environments;
- Training legacy no esta estable;
- tablas cycle-scoped tienen datos inesperados;
- no existe rollback funcional claro.

Abortar despues de activar si:

- deployment no queda READY;
- runtime no muestra repository activo;
- app o login fallan;
- Training falla;
- aparece fallback legacy silencioso incorrecto;
- se crea ciclo sin plan;
- se crean datos inesperados;
- hay errores de RLS, grants o RPC;
- Ciclo 1 cambia;
- se observa escritura legacy artificial.

## 15. Evidencia requerida

Para aprobar una activacion futura se debera entregar:

1. estado Vercel Production;
2. estado de feature flag;
3. deployment ID;
4. runtime `trainingCyclesRepositoryEnabled`;
5. usuario usado o decision de no crear ciclo;
6. decision sobre `cycle-scoped-qa`;
7. conteos antes/despues;
8. evidencia de Ciclo 1 intacto;
9. evidencia de tablas `training_cycle_*`;
10. evidencia de sesiones/entries si se crea ciclo;
11. evidencia de Training legacy estable;
12. evidencia de rollback disponible;
13. confirmacion de no backfill;
14. confirmacion de no datos extra.

## 16. Decision solicitada a Arquitectura

Se solicita decidir:

```text
1. Resolver o aceptar plan_snapshot.source = "cycle-scoped-qa".
2. Usuario de primera prueba:
   - cuenta de prueba productiva existente;
   - usuario real Fabian;
   - otra opcion con autorizacion separada.
3. Primer ciclo:
   - no crear aun;
   - crear unico ciclo controlado en fase posterior.
4. Si se autoriza abrir una fase de activacion Vercel separada.
```

Recomendacion tecnica:

```text
Resolver el marcador cycle-scoped-qa antes de activar y no crear ciclo
productivo hasta cerrar esa decision.
```

## 17. Confirmaciones de esta preparacion

- No se activo Training Cycles.
- No se activo `ENABLE_TRAINING_CYCLES_REPOSITORY`.
- No se modifico Vercel.
- No se hizo redeploy.
- No se creo ciclo productivo.
- No se creo usuario.
- No se hizo backfill.
- No se toco Ciclo 1.
- No se tocaron datos productivos.
- No se ejecuto SQL Production adicional.
- No se escribio en Supabase Production.
- No se ejecuto `db push`.
- No se ejecuto `migration repair`.
- No se hizo commit.
- No se hizo push.
- `supabase/.temp/` permanece untracked y excluido.
