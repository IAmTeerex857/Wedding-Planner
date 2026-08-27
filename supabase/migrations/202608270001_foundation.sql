create extension if not exists pgcrypto;

create type public.ceremony_kind as enum ('court', 'traditional', 'white');
create type public.ceremony_status as enum ('tentative', 'confirmed', 'completed', 'cancelled');
create type public.task_status as enum ('todo', 'doing', 'done');
create type public.task_priority as enum ('very_low', 'low', 'medium', 'high', 'very_high');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  reporting_currency char(3) not null default 'NGN',
  timezone text not null default 'Africa/Lagos',
  weekly_summary_day smallint not null default 0 check (weekly_summary_day between 0 and 6),
  weekly_summary_time time not null default '18:00',
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'owner' check (role = 'owner'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, profile_id)
);

create table public.ceremonies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind public.ceremony_kind not null,
  name text not null,
  status public.ceremony_status not null default 'tentative',
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Africa/Lagos',
  location_name text,
  location_address text,
  guest_capacity integer check (guest_capacity is null or guest_capacity >= 0),
  budget_allocation_minor bigint check (budget_allocation_minor is null or budget_allocation_minor >= 0),
  notes text,
  cover_image_path text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, kind)
);

create table public.ceremony_segments (
  id uuid primary key default gen_random_uuid(),
  ceremony_id uuid not null references public.ceremonies(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  location_name text,
  location_address text,
  notes text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  description text,
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  assignee_name text,
  category text,
  due_at timestamptz,
  completed_at timestamptz,
  reminder_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.task_ceremonies (
  task_id uuid not null references public.tasks(id) on delete cascade,
  ceremony_id uuid not null references public.ceremonies(id) on delete cascade,
  primary key (task_id, ceremony_id)
);

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  label text not null,
  completed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ceremonies_workspace_idx on public.ceremonies(workspace_id) where deleted_at is null;
create index ceremony_segments_ceremony_idx on public.ceremony_segments(ceremony_id) where deleted_at is null;
create index tasks_workspace_status_idx on public.tasks(workspace_id, status) where deleted_at is null;
create index tasks_workspace_due_idx on public.tasks(workspace_id, due_at) where deleted_at is null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces
for each row execute function public.set_updated_at();
create trigger ceremonies_set_updated_at before update on public.ceremonies
for each row execute function public.set_updated_at();
create trigger ceremony_segments_set_updated_at before update on public.ceremony_segments
for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function public.set_updated_at();
create trigger task_checklist_items_set_updated_at before update on public.task_checklist_items
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and profile_id = auth.uid()
  );
$$;

create or replace function public.create_wedding_workspace(workspace_name text)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  new_workspace_id uuid;
  current_profile_id uuid := auth.uid();
begin
  if current_profile_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.workspaces (name, created_by, updated_by)
  values (workspace_name, current_profile_id, current_profile_id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, profile_id)
  values (new_workspace_id, current_profile_id);

  insert into public.ceremonies (workspace_id, kind, name, created_by, updated_by)
  values
    (new_workspace_id, 'court', 'Court Wedding', current_profile_id, current_profile_id),
    (new_workspace_id, 'traditional', 'Traditional Wedding', current_profile_id, current_profile_id),
    (new_workspace_id, 'white', 'White Wedding', current_profile_id, current_profile_id);

  return new_workspace_id;
end;
$$;

grant execute on function public.create_wedding_workspace(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.ceremonies enable row level security;
alter table public.ceremony_segments enable row level security;
alter table public.tasks enable row level security;
alter table public.task_ceremonies enable row level security;
alter table public.task_checklist_items enable row level security;

create policy "profiles_read_own" on public.profiles for select to authenticated
using (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy "members_read_workspace" on public.workspace_members for select to authenticated
using (public.is_workspace_member(workspace_id));
create policy "members_add_owner" on public.workspace_members for insert to authenticated
with check (public.is_workspace_member(workspace_id));
create policy "members_remove_owner" on public.workspace_members for delete to authenticated
using (public.is_workspace_member(workspace_id) and profile_id <> auth.uid());

create policy "workspaces_read" on public.workspaces for select to authenticated
using (public.is_workspace_member(id));
create policy "workspaces_update" on public.workspaces for update to authenticated
using (public.is_workspace_member(id)) with check (public.is_workspace_member(id));

create policy "ceremonies_all" on public.ceremonies for all to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "tasks_all" on public.tasks for all to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create policy "segments_all" on public.ceremony_segments for all to authenticated
using (
  exists (
    select 1 from public.ceremonies
    where ceremonies.id = ceremony_segments.ceremony_id
      and public.is_workspace_member(ceremonies.workspace_id)
  )
)
with check (
  exists (
    select 1 from public.ceremonies
    where ceremonies.id = ceremony_segments.ceremony_id
      and public.is_workspace_member(ceremonies.workspace_id)
  )
);

create policy "task_ceremonies_all" on public.task_ceremonies for all to authenticated
using (
  exists (
    select 1 from public.tasks
    where tasks.id = task_ceremonies.task_id
      and public.is_workspace_member(tasks.workspace_id)
  )
)
with check (
  exists (
    select 1 from public.tasks
    where tasks.id = task_ceremonies.task_id
      and public.is_workspace_member(tasks.workspace_id)
  )
);

create policy "checklist_items_all" on public.task_checklist_items for all to authenticated
using (
  exists (
    select 1 from public.tasks
    where tasks.id = task_checklist_items.task_id
      and public.is_workspace_member(tasks.workspace_id)
  )
)
with check (
  exists (
    select 1 from public.tasks
    where tasks.id = task_checklist_items.task_id
      and public.is_workspace_member(tasks.workspace_id)
  )
);
