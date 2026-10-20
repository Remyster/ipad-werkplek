-- iPad Werkplek v24: alles automatisch in de cloud (alle apparaten) + PDF-opslag.
-- Eenmalig uitvoeren in de Supabase SQL-editor. Veilig om opnieuw uit te voeren.

-- 1. Documenttabel: ook meetstatussen (form), mappen (meta) en verwijderd-markering.
alter table public.werkplek_documents drop constraint if exists werkplek_documents_kind_check;
alter table public.werkplek_documents add constraint werkplek_documents_kind_check check (kind in ('page','board','form','meta'));
alter table public.werkplek_documents add column if not exists deleted boolean not null default false;

-- 2. Servertijd bepaalt de volgorde (apparaten met een afwijkende klok overschrijven elkaar niet).
create or replace function public.werkplek_touch() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists werkplek_documents_touch on public.werkplek_documents;
create trigger werkplek_documents_touch before insert or update on public.werkplek_documents
  for each row execute function public.werkplek_touch();

-- 3. PDF-originelen: privé-bucket, alleen jij.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('werkplek-pdf', 'werkplek-pdf', false, 26214400, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['application/pdf'];

drop policy if exists werkplek_pdf_eigenaar on storage.objects;
create policy werkplek_pdf_eigenaar on storage.objects for all to authenticated
  using (bucket_id = 'werkplek-pdf' and auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid)
  with check (bucket_id = 'werkplek-pdf' and auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid);

-- Controle: moet 'form,meta,page,board' toestaan en 1 bucket tonen.
select (select count(*) from storage.buckets where id = 'werkplek-pdf') as pdf_bucket;
