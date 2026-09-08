-- Rollback-only regression: real metadata emitted by the legacy production form.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '2s';
select extensions.plan(59);

select extensions.ok(
  not has_function_privilege('authenticated', 'private.training_cycle_replacement_source(uuid,text,uuid)', 'execute'),
  'the source helper remains private'
);
select extensions.ok(
  not has_function_privilege('anon', 'private.is_generated_legacy_cycle_note(text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.is_generated_legacy_cycle_note(text,text,text)', 'execute'),
  'the new note helper grants no application access'
);
select extensions.ok(
  private.is_generated_legacy_cycle_note(prefix || label || '.', kind, code),
  'recognizes only generated ' || kind || ' metadata for ' || code
)
from (values
 ('monday','Lunes'),('tuesday','Martes'),('wednesday','Miércoles'),
 ('thursday','Jueves'),('friday','Viernes'),('saturday','Sábado'),('sunday','Domingo')
) as days(code,label)
cross join (values
 ('routine','Plan cycle-scoped 2.2AT para '),
 ('routine','Rutina creada para '),
 ('day','Dia planificado: '),
 ('exercise','Ejercicio planificado para '),
 ('exercise','Ejercicio agregado al plan activo para '),
 ('exercise','Ejercicio actualizado para ')
) as kinds(kind,prefix);
select extensions.ok(
  not private.is_generated_legacy_cycle_note(note,kind,'monday'),
  'does not discard ' || reason
)
from (values
 ('Ejercicio planificado para Martes.','exercise','a label for another day'),
 ('Ejercicio planificado para Lunes. Hacer lento','exercise','user instructions appended to metadata'),
 ('Indicaciones de rutina','routine','free-form user notes'),
 (E'Ejercicio planificado para Lunes.\n[organizatech:future-plan-retired]','exercise','a retirement marker')
) as rejected(note,kind,reason);
select extensions.ok(
 private.is_generated_legacy_cycle_note(null,'routine','monday')
 and private.is_generated_legacy_cycle_note('  ','day','monday'),
 'empty legacy notes stay compatible'
);

-- Test identities only; a collision aborts instead of reusing an existing user.
insert into auth.users (id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values
 ('a1000000-0000-4000-8000-000000000001','authenticated','authenticated','cycle-generated-metadata@example.test','{}','{}'),
 ('a1000000-0000-4000-8000-000000000002','authenticated','authenticated','cycle-unknown-exercise@example.test','{}','{}');
insert into public.user_registrations(user_id) values
 ('a1000000-0000-4000-8000-000000000001'),('a1000000-0000-4000-8000-000000000002');
do $fixtures$
declare n integer;
begin
  for n in 1..2 loop
    perform set_config('request.jwt.claim.sub',
      'a1000000-0000-4000-8000-' || lpad(n::text,12,'0'),true);
    insert into public.training_cycles(id,user_id,name,cycle_number,goal,started_at,status,plan_snapshot,portal_scope,current_plan_version,duration_weeks,planned_start_date)
    select ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     'Legacy generated fixture',1,'Hipertrofia','2026-09-01T12:00:00Z','active','{}','usuario',0,4,'2026-09-01'
    ;
    insert into public.training_cycle_routines(id,user_id,cycle_id,name,sort_order,notes)
    select ('a3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     'Lunes',0,'Plan cycle-scoped 2.2AT para Lunes.'
    ;
    insert into public.training_cycle_days(id,user_id,cycle_id,routine_id,week_index,day_code,sort_order,notes)
    select ('a4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     ('a3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     1,'monday',0,'Dia planificado: Lunes.'
    ;
    insert into public.training_exercise_lineages(id,user_id,portal_scope,origin_kind)
    values (
      ('a7000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      'usuario','scoped'
    );
    insert into public.training_cycle_exercises(id,user_id,cycle_id,day_id,name,target_sets,target_reps,base_weight,side_weight,sort_order,notes,exercise_lineage_id)
    select ('a5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     ('a4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     case when n=1 then 'Remo artesanal con barra' else 'Ejercicio 1' end,
     3,12,40,null,0,'Ejercicio planificado para Lunes.',
     ('a7000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
    ;
  end loop;
end $fixtures$;

create temp view generated_metadata_source_rows as
select jsonb_build_object(
 'routines',(select jsonb_agg(to_jsonb(r) order by id) from public.training_cycle_routines r where user_id in ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002')),
 'days',(select jsonb_agg(to_jsonb(d) order by id) from public.training_cycle_days d where user_id in ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002')),
 'exercises',(select jsonb_agg(to_jsonb(e) order by id) from public.training_cycle_exercises e where user_id in ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002'))
) as payload;
create temp table generated_metadata_before as select * from generated_metadata_source_rows;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select extensions.is(public.adapt_own_active_legacy_training_cycle(
 'a6000000-0000-4000-8000-000000000001','usuario','a2000000-0000-4000-8000-000000000001'
)->>'status','adapted','production Hipertrofia plus generated notes adapts');
select extensions.is(public.get_own_active_training_cycle('usuario')->>'goal','volume','Hipertrofia becomes canonical volume');
select extensions.is(public.get_own_active_training_cycle('usuario')->>'cycleId','a2000000-0000-4000-8000-000000000001','adaptation keeps cycle identity');
select extensions.is(public.get_own_active_training_cycle('usuario')->>'endDate','2026-09-28','four weeks derive an inclusive civil end date');
reset role;
select extensions.is((select payload from generated_metadata_source_rows),(select payload from generated_metadata_before),'original routines, days, exercises and metadata remain byte-for-byte unchanged');
set local role authenticated;
select extensions.is(jsonb_array_length(public.get_own_active_training_cycle('usuario')#>'{plan,days,0,exercises,0,sets}'),3,'original sets survive');
select extensions.is(public.adapt_own_active_legacy_training_cycle(
 'a6000000-0000-4000-8000-000000000001','usuario','a2000000-0000-4000-8000-000000000001'
)->>'status','already_canonical','retry cannot duplicate adaptation');
reset role;
select extensions.is((select goal from public.training_cycles where id='a2000000-0000-4000-8000-000000000001'),'Hipertrofia','original legacy goal is not rewritten');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select extensions.is(public.adapt_own_active_legacy_training_cycle(
 'a6000000-0000-4000-8000-000000000002','usuario','a2000000-0000-4000-8000-000000000002'
)->>'status','legacy_fallback','unknown exercise names do not acquire an invented muscle group');
reset role;
select extensions.ok(
 (select current_plan_version_id is null and status='active' from public.training_cycles where id='a2000000-0000-4000-8000-000000000002')
 and not exists(select 1 from public.training_custom_exercises where user_id='a1000000-0000-4000-8000-000000000002')
 and (select payload from generated_metadata_source_rows)=(select payload from generated_metadata_before),
 'unknown source remains untouched and creates no partial custom exercise'
);
select * from extensions.finish();
rollback;
