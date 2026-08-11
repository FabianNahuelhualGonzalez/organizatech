-- Fase 2.2AW-SQL - Patch candidato QA para persistencia cycle-scoped pura.
-- CANDIDATA LOCAL: no aplicar sin autorizacion explicita.
-- Objetivo:
-- - Permitir exercise_entries sin exercise_id legacy cuando existe training_cycle_exercise_id.
-- - Mantener compatibilidad legacy para entries con exercise_id.
-- - Evitar mezcla artificial entre legacy y cycle-scoped.
-- - Reemplazar la RPC de guardado de sesiones cycle-scoped sin tocar Production.

alter table public.exercise_entries
  alter column exercise_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'exercise_entries_exercise_or_cycle_exercise_check'
      and conrelid = 'public.exercise_entries'::regclass
  ) then
    alter table public.exercise_entries
      add constraint exercise_entries_exercise_or_cycle_exercise_check
      check (
        exercise_id is not null
        or training_cycle_exercise_id is not null
      );
  end if;
end $$;

drop policy if exists "entries own rows" on public.exercise_entries;
create policy "entries own rows" on public.exercise_entries
  for all
  to authenticated
  using (
    auth.uid() = exercise_entries.user_id
    and exists (
      select 1
      from public.training_sessions s
      where s.id = exercise_entries.session_id
        and s.user_id = auth.uid()
        and (
          (
            s.cycle_id is null
            and s.cycle_day_id is null
            and exercise_entries.training_cycle_exercise_id is null
            and exercise_entries.exercise_id is not null
            and exists (
              select 1
              from public.exercises e
              where e.id = exercise_entries.exercise_id
                and e.user_id = auth.uid()
            )
          )
          or
          (
            s.cycle_id is not null
            and s.cycle_day_id is not null
            and exercise_entries.training_cycle_exercise_id is not null
            and exists (
              select 1
              from public.training_cycle_exercises tce
              where tce.id = exercise_entries.training_cycle_exercise_id
                and tce.user_id = auth.uid()
                and tce.cycle_id = s.cycle_id
                and tce.day_id = s.cycle_day_id
                and tce.deleted_at is null
                and (
                  exercise_entries.exercise_id is null
                  or (
                    tce.source_legacy_exercise_id = exercise_entries.exercise_id
                    and exists (
                      select 1
                      from public.exercises e
                      where e.id = exercise_entries.exercise_id
                        and e.user_id = auth.uid()
                    )
                  )
                )
            )
          )
        )
    )
  )
  with check (
    auth.uid() = exercise_entries.user_id
    and exists (
      select 1
      from public.training_sessions s
      where s.id = exercise_entries.session_id
        and s.user_id = auth.uid()
        and (
          (
            s.cycle_id is null
            and s.cycle_day_id is null
            and exercise_entries.training_cycle_exercise_id is null
            and exercise_entries.exercise_id is not null
            and exists (
              select 1
              from public.exercises e
              where e.id = exercise_entries.exercise_id
                and e.user_id = auth.uid()
            )
          )
          or
          (
            s.cycle_id is not null
            and s.cycle_day_id is not null
            and exercise_entries.training_cycle_exercise_id is not null
            and exists (
              select 1
              from public.training_cycle_exercises tce
              where tce.id = exercise_entries.training_cycle_exercise_id
                and tce.user_id = auth.uid()
                and tce.cycle_id = s.cycle_id
                and tce.day_id = s.cycle_day_id
                and tce.deleted_at is null
                and (
                  exercise_entries.exercise_id is null
                  or (
                    tce.source_legacy_exercise_id = exercise_entries.exercise_id
                    and exists (
                      select 1
                      from public.exercises e
                      where e.id = exercise_entries.exercise_id
                        and e.user_id = auth.uid()
                    )
                  )
                )
            )
          )
        )
    )
  );

create or replace function public.create_training_session_with_cycle_entries(
  p_cycle_id uuid,
  p_cycle_day_id uuid,
  p_planned_day text,
  p_planned_date date,
  p_trained_date date,
  p_status text,
  p_week_number integer,
  p_notes text,
  p_entries jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_entry jsonb;
  v_cycle_exercise_id uuid;
  v_legacy_exercise_id uuid;
  v_reps jsonb;
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_cycle_id is null then
    raise exception 'El ciclo es obligatorio';
  end if;

  if p_cycle_day_id is null then
    raise exception 'El dia del ciclo es obligatorio';
  end if;

  if p_trained_date is null then
    raise exception 'La fecha real de entrenamiento es obligatoria';
  end if;

  if p_status not in ('completed', 'skipped') then
    raise exception 'Estado de entrenamiento invalido';
  end if;

  if p_planned_day is not null and p_planned_day not in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') then
    raise exception 'Dia planificado invalido';
  end if;

  if jsonb_typeof(v_entries) <> 'array' then
    raise exception 'La lista de ejercicios debe ser un arreglo JSON';
  end if;

  if p_status = 'completed' and jsonb_array_length(v_entries) = 0 then
    raise exception 'Un entrenamiento completado requiere ejercicios';
  end if;

  if not exists (
    select 1
    from public.training_cycles c
    where c.id = p_cycle_id
      and c.user_id = v_user_id
      and c.status = 'active'
      and c.deleted_at is null
  ) then
    raise exception 'El ciclo no existe, no esta activo o no pertenece al usuario';
  end if;

  if not exists (
    select 1
    from public.training_cycle_days d
    where d.id = p_cycle_day_id
      and d.cycle_id = p_cycle_id
      and d.user_id = v_user_id
      and d.deleted_at is null
      and (p_planned_day is null or d.day_code = p_planned_day)
  ) then
    raise exception 'El dia no pertenece al ciclo del usuario o no corresponde al dia planificado';
  end if;

  insert into public.training_sessions (
    user_id,
    cycle_id,
    cycle_day_id,
    week_number,
    trained_at,
    calendar_week_start,
    planned_day,
    planned_date,
    trained_date,
    status,
    completed_at,
    notes
  )
  values (
    v_user_id,
    p_cycle_id,
    p_cycle_day_id,
    coalesce(p_week_number, 1),
    p_trained_date,
    p_trained_date - (extract(isodow from p_trained_date)::integer - 1),
    p_planned_day,
    p_planned_date,
    p_trained_date,
    p_status,
    case when p_status = 'completed' then now() else null end,
    p_notes
  )
  returning id into v_session_id;

  if p_status = 'completed' then
    for v_entry in select * from jsonb_array_elements(v_entries)
    loop
      if nullif(v_entry->>'training_cycle_exercise_id', '') is null then
        raise exception 'Cada entry requiere training_cycle_exercise_id';
      end if;

      v_cycle_exercise_id := (v_entry->>'training_cycle_exercise_id')::uuid;
      v_legacy_exercise_id := nullif(v_entry->>'exercise_id', '')::uuid;

      if v_legacy_exercise_id is not null and not exists (
        select 1
        from public.exercises e
        where e.id = v_legacy_exercise_id
          and e.user_id = v_user_id
      ) then
        raise exception 'El ejercicio legacy no pertenece al usuario';
      end if;

      if not exists (
        select 1
        from public.training_cycle_exercises tce
        where tce.id = v_cycle_exercise_id
          and tce.user_id = v_user_id
          and tce.cycle_id = p_cycle_id
          and tce.day_id = p_cycle_day_id
          and tce.deleted_at is null
          and (
            v_legacy_exercise_id is null
            or tce.source_legacy_exercise_id = v_legacy_exercise_id
          )
      ) then
        raise exception 'El ejercicio planificado no pertenece al ciclo/dia del usuario o no corresponde al ejercicio legacy informado';
      end if;

      v_reps := v_entry->'reps';
      if v_reps is null or jsonb_typeof(v_reps) <> 'array' or jsonb_array_length(v_reps) = 0 then
        raise exception 'Cada entry requiere reps como arreglo no vacio';
      end if;

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
      values (
        coalesce(nullif(v_entry->>'id', '')::uuid, gen_random_uuid()),
        v_user_id,
        v_session_id,
        v_legacy_exercise_id,
        v_cycle_exercise_id,
        coalesce((v_entry->>'weight')::numeric, 0),
        coalesce((v_entry->>'previous_weight')::numeric, 0),
        array(select rep_value::integer from jsonb_array_elements_text(v_reps) as reps(rep_value)),
        nullif(v_entry->>'rir', ''),
        nullif(v_entry->>'notes', '')
      );
    end loop;
  end if;

  return v_session_id;
end;
$$;

grant execute on function public.create_training_session_with_cycle_entries(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  integer,
  text,
  jsonb
) to authenticated;

-- Rollback QA sugerido, no ejecutar sin autorizacion:
-- 1. Apagar feature flag QA.
-- 2. Preservar evidencia de sesiones/entries creadas por la prueba.
-- 3. Si existen exercise_entries con exercise_id null, no se puede restaurar NOT NULL
--    sin limpiar o corregir esos datos QA con autorizacion explicita.
-- 4. Dropear la constraint nueva si se vuelve al contrato anterior:
--    alter table public.exercise_entries
--      drop constraint if exists exercise_entries_exercise_or_cycle_exercise_check;
-- 5. Reinstalar la version previa de public.create_training_session_with_cycle_entries
--    desde 20260604_training_cycle_scoped_model.sql si se requiere volver al contrato anterior.
-- 6. Reinstalar la policy "entries own rows" previa si se requiere volver al contrato legacy estricto.
