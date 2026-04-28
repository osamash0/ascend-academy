-- Migration: Create lecture_mind_maps table
-- Run this in your Supabase SQL editor

create table if not exists lecture_mind_maps (
  id           uuid primary key default gen_random_uuid(),
  lecture_id   uuid references lectures(id) on delete cascade not null unique,
  tree_data    jsonb not null,
  generated_at timestamptz default now()
);

alter table lecture_mind_maps enable row level security;

-- Professors can manage maps for their own lectures
create policy "professors can manage own maps"
  on lecture_mind_maps for all
  using (
    lecture_id in (select id from lectures where professor_id = auth.uid())
  );

-- Students (and anyone authenticated) can view maps
create policy "students can view maps"
  on lecture_mind_maps for select
  using (auth.uid() is not null);
