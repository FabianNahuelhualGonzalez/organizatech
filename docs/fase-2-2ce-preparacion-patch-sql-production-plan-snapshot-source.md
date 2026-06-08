# Fase 2.2CE - Preparacion de patch SQL Production plan_snapshot.source

## 1. Resumen ejecutivo

2.2CE prepara la decision futura para ejecutar en Supabase Production el patch:

```text
supabase/migrations/20260607_training_cycle_scoped_snapshot_source.sql
```

El patch recrea la RPC:

```text
public.create_training_cycle_with_plan
```

para que los ciclos nuevos creados por el flujo cycle-scoped persistan el marcador externo neutral:

```text
plan_snapshot.source = "cycle-scoped"
```

manteniendo separado el origen interno del payload:

```text
plan_snapshot.plan.source = "ui-main-qa" | "ui-main-production"
```

Esta fase no autoriza ejecutar SQL Production, no aplica migraciones, no toca Supabase remoto y no activa Training Cycles Production.

## 2. Estado heredado de 2.2CD

Estado aprobado por Arquitectura:

```text
2.2CD: cerrada y aprobada
Merge controlado: OK
Production deployment: READY
Smoke test Production: OK
Training legacy: OK
Training Cycles Production: no expuesto
/qa/training-cycles: bloqueado
Feature flag productiva: OFF / no activada
Llamadas cycle-scoped inesperadas: 0
Production estable: OK
```

Implicancias:

- el codigo con compatibilidad dual ya esta en `main`;
- Production sigue sin exponer Training Cycles;
- la feature flag productiva sigue ausente/OFF;
- no se deben crear ciclos productivos;
- el patch SQL de `plan_snapshot.source` sigue pendiente para Production.

## 3. Patch objetivo

Archivo exacto:

```text
supabase/migrations/20260607_training_cycle_scoped_snapshot_source.sql
```

Objetivo funcional:

```text
Cambiar el marker externo de nuevos ciclos:
plan_snapshot.source = "cycle-scoped"
```

Mantener intacto:

```text
plan_snapshot.plan.source
```

Ese valor sigue viniendo desde el frontend como fuente operativa del payload:

```text
ui-main-qa
ui-main-production
```

## 4. Hash SHA-256

Hash SHA-256 local confirmado:

```text
5B62073B820D1C974F0792EE816CBA2B4A76A1041B53B76F21F350184045E915
```

Comando usado en Windows:

```powershell
Get-FileHash .\supabase\migrations\20260607_training_cycle_scoped_snapshot_source.sql -Algorithm SHA256
```

Este hash debe volver a confirmarse inmediatamente antes de cualquier ejecucion futura en Production.

## 5. Evidencia de validacion QA previa

Evidencia documental local:

- 2.2BU preparo compatibilidad dual en frontend para reconocer:

```text
cycle-scoped-qa
cycle-scoped
```

- 2.2BV preparo el gate QA del patch con el mismo hash.
- 2.2BX documento que QA ya tenia:

```text
Nuevo marker cycle-scoped confirmado.
Ciclo 7 creado con plan_snapshot.source = "cycle-scoped".
plan_snapshot.plan.source = "ui-main-qa".
Persistencia cycle-scoped confirmada.
Ausencia de legacy artificial confirmada.
Production intacta.
```

- 2.2CC documento la validacion funcional aprobada sobre Ciclo 7:

```text
guardado scoped OK
render/dashboard scoped OK
estado Registrado/Completado OK
duplicados inesperados NO
legacy artificial NO
```

Conclusion: el patch fue aplicado y validado en QA segun evidencia documental aceptada por Arquitectura antes de preparar Production.

## 6. Alcance tecnico de la migracion

La migracion contiene:

```sql
create or replace function public.create_training_cycle_with_plan(...)
```

con:

```sql
language plpgsql
security invoker
set search_path = public, pg_temp
```

Tambien restablece el permiso de ejecucion:

```sql
grant execute on function public.create_training_cycle_with_plan(...) to authenticated;
```

Alcance confirmado:

- recrea la RPC `public.create_training_cycle_with_plan`;
- conserva firma publica de la funcion;
- conserva `SECURITY INVOKER`;
- conserva validaciones de usuario, fechas, plan minimo y ciclo activo duplicado;
- conserva inserciones transaccionales en `training_cycles`, `training_cycle_routines`, `training_cycle_days` y `training_cycle_exercises`;
- conserva `p_plan` dentro de `plan_snapshot.plan`;
- cambia el literal externo usado en nuevos ciclos:

```text
"cycle-scoped-qa" -> "cycle-scoped"
```

No contiene:

- `insert` fuera del cuerpo de la funcion;
- `update`;
- `delete`;
- `truncate`;
- `drop table`;
- `drop column`;
- alteraciones de tablas;
- backfill;
- edicion directa de filas existentes.

## 7. Confirmacion de no modificacion de datos existentes

El patch es DDL de funcion y permiso de ejecucion.

No modifica datos existentes porque:

- no ejecuta la RPC;
- no contiene DML directo sobre `training_cycles`;
- no actualiza snapshots historicos;
- no crea ciclos;
- no cambia sesiones ni entries;
- no hace backfill.

Los ciclos historicos con:

```text
plan_snapshot.source = "cycle-scoped-qa"
```

deben permanecer intactos.

## 8. Confirmacion de no tocar Ciclo 1

El patch no referencia ningun `cycle_id`, `cycle_number`, nombre de ciclo ni fila especifica.

Por lo tanto:

- no edita Ciclo 1;
- no cierra Ciclo 1;
- no borra Ciclo 1;
- no lo usa como dato de prueba;
- no exige que Ciclo 1 tenga tablas `training_cycle_*` asociadas.

Ciclo 1 debe protegerse explicitamente en prechecks y postchecks.

## 9. Prechecks read-only Production

Estos controles se preparan para una fase posterior. No se ejecutan en 2.2CE.

### 9.1 Confirmacion visual de ambiente

Antes de cualquier SQL futuro:

- confirmar visualmente Supabase Production;
- confirmar project ref Production;
- confirmar que no es QA;
- confirmar que la feature flag `ENABLE_TRAINING_CYCLES_REPOSITORY` sigue ausente/OFF;
- confirmar que Training Cycles sigue apagado.

### 9.2 Confirmar RPC actual

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  p.prosecdef as security_definer,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_training_cycle_with_plan';
```

Esperado antes del patch:

- la funcion existe;
- `security_definer = false`;
- la definicion aun contiene el marker anterior o no contiene el marker neutral exacto para nuevos ciclos.

### 9.3 Confirmar markers en la funcion

```sql
with rpc as (
  select pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_training_cycle_with_plan'
)
select
  position('''source'', ''cycle-scoped-qa''' in definition) > 0 as has_external_qa_marker,
  position('''source'', ''cycle-scoped''' in definition) > 0 as has_external_neutral_marker
from rpc;
```

Lectura esperada:

- si `has_external_qa_marker = true`, Production aun requiere el patch;
- si `has_external_neutral_marker = true`, revisar si el patch ya fue aplicado antes de repetirlo;
- si ambos son inesperados, abortar y volver a Arquitectura.

### 9.4 Confirmar Ciclo 1 antes del patch

Capturar evidencia read-only antes de ejecutar:

```sql
select
  id,
  user_id,
  name,
  cycle_number,
  cycle_type,
  goal,
  status,
  started_at,
  ended_at,
  duration_weeks,
  planned_start_date,
  planned_end_date,
  plan_snapshot->>'source' as snapshot_source,
  plan_snapshot->'plan'->>'source' as plan_source,
  updated_at
from public.training_cycles
where cycle_number = 1
order by created_at asc;
```

No usar esta consulta para modificar datos.

### 9.5 Capturar conteos antes del patch

```sql
select count(*) as training_cycles_count
from public.training_cycles;
```

```sql
select count(*) as active_training_cycles_count
from public.training_cycles
where status = 'active'
  and deleted_at is null;
```

Si existen tablas cycle-scoped en Production, capturar conteos sin modificar:

```sql
select count(*) as training_cycle_routines_count
from public.training_cycle_routines;
```

```sql
select count(*) as training_cycle_days_count
from public.training_cycle_days;
```

```sql
select count(*) as training_cycle_exercises_count
from public.training_cycle_exercises;
```

### 9.6 Confirmar que no se usara Ciclo 1 como prueba

Checklist operativo:

- [ ] No cerrar Ciclo 1.
- [ ] No editar Ciclo 1.
- [ ] No borrar Ciclo 1.
- [ ] No crear sesiones sobre Ciclo 1.
- [ ] No asociar plan cycle-scoped a Ciclo 1.

## 10. Postchecks read-only Production

Estos controles se preparan para despues de una ejecucion futura autorizada. No se ejecutan en 2.2CE.

### 10.1 RPC existe y sigue SECURITY INVOKER

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  p.prosecdef as security_definer,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_training_cycle_with_plan';
```

Esperado:

```text
security_definer = false
```

La definicion debe mostrar:

```text
security invoker
```

### 10.2 RPC usa marker externo neutral

```sql
with rpc as (
  select pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_training_cycle_with_plan'
)
select
  position('''source'', ''cycle-scoped''' in definition) > 0 as has_external_neutral_marker,
  position('''source'', ''cycle-scoped-qa''' in definition) > 0 as has_external_qa_marker
from rpc;
```

Esperado despues del patch:

```text
has_external_neutral_marker = true
has_external_qa_marker = false
```

Nota: ciclos historicos pueden conservar `plan_snapshot.source = "cycle-scoped-qa"` en datos. Este postcheck revisa el literal de la RPC, no hace backfill.

### 10.3 Ciclo 1 intacto

Repetir la consulta de 9.4 y comparar con la evidencia previa.

Esperado:

- mismo `id`;
- mismo `status`;
- sin cierre;
- sin borrado;
- sin edicion manual;
- sin asociacion de plan cycle-scoped.

### 10.4 No se crearon ciclos productivos

Repetir conteos de 9.5.

Esperado:

- `training_cycles_count` sin incremento por esta fase;
- `active_training_cycles_count` sin incremento por esta fase;
- cero ciclos nuevos creados como parte del patch.

### 10.5 No se modificaron datos existentes

Confirmar documentalmente:

- no se ejecuto RPC;
- no se ejecuto `insert/update/delete`;
- no se hizo backfill;
- no se modificaron snapshots historicos.

## 11. Rollback / forward-fix

### 11.1 Si el precheck falla

No ejecutar SQL.

Reportar:

- punto exacto de falla;
- ambiente observado;
- funcion actual;
- estado de feature flag;
- estado de Ciclo 1.

### 11.2 Si falla la aplicacion SQL

Abortar sin reintentos automaticos.

Capturar:

- error exacto;
- si la RPC quedo modificada o no;
- si `grant execute` quedo aplicado o no.

Preparar forward-fix con autorizacion separada.

### 11.3 Si el postcheck falla

Mantener Training Cycles Production apagado.

Opciones posibles con autorizacion separada:

- volver a recrear la RPC con una correccion forward-fix;
- restaurar la RPC anterior desde `20260604_training_cycle_scoped_model.sql`;
- mantener el patch pendiente y bloquear activacion funcional.

No hacer:

- backfill;
- edicion manual de ciclos;
- borrado de datos;
- cierre de Ciclo 1;
- creacion de ciclos productivos.

## 12. Criterios de aborto

Abortar si:

- hay duda de ambiente Production;
- project ref no coincide con Production;
- la feature flag productiva aparece activa;
- Training Cycles aparece expuesto en Production;
- el hash SHA-256 no coincide;
- el archivo SQL difiere del versionado;
- la RPC actual ya tiene una forma no esperada;
- `security_definer = true`;
- se propone ejecutar `db push`;
- se propone ejecutar `migration repair`;
- se propone crear un ciclo productivo para probar;
- se propone tocar Ciclo 1;
- se propone backfill;
- aparecen datos o objetos inesperados que requieren diagnostico previo.

## 13. Riesgos

| Riesgo | Impacto | Control |
| --- | --- | --- |
| Ejecutar en ambiente incorrecto | Podria alterar QA o Production no objetivo | Confirmacion visual y project ref antes de ejecutar |
| Repetir patch sin revisar estado actual | Puede ocultar divergencia previa | Precheck de definicion RPC y markers |
| Confundir `plan_snapshot.source` con `plan_snapshot.plan.source` | Auditoria de origen ambigua | Mantener externo `cycle-scoped` e interno `ui-main-*` |
| Activar Training Cycles antes del patch | Ciclos productivos podrian nacer con marker anterior | Feature flag OFF hasta autorizacion separada |
| Tocar Ciclo 1 como prueba | Riesgo de dato productivo | Prohibicion explicita y postcheck de integridad |

## 14. Restricciones vigentes

No autorizado en 2.2CE:

- ejecutar SQL Production;
- Supabase write Production;
- aplicar el patch;
- activar Training Cycles Production;
- activar `ENABLE_TRAINING_CYCLES_REPOSITORY`;
- crear/modificar variables Vercel;
- redeploy;
- crear ciclos productivos;
- backfill;
- modificar/borrar/cerrar Ciclo 1;
- tocar datos productivos;
- `db push`;
- `migration repair`.

## 15. Decision solicitada a Arquitectura

Se solicita a Arquitectura decidir:

```text
A) Autorizar ejecucion SQL Production controlada del patch via SQL Editor manual.
B) Solicitar auditoria adicional antes de ejecutar.
C) Mantener patch pendiente.
```

Recomendacion tecnica:

```text
Opcion A es viable solo si el gate pre-ejecucion confirma Production correcto,
hash SHA-256 coincidente, feature flag OFF, Training Cycles apagado y Ciclo 1
protegido. La ejecucion debe hacerse exclusivamente por SQL Editor manual y
sin db push, migration repair, backfill ni creacion de ciclos productivos.
```

Hasta una autorizacion separada:

- no ejecutar SQL;
- no tocar Supabase remoto;
- no activar Training Cycles;
- no crear ciclos productivos.
