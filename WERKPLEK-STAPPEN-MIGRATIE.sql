-- v29 (20 nov 2026, al uitgevoerd): stappenplannen van 🪓 Ontleden. Ook het geheugen voor de AI.
create table if not exists public.werkplek_stappen (
  id uuid primary key default gen_random_uuid(),
  task_id uuid,
  titel text not null check (char_length(titel) <= 300),
  invoer text not null default '' check (char_length(invoer) <= 4000),
  stappen jsonb not null default '[]'::jsonb,
  afgerond_op timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists werkplek_stappen_task on public.werkplek_stappen (task_id);
alter table public.werkplek_stappen enable row level security;
drop policy if exists eigenaar_only on public.werkplek_stappen;
create policy eigenaar_only on public.werkplek_stappen for all to authenticated
  using (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid)
  with check (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid);
