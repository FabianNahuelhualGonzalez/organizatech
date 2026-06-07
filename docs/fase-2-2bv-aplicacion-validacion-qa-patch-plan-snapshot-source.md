# Fase 2.2BV - Aplicacion y validacion QA del patch plan_snapshot.source

## 1. Resumen ejecutivo

2.2BV prepara el gate de ejecucion QA para aplicar y validar el patch:

```text
supabase/migrations/20260607_training_cycle_scoped_snapshot_source.sql
```

El objetivo del patch es que nuevos ciclos creados por `create_training_cycle_with_plan` persistan:

```text
plan_snapshot.source = "cycle-scoped"
```

manteniendo intacto el payload anidado:

```text
plan_snapshot.plan.source = "ui-main-qa" | "ui-main-production"
```

Esta primera parte no aplica SQL. Solo documenta el gate, prechecks, secuencia, postchecks, rollback y criterios de aborto para una ejecucion posterior en Supabase QA.

## 2. Estado actual tras 2.2BU

Estado aceptado:

- 2.2BU cerrada y aprobada.
- Commit remoto aceptado: `5d94fdaddf1cd9fddda9b24df4eccb1c3a822a86`.
- Frontend versionado con compatibilidad dual:

```text
cycle-scoped-qa
cycle-scoped
```

- Migracion candidata versionada:

```text
supabase/migrations/20260607_training_cycle_scoped_snapshot_source.sql
```

- SQL QA no ejecutado todavia.
- SQL Production no ejecutado.
- Training Cycles Production no activado.
- Production estable y bloqueada.

## 3. Production bloqueada

Production queda fuera del alcance de 2.2BV.

No autorizado:

- SQL Production;
- Supabase write Production;
- activar Training Cycles;
- activar `ENABLE_TRAINING_CYCLES_REPOSITORY`;
- crear ciclos productivos;
- tocar Ciclo 1;
- tocar datos productivos;
- backfill;
- Vercel Production;
- redeploy Production.

## 4. SQL Production no autorizado

La migracion candidata solo puede evaluarse en QA con autorizacion operativa separada dentro de 2.2BV.

No se debe aplicar en Production.

No se debe usar:

```text
db push
migration repair
```

## 5. Activacion Training Cycles Production no autorizada

Aunque el frontend ya tiene compatibilidad dual, la activacion funcional productiva sigue bloqueada.

La variable:

```text
ENABLE_TRAINING_CYCLES_REPOSITORY
```

debe permanecer ausente/OFF en Production.

## 6. Migracion candidata exacta

Archivo:

```text
supabase/migrations/20260607_training_cycle_scoped_snapshot_source.sql
```

Funcion afectada:

```text
public.create_training_cycle_with_plan
```

Cambio esperado:

```text
plan_snapshot.source: "cycle-scoped-qa" -> "cycle-scoped"
```

Sin cambio esperado:

```text
plan_snapshot.plan.source
```

Ese valor sigue viniendo desde el frontend como:

```text
ui-main-qa
ui-main-production
```

## 7. Hash SHA-256

Hash SHA-256 local de la migracion candidata:

```text
5B62073B820D1C974F0792EE816CBA2B4A76A1041B53B76F21F350184045E915
```

Este hash debe confirmarse inmediatamente antes de cualquier aplicacion QA.

## 8. Metodo de aplicacion QA recomendado

Metodo recomendado:

```text
SQL Editor manual Supabase QA
```

Condiciones:

- confirmar visualmente que el proyecto es Supabase QA;
- confirmar project ref QA antes de ejecutar;
- pegar exclusivamente el contenido de la migracion candidata;
- no ejecutar otros scripts;
- no usar `db push`;
- no usar `migration repair`;
- no tocar Production.

Si Arquitectura autoriza otro metodo controlado QA, debe quedar documentado antes de ejecutar.

## 9. Confirmacion: no db push

2.2BV no autoriza:

```text
supabase db push
```

La aplicacion QA, si se autoriza, debe ser manual/controlada y limitada al patch candidato.

## 10. Confirmacion: no migration repair

2.2BV no autoriza:

```text
supabase migration repair
```

No se debe alterar el historial remoto de migraciones.

## 11. Prechecks QA antes de aplicar

Antes de cualquier SQL QA, confirmar:

1. Supabase QA confirmado visualmente.
2. Project ref QA confirmado.
3. Preview apunta a QA.
4. QA tools habilitadas solo en Preview.
5. Production intacta.
6. `ENABLE_TRAINING_CYCLES_REPOSITORY` sigue ausente/OFF en Production.
7. Migracion candidata exacta y hash SHA-256 coinciden.
8. RPC actual en QA existe antes del patch:

```sql
select
  p.proname,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_training_cycle_with_plan';
```

9. La funcion actual en QA contiene el marker previo:

```text
'source', 'cycle-scoped-qa'
```

10. Confirmar ciclos QA existentes con marker historico, si existen:

```sql
select
  id,
  name,
  status,
  plan_snapshot->>'source' as snapshot_source,
  plan_snapshot->'plan'->>'source' as plan_source
from public.training_cycles
where plan_snapshot->>'source' in ('cycle-scoped-qa', 'cycle-scoped')
order by created_at desc;
```

11. Confirmar que no se usara ningun ciclo productivo.
12. Confirmar que no se hara backfill.

Abortar si no se puede distinguir QA de Production con certeza.

## 12. Secuencia de aplicacion SQL QA

Secuencia propuesta, solo con autorizacion operativa:

1. Abrir Supabase QA.
2. Confirmar project ref QA.
3. Confirmar Production fuera de alcance.
4. Confirmar hash de:

```text
supabase/migrations/20260607_training_cycle_scoped_snapshot_source.sql
```

5. Abrir SQL Editor manual en QA.
6. Pegar el contenido completo de la migracion candidata.
7. Ejecutar una sola vez.
8. Guardar evidencia de resultado.
9. Ejecutar postchecks.
10. No ejecutar otros scripts.

## 13. Postchecks QA

### 13.1 RPC existe

```sql
select
  p.proname,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_training_cycle_with_plan';
```

Debe existir una funcion `public.create_training_cycle_with_plan`.

### 13.2 RPC SECURITY INVOKER

Confirmar en la definicion:

```text
security invoker
```

### 13.3 RPC usa marker externo nuevo

Confirmar en la definicion:

```text
'source', 'cycle-scoped'
```

Confirmar que ya no sea el literal externo usado para nuevos ciclos:

```text
'source', 'cycle-scoped-qa'
```

Nota: puede seguir apareciendo en datos historicos, pero no debe quedar como literal de la RPC.

### 13.4 Nuevo ciclo QA usa plan_snapshot.source = "cycle-scoped"

Si Arquitectura autoriza crear un ciclo QA de prueba, validar:

```sql
select
  id,
  name,
  status,
  plan_snapshot->>'source' as snapshot_source,
  plan_snapshot->'plan'->>'source' as plan_source
from public.training_cycles
where id = '<cycle_id_qa>';
```

Resultado esperado:

```text
snapshot_source = cycle-scoped
plan_source = ui-main-qa
```

### 13.5 plan_snapshot.plan.source sigue ui-main-qa

En Preview QA, el payload anidado debe seguir indicando:

```text
ui-main-qa
```

No debe cambiar a:

```text
cycle-scoped
cycle-scoped-qa
```

### 13.6 Ciclos existentes cycle-scoped-qa siguen renderizando

Validar en Preview/QA que ciclos existentes con:

```text
plan_snapshot.source = cycle-scoped-qa
```

siguen siendo reconocidos como cycle-scoped por el frontend.

Resultado esperado:

- render desde tablas `training_cycle_*`;
- rutina correcta;
- dia correcto;
- ejercicios correctos;
- sin fallback legacy silencioso.

### 13.7 Guardado scoped funciona

Si Arquitectura autoriza prueba funcional:

- registrar entrenamiento sobre ciclo QA cycle-scoped;
- confirmar escritura real via RPC de sesiones;
- confirmar:

```text
training_sessions.cycle_id
training_sessions.cycle_day_id
exercise_entries.training_cycle_exercise_id
```

- confirmar que `exercise_entries.exercise_id` puede ser null si no hay legacy asociado.

### 13.8 Sin fallback legacy silencioso

La UI no debe mostrar rutinas/ejercicios legacy cuando exista ciclo activo cycle-scoped.

Abortar si reaparecen datos legacy no asociados al ciclo.

### 13.9 Sin legacy artificial

No se deben crear ni enlazar ejercicios legacy artificiales para validar el patch.

### 13.10 Production intacta

Confirmar:

- no Production SQL;
- no Production deployment manual;
- no feature flag productiva;
- no ciclos productivos;
- no cambios en Ciclo 1.

## 14. Rollback / forward-fix QA

Si la aplicacion QA falla antes de ejecutar:

- no hay rollback;
- reportar el precheck fallido.

Si la aplicacion SQL falla durante ejecucion:

- capturar error exacto;
- no reintentar sin analisis;
- confirmar si la funcion quedo modificada o no;
- preparar forward-fix QA si corresponde.

Si la funcion queda aplicada pero postchecks fallan:

- mantener Production bloqueada;
- no activar Training Cycles;
- restaurar/recrear la RPC QA anterior solo con autorizacion separada;
- preferir forward-fix si ya existen ciclos QA con `"cycle-scoped"`;
- no borrar ciclos QA sin autorizacion;
- no tocar datos productivos.

## 15. Criterios de aborto

Abortar si:

- hay duda de ambiente QA;
- no se puede confirmar project ref QA;
- la migracion candidata no coincide con el hash documentado;
- Preview no apunta a QA;
- QA tools aparecen fuera de Preview;
- Production muestra cambios no esperados;
- se intenta usar `db push`;
- se intenta usar `migration repair`;
- el SQL propuesto difiere del archivo versionado;
- se intenta ejecutar SQL Production;
- se intenta activar feature flag productiva;
- se intenta crear ciclo productivo;
- se intenta tocar Ciclo 1;
- los postchecks detectan fallback legacy silencioso;
- ciclos existentes con `"cycle-scoped-qa"` dejan de renderizar.

## 16. Evidencia requerida

La fase QA posterior debe adjuntar:

1. Project ref QA confirmado.
2. Hash SHA-256 confirmado.
3. Resultado de aplicacion SQL QA.
4. Definicion de RPC postpatch.
5. Evidencia de `security invoker`.
6. Evidencia de literal externo `"cycle-scoped"` en RPC.
7. Evidencia de ciclo nuevo QA con:

```text
plan_snapshot.source = cycle-scoped
plan_snapshot.plan.source = ui-main-qa
```

si se autoriza crear ciclo QA.

8. Evidencia de ciclo existente `"cycle-scoped-qa"` renderizando.
9. Evidencia de guardado scoped, si se autoriza prueba funcional.
10. Confirmacion de no Production.
11. Confirmacion de no `db push`.
12. Confirmacion de no `migration repair`.

## 17. Decision solicitada a Arquitectura

Se solicita a Arquitectura revisar este gate y decidir:

```text
Autorizar o no la aplicacion controlada del patch
supabase/migrations/20260607_training_cycle_scoped_snapshot_source.sql
en Supabase QA.
```

Si se autoriza:

- ejecutar solo en QA;
- seguir la secuencia documentada;
- ejecutar postchecks completos;
- mantener Production bloqueada;
- mantener Training Cycles Production apagado.

Si no se autoriza:

- no aplicar SQL;
- mantener el patch solo versionado/local/remoto;
- documentar motivo y siguiente accion.
