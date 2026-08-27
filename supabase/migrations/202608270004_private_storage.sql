insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wedding-files',
  'wedding-files',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "workspace members read wedding files"
on storage.objects for select to authenticated
using (
  bucket_id = 'wedding-files'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

create policy "workspace members upload wedding files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'wedding-files'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

create policy "workspace members update wedding files"
on storage.objects for update to authenticated
using (
  bucket_id = 'wedding-files'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'wedding-files'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

create policy "workspace members delete wedding files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'wedding-files'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);
