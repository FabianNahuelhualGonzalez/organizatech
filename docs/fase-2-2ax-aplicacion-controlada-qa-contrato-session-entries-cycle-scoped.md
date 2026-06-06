# Fase 2.2AX - Aplicacion controlada QA contrato session_entries cycle-scoped

## 1. Contexto

Arquitectura aprobo preparar la Fase 2.2AX para aplicar en Supabase QA, de forma controlada, el contrato SQL que permite persistir sesiones y entries 100% cycle-scoped.

Production queda bloqueada.

No se autoriza:

- SQL Production.
- Supabase Production.
- `supabase db push`.
- `supabase migration repair`.
- Vercel Production.
- merge a `main`.
- PR.
- backfill.
- frontend fix.
- crear datos productivos.
- editar o borrar datos productivos.

## 2. Archivo exacto auditado

Patch candidato aprobado para preparar ejecucion QA:

```text
supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql
```

Este archivo:

- relaja `public.exercise_entries.exercise_id` para permitir `null`;
- agrega constraint `exercise_entries_exercise_or_cycle_exercise_check`;
- recrea la policy `entries own rows`;
- reemplaza `public.create_training_session_with_cycle_entries`;
- no crea ni enlaza ejercicios legacy artificiales.

## 3. Checklist de ejecucion QA

Antes de aplicar:

1. Confirmar ambiente Supabase QA.
2. Confirmar explicitamente que no es Production.
3. Confirmar archivo exacto:
   `supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql`.
4. Ejecutar prechecks read-only.
5. Confirmar que los prechecks son compatibles con el objetivo.
6. Aplicar manualmente el SQL del archivo solo en QA.
7. Ejecutar postchecks SQL QA.
8. Ejecutar prueba funcional QA sobre Ciclo 6 solo si Arquitectura/TI lo autorizan dentro de esta fase.
9. Documentar evidencia.
10. Si cualquier criterio de aborto ocurre, detener y reportar.

## 4. Prechecks QA read-only

### 4.1 Ambiente

```sql
select current_database() as database_name;
```

Si existe forma visible de confirmar project ref en la herramienta usada, registrar:

```text
project_ref = QA
Production = no
```

Abortar si hay duda de ambiente.

### 4.2 Columnas de exercise_entries

```sql
select
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'exercise_entries'
  and c.column_name in ('exercise_id', 'training_cycle_exercise_id')
order by c.column_name;
```

Confirmacion esperada antes del patch:

```text
exercise_id = NOT NULL
training_cycle_exercise_id = nullable
```

Verificacion directa de `NOT NULL`:

```sql
select
  a.attname,
  a.attnotnull
from pg_attribute a
where a.attrelid = 'public.exercise_entries'::regclass
  and a.attname in ('exercise_id', 'training_cycle_exercise_id')
  and not a.attisdropped
order by a.attname;
```

### 4.3 Constraints y foreign keys actuales

```sql
select
  conname,
  contype,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.exercise_entries'::regclass
order by conname;
```

### 4.4 RPC actual

```sql
select to_regprocedure(
  'public.create_training_session_with_cycle_entries(uuid,uuid,text,date,date,text,integer,text,jsonb)'
) as rpc_signature;
```

Debe devolver la firma de la RPC.

### 4.5 Tablas cycle-scoped requeridas

```sql
select
  to_regclass('public.training_cycles') as training_cycles,
  to_regclass('public.training_cycle_days') as training_cycle_days,
  to_regclass('public.training_cycle_exercises') as training_cycle_exercises,
  to_regclass('public.training_sessions') as training_sessions,
  to_regclass('public.exercise_entries') as exercise_entries;
```

Todas deben existir.

### 4.6 Ciclo 6 activo y ejercicio esperado

Ciclo QA de referencia:

```text
2cb7b989-1d55-4f52-a3f4-f1e1d171fc2a
```

```sql
select
  id,
  user_id,
  name,
  cycle_type,
  goal,
  status
from public.training_cycles
where id = '2cb7b989-1d55-4f52-a3f4-f1e1d171fc2a';
```

```sql
select
  d.id as cycle_day_id,
  d.day_code,
  d.day_name,
  tce.id as training_cycle_exercise_id,
  tce.name,
  tce.target_sets,
  tce.target_reps,
  tce.base_weight,
  tce.source_legacy_exercise_id
from public.training_cycle_days d
join public.training_cycle_exercises tce
  on tce.day_id = d.id
 and tce.cycle_id = d.cycle_id
where d.cycle_id = '2cb7b989-1d55-4f52-a3f4-f1e1d171fc2a'
  and d.deleted_at is null
  and tce.deleted_at is null
order by d.week_index, d.day_code, tce.sort_order;
```

Esperado:

```text
Ciclo 6 active.
Dia Martes/tuesday.
Ejercicio prueba martes.
training_cycle_exercise_id poblado.
source_legacy_exercise_id puede ser null.
```

## 5. Aplicacion manual QA

Aplicar manualmente en Supabase QA el contenido exacto de:

```text
supabase/migrations/20260605_training_cycle_scoped_session_entries_contract.sql
```

No usar:

- `supabase db push`;
- `supabase migration repair`;
- Supabase Production.

## 6. Postchecks SQL QA

### 6.1 exercise_id acepta null

```sql
select
  a.attname,
  a.attnotnull
from pg_attribute a
where a.attrelid = 'public.exercise_entries'::regclass
  and a.attname = 'exercise_id'
  and not a.attisdropped;
```

Esperado:

```text
attnotnull = false
```

### 6.2 Constraint nueva existe

```sql
select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.exercise_entries'::regclass
  and conname = 'exercise_entries_exercise_or_cycle_exercise_check';
```

Esperado:

```text
check (exercise_id is not null or training_cycle_exercise_id is not null)
```

### 6.3 RPC existe

```sql
select to_regprocedure(
  'public.create_training_session_with_cycle_entries(uuid,uuid,text,date,date,text,integer,text,jsonb)'
) as rpc_signature;
```

Debe devolver una firma no nula.

### 6.4 Policy entries own rows existe y apunta a authenticated

```sql
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'exercise_entries'
  and policyname = 'entries own rows';
```

Esperado:

```text
roles contiene authenticated.
cmd = ALL.
No hay policy abierta con true.
```

### 6.5 Test de constraint con ambas columnas null

Esta prueba debe fallar. Ejecutarla solo en QA.

Usar una transaccion y hacer rollback manual si la herramienta no lo hace automaticamente:

```sql
begin;

insert into public.exercise_entries (
  id,
  user_id,
  session_id,
  exercise_id,
  training_cycle_exercise_id,
  weight,
  previous_weight,
  reps,
  rir,
  notes
)
select
  gen_random_uuid(),
  s.user_id,
  s.id,
  null,
  null,
  0,
  0,
  array[1],
  null,
  '2.2AX negative constraint test'
from public.training_sessions s
where s.user_id = (
  select user_id
  from public.training_cycles
  where id = '2cb7b989-1d55-4f52-a3f4-f1e1d171fc2a'
)
limit 1;

rollback;
```

Esperado:

```text
Falla por exercise_entries_exercise_or_cycle_exercise_check.
No quedan datos persistidos.
```

Si no existe ninguna `training_sessions` previa para el usuario QA, ejecutar este test despues de la prueba RPC positiva.

### 6.6 Test RPC con Ciclo 6 y exercise_id null

La RPC usa `auth.uid()`. Si se ejecuta desde SQL editor, se debe simular contexto authenticated solo en QA.

Primero capturar IDs:

```sql
select
  c.user_id,
  d.id as cycle_day_id,
  d.day_code,
  tce.id as training_cycle_exercise_id,
  tce.source_legacy_exercise_id
from public.training_cycles c
join public.training_cycle_days d
  on d.cycle_id = c.id
join public.training_cycle_exercises tce
  on tce.day_id = d.id
 and tce.cycle_id = c.id
where c.id = '2cb7b989-1d55-4f52-a3f4-f1e1d171fc2a'
  and c.status = 'active'
  and d.deleted_at is null
  and tce.deleted_at is null
order by d.week_index, d.day_code, tce.sort_order
limit 1;
```

Ejecutar la RPC con los valores capturados:

```sql
begin;

set local role authenticated;
select set_config('request.jwt.claim.sub', '<QA_USER_ID>', true);

select public.create_training_session_with_cycle_entries(
  '2cb7b989-1d55-4f52-a3f4-f1e1d171fc2a'::uuid,
  '<CYCLE_DAY_ID>'::uuid,
  'tuesday',
  current_date,
  current_date,
  'completed',
  1,
  '2.2AX QA contract test',
  jsonb_build_array(
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'training_cycle_exercise_id', '<TRAINING_CYCLE_EXERCISE_ID>',
      'exercise_id', null,
      'weight', 20,
      'previous_weight', 20,
      'reps', jsonb_build_array(10),
      'rir', '',
      'notes', '2.2AX QA contract test'
    )
  )
) as session_id;

commit;
```

Guardar el `session_id` devuelto para los postchecks.

### 6.7 Confirmar training_sessions cycle-scoped

```sql
select
  id,
  user_id,
  cycle_id,
  cycle_day_id,
  planned_day,
  status,
  notes
from public.training_sessions
where id = '<SESSION_ID>';
```

Esperado:

```text
cycle_id = 2cb7b989-1d55-4f52-a3f4-f1e1d171fc2a
cycle_day_id = CYCLE_DAY_ID
status = completed
```

### 6.8 Confirmar exercise_entries cycle-scoped puro

```sql
select
  id,
  session_id,
  exercise_id,
  training_cycle_exercise_id,
  weight,
  reps,
  notes
from public.exercise_entries
where session_id = '<SESSION_ID>';
```

Esperado:

```text
training_cycle_exercise_id poblado.
exercise_id = null.
weight = 20.
reps contiene 10.
```

### 6.9 Confirmar que no se creo legacy artificial

Capturar antes y despues:

```sql
select count(*) as exercises_count
from public.exercises
where user_id = '<QA_USER_ID>';
```

Esperado:

```text
El count no cambia por la prueba RPC.
```

### 6.10 Confirmar legacy sigue consultable

```sql
select count(*) as legacy_entries_with_exercise
from public.exercise_entries
where user_id = '<QA_USER_ID>'
  and exercise_id is not null;
```

Esperado:

```text
La consulta funciona.
Las entries legacy existentes siguen disponibles.
```

## 7. Rollback QA

Rollback sugerido, no ejecutar sin autorizacion explicita:

1. Apagar feature flag QA si aplica.
2. Preservar evidencia.
3. Restaurar la version anterior de `public.create_training_session_with_cycle_entries` desde `20260604_training_cycle_scoped_model.sql`.
4. Restaurar la policy anterior `entries own rows` desde `20260604_training_cycle_scoped_policy_fix.sql` o desde la evidencia aprobada anterior.
5. Dropear la constraint nueva:

```sql
alter table public.exercise_entries
  drop constraint if exists exercise_entries_exercise_or_cycle_exercise_check;
```

6. Restaurar `exercise_id NOT NULL` solo si no existen entries con `exercise_id null`:

```sql
select count(*) as entries_without_exercise_id
from public.exercise_entries
where exercise_id is null;
```

Si el count es `0`:

```sql
alter table public.exercise_entries
  alter column exercise_id set not null;
```

Si el count es mayor que `0`, el rollback completo requiere limpieza QA autorizada o correccion explicita de esos datos QA antes de restaurar `NOT NULL`.

## 8. Criterios de aborto

Abortar si:

- hay duda de ambiente QA;
- se detecta Production;
- el archivo exacto no coincide;
- `exercise_entries.training_cycle_exercise_id` no existe;
- `create_training_session_with_cycle_entries` no existe antes del patch;
- Ciclo 6 no existe o no esta active;
- no existe `training_cycle_exercise_id` para Ciclo 6;
- la aplicacion manual devuelve error no previsto;
- `exercise_id` sigue `NOT NULL` despues del patch;
- la constraint nueva no existe;
- la policy no queda `to authenticated`;
- el test de constraint no falla;
- la RPC no permite `exercise_id null`;
- se crea un ejercicio legacy artificial;
- se requiere cualquier SQL adicional no autorizado.

## 9. Estado de preparacion

Estado:

```text
Preparado para revision TI/Arquitectura.
No aplicado.
```

Confirmaciones:

- No se aplico SQL.
- No se toco Supabase remoto.
- No se ejecuto `supabase db push`.
- No se ejecuto `supabase migration repair`.
- No se toco Production.
- No se hizo frontend fix.
- No se hizo commit.
- No se hizo push.
