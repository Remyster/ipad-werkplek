-- v27: aparte privé-opslag voor Office-bestanden (pptx, docx, xlsx) bij Werkbeschrijvingen.
-- Zelfde afscherming als werkplek-pdf: alleen het account van Remy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('werkplek-bestanden', 'werkplek-bestanden', false, 83886080, array[
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'])
on conflict (id) do nothing;

drop policy if exists werkplek_bestanden_eigenaar on storage.objects;
create policy werkplek_bestanden_eigenaar on storage.objects for all to authenticated
  using (bucket_id = 'werkplek-bestanden' and auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid)
  with check (bucket_id = 'werkplek-bestanden' and auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid);
