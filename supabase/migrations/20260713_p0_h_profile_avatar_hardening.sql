-- P0-H: harden the private profile avatar contract.
--
-- Preconditions are intentionally strict. Apply to QA first and stop if any
-- drift is detected; this migration does not rewrite profile rows or objects.

begin;

do $$
declare
  v_bucket storage.buckets%rowtype;
  v_count bigint;
begin
  select *
  into v_bucket
  from storage.buckets
  where id = 'profile-avatars';

  if not found then
    raise exception 'P0-H: bucket profile-avatars does not exist';
  end if;

  if v_bucket.public then
    raise exception 'P0-H: bucket profile-avatars must remain private';
  end if;

  if v_bucket.file_size_limit is distinct from 2097152 then
    raise exception 'P0-H: unexpected profile-avatars file_size_limit: %', v_bucket.file_size_limit;
  end if;

  if v_bucket.allowed_mime_types is null
    or cardinality(v_bucket.allowed_mime_types) <> 3
    or not v_bucket.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']::text[]
    or not array['image/jpeg', 'image/png', 'image/webp']::text[] @> v_bucket.allowed_mime_types
  then
    raise exception 'P0-H: unexpected profile-avatars allowed_mime_types';
  end if;

  select count(*)
  into v_count
  from public.profiles p
  where p.avatar_path is not null
    and p.avatar_path <> p.id::text || '/avatar';

  if v_count <> 0 then
    raise exception 'P0-H: found % noncanonical profiles.avatar_path values', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  where o.bucket_id = 'profile-avatars'
    and o.name !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/avatar$';

  if v_count <> 0 then
    raise exception 'P0-H: found % noncanonical profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  left join public.profiles p
    on o.name = p.id::text || '/avatar'
  where o.bucket_id = 'profile-avatars'
    and p.id is null;

  if v_count <> 0 then
    raise exception 'P0-H: found % orphan profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from public.profiles p
  left join storage.objects o
    on o.bucket_id = 'profile-avatars'
   and o.name = p.avatar_path
  where p.avatar_path is not null
    and o.id is null;

  if v_count <> 0 then
    raise exception 'P0-H: found % broken profile avatar references', v_count;
  end if;
end;
$$;

do $$
declare
  v_constraint_expression text;
  v_normalized_expression text;
begin
  select pg_get_expr(c.conbin, c.conrelid, true)
  into v_constraint_expression
  from pg_constraint c
  where c.conrelid = 'public.profiles'::regclass
    and c.conname = 'profiles_avatar_path_canonical_check'
    and c.contype = 'c';

  if v_constraint_expression is null then
    if exists (
      select 1
      from pg_constraint c
      where c.conrelid = 'public.profiles'::regclass
        and c.conname = 'profiles_avatar_path_canonical_check'
    ) then
      raise exception 'P0-H: profiles_avatar_path_canonical_check exists but is not a CHECK constraint';
    end if;

    alter table public.profiles
      add constraint profiles_avatar_path_canonical_check
      check (
        avatar_path is null
        or avatar_path = id::text || '/avatar'
      ) not valid;
  else
    v_normalized_expression := replace(
      lower(regexp_replace(v_constraint_expression, '[[:space:]()]', '', 'g')),
      '::text',
      ''
    );

    if v_normalized_expression <> 'avatar_pathisnulloravatar_path=id||''/avatar''' then
      raise exception 'P0-H: profiles_avatar_path_canonical_check has an unexpected definition: %', v_constraint_expression;
    end if;
  end if;
end;
$$;

alter table public.profiles
  validate constraint profiles_avatar_path_canonical_check;

drop policy if exists "profile avatars own read" on storage.objects;
drop policy if exists "profile avatars own insert" on storage.objects;
drop policy if exists "profile avatars own update" on storage.objects;
drop policy if exists "profile avatars own delete" on storage.objects;

create policy "profile avatars own read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  );

create policy "profile avatars own insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  );

create policy "profile avatars own update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  )
  with check (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  );

create policy "profile avatars own delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and name = auth.uid()::text || '/avatar'
  );

do $$
declare
  v_count bigint;
  v_exact_policy_count integer;
  v_expected_expression constant text := 'bucket_id=''profile-avatars''andname=auth.uid||''/avatar''';
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.conname = 'profiles_avatar_path_canonical_check'
      and c.contype = 'c'
      and c.convalidated
  ) then
    raise exception 'P0-H: canonical avatar_path constraint is missing or not validated';
  end if;

  select count(*)
  into v_exact_policy_count
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and p.roles = array['authenticated']::name[]
    and (
      (
        p.policyname = 'profile avatars own read'
        and p.cmd = 'SELECT'
        and replace(lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
        and p.with_check is null
      )
      or (
        p.policyname = 'profile avatars own insert'
        and p.cmd = 'INSERT'
        and p.qual is null
        and replace(lower(regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
      )
      or (
        p.policyname = 'profile avatars own update'
        and p.cmd = 'UPDATE'
        and replace(lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
        and replace(lower(regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
      )
      or (
        p.policyname = 'profile avatars own delete'
        and p.cmd = 'DELETE'
        and replace(lower(regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g')), '::text', '') = v_expected_expression
        and p.with_check is null
      )
    );

  if v_exact_policy_count <> 4 then
    raise exception 'P0-H: expected 4 exact canonical avatar policies, found %', v_exact_policy_count;
  end if;

  select count(*)
  into v_count
  from public.profiles p
  where p.avatar_path is not null
    and p.avatar_path <> p.id::text || '/avatar';
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % noncanonical profiles.avatar_path values', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  where o.bucket_id = 'profile-avatars'
    and o.name !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/avatar$';
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % noncanonical profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from storage.objects o
  left join public.profiles p
    on o.name = p.id::text || '/avatar'
  where o.bucket_id = 'profile-avatars'
    and p.id is null;
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % orphan profile avatar objects', v_count;
  end if;

  select count(*)
  into v_count
  from public.profiles p
  left join storage.objects o
    on o.bucket_id = 'profile-avatars'
   and o.name = p.avatar_path
  where p.avatar_path is not null
    and o.id is null;
  if v_count <> 0 then
    raise exception 'P0-H postcheck: found % broken profile avatar references', v_count;
  end if;
end;
$$;

commit;

/*
Rollback P0-H - execute only with separate, explicit authorization.

begin;

alter table public.profiles
  drop constraint if exists profiles_avatar_path_canonical_check;

drop policy if exists "profile avatars own read" on storage.objects;
drop policy if exists "profile avatars own insert" on storage.objects;
drop policy if exists "profile avatars own update" on storage.objects;
drop policy if exists "profile avatars own delete" on storage.objects;

create policy "profile avatars own read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile avatars own insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile avatars own update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile avatars own delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

commit;
*/
