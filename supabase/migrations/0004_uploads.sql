-- Sherlock photo uploads for image searches: a private `media` bucket with per-user folders.
-- Safe to run on a database that already has 0001_v2.sql .. 0003_limits.sql, and safe to re-run.
-- Run once in the Supabase SQL editor (or `supabase db push`) BEFORE photo uploads can work.
-- (The code tolerates this migration not having run yet: the web app says "Photo upload is not
-- set up on this server yet" when Storage refuses the upload, and image search by URL keeps working.)
--
-- What it does
--   * bucket `media` : private (no public URLs), 8 MB per file, JPEG / PNG / WebP / GIF only
--   * policies on storage.objects for bucket `media`: a signed-in user may upload, read and delete
--     objects ONLY under `uploads/<their auth uid>/`. No update (uploads are never overwritten).
--     The gateway and workers use the service key, which bypasses these policies, to read a photo
--     for a search, sign a short-lived URL for search engines and delete it with its case.
--   * does nothing on plain Postgres (no `storage` schema).


-- ---------------------------------------------------------------- bucket and policies
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return;  -- plain Postgres: no Supabase Storage
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('media', 'media', false, 8000000, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "media uploads: insert own" on storage.objects';
  execute 'drop policy if exists "media uploads: select own" on storage.objects';
  execute 'drop policy if exists "media uploads: delete own" on storage.objects';

  execute $p$
    create policy "media uploads: insert own" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'uploads'
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and array_length(storage.foldername(name), 1) = 2
      )
  $p$;

  execute $p$
    create policy "media uploads: select own" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'uploads'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy "media uploads: delete own" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'uploads'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
  $p$;
end $$;
