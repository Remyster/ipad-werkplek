-- iPad Werkplek: notities bewaren in WerkHub (Supabase-project mdslvdrsggpksqrbtwci).
-- Eenmalig uitvoeren in de Supabase SQL-editor. Veilig om opnieuw uit te voeren.
-- Raakt geen bestaande tabellen of policies. Alleen de eigenaar (zelfde uid als de
-- andere WerkHub-tabellen) kan lezen en schrijven.

create table if not exists public.werkplek_documents (
  id text primary key,                         -- document-id uit de Werkplek-app
  title text not null default '',
  kind text not null default 'page' check (kind in ('page', 'board')),
  folder_title text,                           -- naam van de werkmap, zodat die op een ander apparaat terugkomt
  data jsonb not null,                         -- document met penstreken en tekstblokken (zonder PDF-bestanden)
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists werkplek_documents_updated_idx
  on public.werkplek_documents (updated_at desc);

alter table public.werkplek_documents enable row level security;

drop policy if exists eigenaar_only on public.werkplek_documents;
create policy eigenaar_only on public.werkplek_documents for all to authenticated
  using (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid)
  with check (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid);

-- Controle: moet 0 teruggeven bij een lege tabel.
select count(*) from public.werkplek_documents;
