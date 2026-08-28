create table public.vendor_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  position integer not null default 0 check (position >= 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);

create unique index vendor_categories_workspace_name_uidx
on public.vendor_categories(workspace_id, lower(name))
where deleted_at is null;

create trigger vendor_categories_set_updated_at
before update on public.vendor_categories
for each row execute function public.set_updated_at();

alter table public.vendor_categories enable row level security;

create policy "vendor_categories_workspace_all"
on public.vendor_categories
for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

update public.vendors
set category = 'Food'
where lower(category) in ('catering', 'food');

insert into public.vendor_categories (workspace_id, name, position, created_by, updated_by)
select
  workspaces.id,
  defaults.name,
  (defaults.ordinality - 1)::integer,
  workspaces.created_by,
  workspaces.created_by
from public.workspaces
cross join unnest(array[
  'Hall', 'Cars', 'Hotels', 'Tailor', 'Food', 'Drinks', 'Photography',
  'Videography', 'Decor', 'Entertainment', 'Beauty', 'Cake', 'Invitations',
  'Security', 'Rentals', 'Gifts', 'Other'
]::text[]) with ordinality as defaults(name, ordinality)
where workspaces.deleted_at is null;

insert into public.vendor_categories (workspace_id, name, position, created_by, updated_by)
select
  vendors.workspace_id,
  min(vendors.category),
  100 + row_number() over (partition by vendors.workspace_id order by lower(vendors.category)),
  workspaces.created_by,
  workspaces.created_by
from public.vendors
join public.workspaces on workspaces.id = vendors.workspace_id
where vendors.deleted_at is null
  and not exists (
    select 1
    from public.vendor_categories
    where vendor_categories.workspace_id = vendors.workspace_id
      and lower(vendor_categories.name) = lower(vendors.category)
      and vendor_categories.deleted_at is null
  )
group by vendors.workspace_id, lower(vendors.category), workspaces.created_by;

create or replace function public.seed_vendor_categories_for_workspace()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.vendor_categories (workspace_id, name, position, created_by, updated_by)
  select
    new.id,
    defaults.name,
    (defaults.ordinality - 1)::integer,
    new.created_by,
    new.created_by
  from unnest(array[
    'Hall', 'Cars', 'Hotels', 'Tailor', 'Food', 'Drinks', 'Photography',
    'Videography', 'Decor', 'Entertainment', 'Beauty', 'Cake', 'Invitations',
    'Security', 'Rentals', 'Gifts', 'Other'
  ]::text[]) with ordinality as defaults(name, ordinality);

  return new;
end;
$$;

create trigger workspaces_seed_vendor_categories
after insert on public.workspaces
for each row execute function public.seed_vendor_categories_for_workspace();

create or replace function public.guard_vendor_category_removal()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' or new.deleted_at is not null) and exists (
    select 1
    from public.vendors
    where vendors.workspace_id = old.workspace_id
      and lower(vendors.category) = lower(old.name)
      and vendors.deleted_at is null
  ) then
    raise exception 'Reassign vendors in the % category before removing it.', old.name;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger vendor_categories_guard_removal
before update of deleted_at or delete on public.vendor_categories
for each row execute function public.guard_vendor_category_removal();
