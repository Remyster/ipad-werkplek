-- v28 (18 nov 2026, al uitgevoerd): eigen wachtwoordkluis van de iPad Werkplek.
-- Los van de Kluis in de AI Hub. Er staat hier alleen versleutelde inhoud in:
-- de sleutel wordt op het apparaat afgeleid van je code en verlaat het apparaat nooit.
create table if not exists public.werkplek_kluis_meta (
  key text primary key check (char_length(key) <= 40),
  value text not null check (char_length(value) <= 4000),
  updated_at timestamptz not null default now()
);
create table if not exists public.werkplek_kluis_items (
  id uuid primary key default gen_random_uuid(),
  iv text not null check (char_length(iv) <= 64),
  ciphertext text not null check (char_length(ciphertext) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.werkplek_kluis_meta enable row level security;
alter table public.werkplek_kluis_items enable row level security;
drop policy if exists eigenaar_only on public.werkplek_kluis_meta;
drop policy if exists eigenaar_only on public.werkplek_kluis_items;
create policy eigenaar_only on public.werkplek_kluis_meta for all to authenticated
  using (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid)
  with check (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid);
create policy eigenaar_only on public.werkplek_kluis_items for all to authenticated
  using (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid)
  with check (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid);
