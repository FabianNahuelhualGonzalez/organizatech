alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own read'
  ) then
    create policy "profile avatars own read"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own insert'
  ) then
    create policy "profile avatars own insert"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own update'
  ) then
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
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile avatars own delete'
  ) then
    create policy "profile avatars own delete"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'profile-avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$;
