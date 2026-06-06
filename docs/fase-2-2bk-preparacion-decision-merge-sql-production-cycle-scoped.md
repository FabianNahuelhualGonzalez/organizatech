# Fase 2.2BK - Preparacion de decision merge y SQL Production cycle-scoped

## 1. Resumen ejecutivo

Esta fase prepara una decision para Arquitectura. No autoriza merge, SQL
Production, cambios Vercel ni activacion de Training Cycles.

Estado verificado:

```text
PR #30: OPEN, Ready for review, no mergeado
Base: main
Head: feature/training-cycles-controlled-next-cycle
Mergeability: MERGEABLE / CLEAN
Checks Vercel: SUCCESS
Preview: READY, target = null
Production: commit 2963487
ENABLE_TRAINING_CYCLES_REPOSITORY: removida/no configurada en Production
```

La recomendacion tecnica es la alternativa C:

```text
Merge controlado con feature flag Production ausente/OFF.
Verificar deployment y fallback legacy.
Aplicar SQL Production despues, en una ventana separada.
Mantener la flag OFF durante SQL y postchecks.
Activar Training Cycles solo en una fase posterior independiente.
```

Esta secuencia reduce el radio de falla porque separa deployment, cambio de
schema y activacion funcional. El codigo nuevo queda inactivo en Production
mientras `ENABLE_TRAINING_CYCLES_REPOSITORY` no sea exactamente `true`.

## 2. Estado actual del PR #30

Verificacion del 6 de junio de 2026:

```text
URL: https://github.com/FabianNahuelhualGonzalez/organizatech/pull/30
Estado: OPEN
Draft: no
mergedAt: null
Base: main
Head: feature/training-cycles-controlled-next-cycle
HEAD: 3a46b1834abfde4aa93af43d7dd54200c66f9ee9
Mergeability: MERGEABLE
Merge state: CLEAN
```

Checks:

```text
Vercel: SUCCESS
Vercel Preview Comments: SUCCESS
Checks pendientes o fallidos: ninguno visible
```

Preview:

```text
URL: https://organizatech-6sweliid2-fanahuelhualg-8514s-projects.vercel.app
Deployment ID: dpl_AnHGmTu3XbZnMPnyC7YdhdSEZhpD
Estado: READY
Target: null / Preview
Commit: 3a46b1834abfde4aa93af43d7dd54200c66f9ee9
```

El PR esta listo para una decision de merge separada, pero esta fase no
autoriza ejecutarla.

## 3. Estado actual de Production

Production permanece en:

```text
Commit: 2963487b59e262de2a1161f761eb790ef31d974b
Deployment ID: dpl_45yrYdeKE5z9CWDrFVLisekAEA1R
Estado: READY
Target: production
```

No se observo un deployment Production asociado al PR #30. Los deployments
posteriores observados corresponden a Preview.

El merge a `main` puede generar automaticamente un nuevo deployment
Production. Por eso la feature flag debe permanecer ausente/OFF antes, durante
y despues del merge.

## 4. Estado de feature flag Production

La Fase 2.2BI removio manualmente de Production:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY
```

La ausencia fue validada manualmente en Vercel Dashboard. El conector
disponible no expone el inventario de variables, por lo que esta evidencia no
proviene de una segunda lectura API.

El gate real de codigo tiene dos paths:

```ts
const qaTrainingCyclesRepositoryEnabled =
  process.env.VERCEL_ENV === "preview" &&
  process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true" &&
  process.env.NEXT_PUBLIC_SUPABASE_ENV === "qa";

const productionTrainingCyclesRepositoryEnabled =
  process.env.VERCEL_ENV === "production" &&
  process.env.ENABLE_TRAINING_CYCLES_REPOSITORY === "true";

const trainingCyclesRepositoryEnabled =
  qaTrainingCyclesRepositoryEnabled ||
  productionTrainingCyclesRepositoryEnabled;
```

Si la variable esta ausente, vacia, en `false` o con cualquier valor distinto
de la cadena exacta `true`, el path Production del repository cycle-scoped
permanece desactivado.

El repository tambien se activa por el path QA cuando:

```text
VERCEL_ENV = preview
NEXT_PUBLIC_ENABLE_QA_TOOLS = true
NEXT_PUBLIC_SUPABASE_ENV = qa
```

Antes del merge debe confirmarse visualmente en Vercel que
`NEXT_PUBLIC_ENABLE_QA_TOOLS` y `NEXT_PUBLIC_SUPABASE_ENV=qa` no esten
configuradas como `All Environments` ni disponibles para Production. Deben
quedar limitadas a Preview/QA segun corresponda.

El path QA no se activa con `VERCEL_ENV=production`, porque el codigo exige
explicitamente `VERCEL_ENV === "preview"`. El riesgo es de configuracion
operativa, variables publicas QA mal scopeadas y ambiguedad entre ambientes,
no de suplantacion de `VERCEL_ENV`.

Antes de autorizar el merge se debe repetir una confirmacion visual read-only
de que la flag productiva sigue ausente y de que las variables QA conservan
el scope esperado.

## 5. Migraciones SQL pendientes

Las siguientes migraciones fueron aplicadas manualmente y postcheckeadas en
Supabase QA. Siguen pendientes de precheck, autorizacion y aplicacion
controlada en Supabase Production:

```text
1. supabase/migrations/20260604_training_cycle_scoped_model.sql
2. supabase/migrations/20260604_training_cycle_scoped_policy_fix.sql
3. supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql
```

Orden obligatorio:

```text
20260604_training_cycle_scoped_model.sql
20260604_training_cycle_scoped_policy_fix.sql
20260605_training_cycle_scoped_session_entries_contract.sql
```

Efectos principales:

- agrega columnas cycle-scoped a tablas existentes;
- crea `training_cycle_routines`, `training_cycle_days` y
  `training_cycle_exercises`;
- agrega constraints, indices, triggers y FKs compuestas;
- reemplaza policies en tablas nuevas y existentes;
- normaliza grants de `training_cycles`, `training_sessions`,
  `exercise_entries` y tablas `training_cycle_*`;
- crea las RPC `create_training_cycle_with_plan` y
  `create_training_session_with_cycle_entries`;
- permite `exercise_entries.exercise_id = null` cuando existe
  `training_cycle_exercise_id`;
- preserva el camino legacy mediante la constraint que exige al menos uno de
  ambos identificadores.

Los cambios de policies, grants y nulabilidad sobre tablas existentes hacen
que SQL Production requiera su propia ventana y baseline directo.

## 6. Alternativa A - SQL Production antes del merge

Secuencia:

```text
Prechecks Production
Aplicar las tres migraciones
Postchecks SQL
Merge PR #30
Deployment Production con flag OFF
```

Ventajas:

- el schema y las RPC ya existen cuando se despliega el frontend;
- elimina la posibilidad de activar accidentalmente codigo scoped sin schema;
- permite validar compatibilidad legacy del schema antes del deployment.

Riesgos:

- modifica Production antes de que el codigo nuevo sea necesario;
- cambia policies y grants de `training_sessions`, `exercise_entries` y
  `training_cycles`;
- relaja `exercise_entries.exercise_id` a nullable;
- una falla SQL o una diferencia de baseline impactaria al flujo legacy
  actualmente productivo;
- la reversa completa puede quedar bloqueada si se crean entries con
  `exercise_id = null`;
- extiende el tiempo entre cambio de schema y uso del codigo que lo justifica.

Evaluacion:

```text
Viable tecnicamente, pero no preferida.
```

El riesgo dominante es introducir primero el cambio de mayor impacto sobre
datos y permisos existentes.

## 7. Alternativa B - Merge antes del SQL

Secuencia generica:

```text
Merge PR #30
Deployment Production
SQL Production posteriormente
```

Ventajas:

- el cambio frontend puede revertirse mediante deployment;
- permite separar temporalmente el despliegue y la migracion;
- con la flag ausente/OFF, el codigo scoped queda inactivo.

Riesgos:

- si no se exige explicitamente la flag OFF, una variable `true` residual
  activaria codigo que depende de tablas, columnas y RPC aun ausentes;
- una activacion accidental produciria errores de lectura/escritura y una
  experiencia incompleta;
- "merge antes del SQL" por si solo no define gates, smoke tests ni criterios
  de aborto.

Evaluacion:

```text
Aceptable solo si se convierte en la alternativa C controlada.
```

## 8. Alternativa C - Merge con flag OFF y SQL posterior

Secuencia:

```text
1. Confirmar flag Production ausente/OFF.
2. Autorizar merge en fase separada.
3. Merge PR #30.
4. Confirmar deployment Production READY del commit mergeado.
5. Confirmar trainingCyclesRepositoryEnabled=false.
6. Ejecutar smoke test legacy con flag OFF.
7. Mantener un periodo breve de observacion.
8. Abrir ventana SQL Production separada.
9. Ejecutar prechecks read-only y capturar baseline.
10. Aplicar las tres migraciones en orden.
11. Ejecutar postchecks de schema, grants, RLS, RPCs y legacy.
12. Mantener la flag OFF.
13. Autorizar activacion en una fase posterior independiente.
```

Ventajas:

- el deployment frontend es reversible sin tocar datos;
- el gate estricto mantiene inactivo el repository nuevo;
- el fallback legacy continua siendo la ruta productiva;
- permite observar el codigo mergeado antes de modificar schema;
- la ventana SQL conserva su propio criterio de aborto y rollback;
- la activacion funcional queda desacoplada de merge y migracion.

Riesgos:

- Production tendra temporalmente codigo scoped cuyo schema aun no existe;
- un cambio accidental de variable a `true` durante ese periodo seria
  peligroso;
- requiere disciplina para no confundir "codigo desplegado" con "feature
  habilitada".

Mitigaciones:

- confirmar visualmente la ausencia de la flag inmediatamente antes del merge;
- no crear la variable durante merge ni SQL;
- verificar en runtime que `trainingCyclesRepositoryEnabled=false`;
- mantener SQL, activacion y prueba productiva como autorizaciones separadas;
- abortar ante cualquier deployment o variable inesperada.

Evaluacion:

```text
Alternativa recomendada.
```

## 9. Matriz comparativa de riesgos

| Alternativa | Riesgo de schema | Riesgo de deployment | Riesgo de activacion accidental | Reversa inicial | Veredicto |
|---|---|---|---|---|---|
| A. SQL antes del merge | Alto: policies, grants y contrato de entries cambian primero | Bajo | Bajo con flag OFF | SQL potencialmente compleja | Viable, no preferida |
| B. Merge antes del SQL sin gates explicitos | Bajo al inicio | Medio | Alto si existe flag `true` | Frontend simple | No aprobar asi |
| C. Merge con flag OFF y SQL posterior | Diferido a ventana controlada | Bajo/medio | Bajo con verificacion estricta | Frontend primero; SQL separada | Recomendada |

## 10. Recomendacion tecnica

Arquitectura deberia elegir la alternativa C.

Razon:

1. El frontend cycle-scoped solo se activa en Production con comparacion exacta
   a `ENABLE_TRAINING_CYCLES_REPOSITORY === "true"`.
2. La variable fue removida en 2.2BI.
3. El merge con flag ausente conserva el fallback legacy.
4. Las migraciones alteran objetos compartidos con legacy y merecen una
   ventana dedicada.
5. Deployment, SQL y activacion tienen rollbacks distintos y no deben
   combinarse en una sola accion.

Decisiones que esta recomendacion no autoriza:

- merge del PR #30;
- SQL Production;
- creacion o activacion de la feature flag;
- prueba productiva cycle-scoped.

## 11. Checklist previo a SQL Production

Requiere autorizacion separada:

1. Confirmar project ref y ambiente Supabase Production.
2. Confirmar que no existe duda de ambiente.
3. Confirmar flag Production ausente/OFF.
4. Confirmar deployment Production estable y commit exacto.
5. Capturar baseline de:
   - tablas y columnas existentes;
   - constraints y FKs;
   - policies de `training_cycles`, `training_sessions` y
     `exercise_entries`;
   - grants de `anon` y `authenticated`;
   - firmas y seguridad de RPC existentes;
   - conteos legacy;
   - nulabilidad de `exercise_entries.exercise_id`;
   - filas con `exercise_id is null`;
   - ciclos activos existentes.
6. Comparar baseline con todos los supuestos de las tres migraciones.
7. Confirmar que los archivos auditados coinciden byte a byte con los
   autorizados.
8. Confirmar orden de ejecucion.
9. Confirmar responsable, ventana, evidencia y canal de aborto.
10. Confirmar rollback y preferencia por forward-fix.
11. No usar `supabase db push` ni `migration repair`.
12. Abortar si aparece cualquier SQL adicional no autorizado.

## 12. Checklist previo a merge

Requiere autorizacion separada:

1. PR #30 `OPEN`, Ready for review y no mergeado.
2. Base `main` y head esperado.
3. HEAD exacto autorizado.
4. `MERGEABLE / CLEAN`.
5. Todos los checks en success.
6. Preview `READY`, target Preview.
7. Diff final revisado sin `.env`, secretos ni `supabase/.temp/`.
8. Confirmar visualmente que
   `ENABLE_TRAINING_CYCLES_REPOSITORY` no aparece en Production.
9. Confirmar que `NEXT_PUBLIC_ENABLE_QA_TOOLS` y
   `NEXT_PUBLIC_SUPABASE_ENV` no estan configuradas para Production ni como
   `All Environments`; deben quedar limitadas a Preview/QA segun corresponda.
10. Confirmar que no existe deployment Production inesperado.
11. Confirmar que el merge no ejecuta SQL automaticamente.
12. Confirmar que QA tools no se habilitan en Production.
13. Confirmar plan de observacion y rollback frontend.
14. Obtener autorizacion explicita de Arquitectura para merge.

## 13. Checklist posterior a merge

Con flag aun ausente/OFF:

1. Identificar commit de merge en `main`.
2. Confirmar deployment Vercel Production asociado.
3. Confirmar `target=production` y estado `READY`.
4. Confirmar commit desplegado exacto.
5. Confirmar que no hubo cambios de variables Vercel.
6. Confirmar `trainingCyclesRepositoryEnabled=false`.
7. Confirmar que Training usa fallback legacy.
8. Ejecutar smoke test no destructivo del flujo legacy.
9. Revisar errores de runtime y Network.
10. Confirmar que no se intentan RPC o tablas cycle-scoped.
11. Confirmar que no se crean ciclos, sesiones o entries scoped.
12. Mantener SQL Production bloqueado hasta cerrar evidencia del deployment.

## 14. Rollback SQL

El rollback SQL no debe ejecutarse automaticamente.

Orden de respuesta:

1. Mantener la feature flag ausente/OFF.
2. Detener cualquier prueba funcional.
3. Preservar logs, errores, conteos y evidencia.
4. Determinar si el archivo fallo dentro de una transaccion o quedo aplicado.
5. Preferir un patch forward-fix cuando exista estado parcial o datos nuevos.
6. Restaurar policies, grants o RPCs previas solo desde una version auditada.
7. Para el contrato de entries:

```sql
alter table public.exercise_entries
  drop constraint if exists exercise_entries_exercise_or_cycle_exercise_check;
```

8. Restaurar `exercise_id NOT NULL` solo si:

```sql
select count(*)
from public.exercise_entries
where exercise_id is null;
```

devuelve `0`.

9. Si existen entries con `exercise_id = null`, no restaurar `NOT NULL` ni
   borrar datos sin una fase separada.
10. Retirar columnas, FKs o tablas solo si no existen dependencias ni evidencia
    que preservar.
11. No ejecutar `DROP TABLE`, `DELETE`, backfill o limpieza como respuesta
    improvisada.

## 15. Rollback frontend

Mientras la flag permanezca ausente/OFF, el rollback funcional ya esta
contenido por el gating.

Si el deployment mergeado presenta una regresion legacy:

1. No crear ni activar la flag.
2. Revertir o redeployar el ultimo commit Production aprobado mediante una
   fase autorizada.
3. Confirmar target Production, commit y estado `READY`.
4. Confirmar fallback legacy.
5. Confirmar ausencia de requests a tablas/RPC cycle-scoped.
6. Preservar cualquier dato cycle-scoped; no borrar como parte del rollback
   frontend.

Si la feature se activa en una fase futura y falla:

1. remover o fijar la flag en `false`;
2. redeployar controladamente;
3. confirmar `trainingCyclesRepositoryEnabled=false`;
4. volver al fallback legacy;
5. conservar datos para auditoria.

## 16. Postchecks productivos

### Deployment con flag OFF

- deployment `READY`;
- target y commit exactos;
- flag ausente/OFF;
- QA tools deshabilitadas;
- variables Supabase apuntan a Production;
- fallback legacy operativo;
- sin requests cycle-scoped;
- sin errores nuevos de runtime.

### SQL Production

- tablas `training_cycle_*` presentes;
- columnas y constraints esperadas;
- FKs compuestas validas;
- triggers `updated_at` presentes;
- RLS habilitada;
- policies exactas `to authenticated`;
- `anon` sin grants;
- `authenticated` solo con `SELECT`, `INSERT` y `UPDATE`;
- sin `DELETE`, `TRUNCATE`, `REFERENCES` ni `TRIGGER`;
- RPCs presentes como `SECURITY INVOKER`;
- conteos legacy sin cambios inesperados;
- `exercise_id` legacy sigue consultable;
- constraint alternativa presente;
- ninguna operacion funcional cycle-scoped mientras la flag siga OFF.

### Activacion futura

Solo en una fase posterior:

- crear/configurar la flag con autorizacion;
- redeployar;
- confirmar runtime ON;
- ejecutar una prueba productiva minima autorizada;
- validar ciclo, rutina, dia, ejercicio, sesion y entry;
- confirmar `training_cycle_exercise_id`;
- permitir `exercise_id = null` sin legacy artificial;
- validar dashboard, historial, RLS y rollback.

## 17. Criterios de aborto

Abortar merge o ventana SQL si:

- la flag aparece configurada o no puede confirmarse su ausencia;
- PR, base, head o commit no coinciden;
- hay checks pendientes o fallidos;
- existe conflicto con `main`;
- Preview o Production no estan `READY`;
- aparece un deployment Production inesperado;
- Production apunta a QA o Preview apunta a Production;
- hay duda de Supabase project ref;
- el baseline no coincide con la migracion;
- existen policies, grants, constraints o RPC no inventariados;
- existen datos incompatibles con constraints nuevas;
- una migracion falla o queda parcialmente aplicada;
- cambian conteos legacy sin explicacion;
- RLS o grants quedan mas amplios;
- se requiere SQL, backfill, `db push` o `migration repair` adicional;
- el rollback no es viable;
- aparece mezcla de ciclos o legacy artificial;
- se solicita activar la flag dentro de la misma ventana.

## 18. Decision solicitada a Arquitectura

Se solicita decidir y autorizar por separado:

```text
Fase siguiente recomendada:
merge controlado del PR #30 con feature flag Production ausente/OFF.
```

Condicion:

```text
No incluir SQL Production ni activacion de Training Cycles en la fase de merge.
```

Despues de validar el deployment mergeado y el fallback legacy:

```text
Abrir una fase distinta para prechecks y aplicacion controlada de las tres
migraciones en Supabase Production.
```

La activacion de `ENABLE_TRAINING_CYCLES_REPOSITORY=true` debe permanecer
bloqueada hasta que SQL Production y todos sus postchecks esten aprobados.

## 19. Confirmaciones de alcance 2.2BK

- No se hizo merge.
- No se aplico SQL Production.
- No se toco Supabase Production.
- No se genero Vercel Production Deployment.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se activaron feature flags productivas.
- No se hizo backfill.
- No se tocaron datos productivos.
- No se cambiaron variables Vercel.
- No se hizo redeploy manual.
- No se hizo commit.
- No se hizo push.
- `supabase/.temp/` permanece untracked y no incluido.
