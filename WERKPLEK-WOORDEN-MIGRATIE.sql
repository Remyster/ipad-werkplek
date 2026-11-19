-- v28.1 (19 nov 2026, al uitgevoerd): moeilijke-woordenlijst van de iPad Werkplek in de cloud,
-- zodat hij niet meer verdwijnt als het apparaat zijn opslag leegmaakt en op elk apparaat hetzelfde is.
create table if not exists public.werkplek_woorden (
  woord_key text primary key check (char_length(woord_key) <= 80),
  woord text not null check (char_length(woord) <= 80),
  uitleg text not null check (char_length(uitleg) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.werkplek_woorden enable row level security;
drop policy if exists eigenaar_only on public.werkplek_woorden;
create policy eigenaar_only on public.werkplek_woorden for all to authenticated
  using (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid)
  with check (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid);
