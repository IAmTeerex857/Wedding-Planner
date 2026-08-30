create table public.honeymoon_checklist_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trip_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  due_date date,
  completed boolean not null default false,
  completed_at timestamptz,
  position integer not null default 0 check (position >= 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, trip_id) references public.honeymoon_trips(workspace_id, id) on delete cascade,
  check (completed or completed_at is null)
);

create index honeymoon_checklist_trip_idx
on public.honeymoon_checklist_items(trip_id, completed, position)
where deleted_at is null;

create trigger honeymoon_checklist_items_set_updated_at
before update on public.honeymoon_checklist_items
for each row execute function public.set_updated_at();

alter table public.honeymoon_checklist_items enable row level security;

create policy "honeymoon_checklist_items_workspace_all"
on public.honeymoon_checklist_items
for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
