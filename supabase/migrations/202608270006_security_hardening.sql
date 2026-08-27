drop policy if exists "members_add_owner" on public.workspace_members;
drop policy if exists "members_remove_owner" on public.workspace_members;

create or replace function public.assign_guests_to_table(target_table_id uuid, target_guest_ids uuid[])
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  target_table public.seating_tables%rowtype;
  current_count integer;
  incoming_count integer;
begin
  select * into target_table from public.seating_tables where id = target_table_id and deleted_at is null for update;
  if target_table.id is null or not public.is_workspace_member(target_table.workspace_id) then raise exception 'Table not found'; end if;
  if target_table.is_locked then raise exception 'This table is locked'; end if;
  if exists (select 1 from public.seating_assignments a join public.seating_tables t on t.id = a.table_id where a.ceremony_id = target_table.ceremony_id and a.guest_id = any(target_guest_ids) and a.deleted_at is null and t.is_locked and t.id <> target_table_id) then raise exception 'A selected guest is assigned to a locked table'; end if;
  select count(*) into current_count from public.seating_assignments where table_id = target_table_id and deleted_at is null and not (guest_id = any(target_guest_ids));
  select count(*) into incoming_count from unnest(target_guest_ids) guest_id;
  if current_count + incoming_count > target_table.capacity then raise exception 'Table capacity would be exceeded'; end if;
  update public.seating_assignments set table_id = target_table_id, deleted_at = null, updated_by = auth.uid(), updated_at = now() where ceremony_id = target_table.ceremony_id and guest_id = any(target_guest_ids);
  insert into public.seating_assignments (workspace_id, ceremony_id, table_id, guest_id, created_by, updated_by)
  select target_table.workspace_id, target_table.ceremony_id, target_table_id, requested.guest_id, auth.uid(), auth.uid()
  from unnest(target_guest_ids) as requested(guest_id)
  where not exists (select 1 from public.seating_assignments where ceremony_id = target_table.ceremony_id and seating_assignments.guest_id = requested.guest_id);
end;
$$;

revoke all on function public.assign_guests_to_table(uuid, uuid[]) from public;
grant execute on function public.assign_guests_to_table(uuid, uuid[]) to authenticated;

create or replace function public.unseat_guests(target_ceremony_id uuid, target_guest_ids uuid[])
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.ceremonies where id = target_ceremony_id and public.is_workspace_member(workspace_id)) then raise exception 'Ceremony not found'; end if;
  if exists (select 1 from public.seating_assignments a join public.seating_tables t on t.id = a.table_id where a.ceremony_id = target_ceremony_id and a.guest_id = any(target_guest_ids) and a.deleted_at is null and t.is_locked) then raise exception 'Unlock the table before removing guests'; end if;
  update public.seating_assignments set deleted_at = now(), updated_by = auth.uid(), updated_at = now() where ceremony_id = target_ceremony_id and guest_id = any(target_guest_ids) and deleted_at is null;
end;
$$;

revoke all on function public.unseat_guests(uuid, uuid[]) from public;
grant execute on function public.unseat_guests(uuid, uuid[]) to authenticated;

alter table public.notifications drop constraint if exists notifications_status_check;
alter table public.notifications add constraint notifications_status_check
check (status in ('pending', 'scheduled', 'processing', 'sent', 'read', 'failed', 'cancelled'));

create or replace function public.claim_due_notifications(batch_size integer default 100)
returns setof public.notifications
language sql
security definer set search_path = ''
as $$
  update public.notifications
  set status = 'processing', updated_at = now()
  where id in (
    select id from public.notifications
    where status in ('pending', 'scheduled')
      and scheduled_for <= now()
      and deleted_at is null
    order by scheduled_for
    for update skip locked
    limit greatest(1, least(batch_size, 500))
  )
  returning *;
$$;

revoke all on function public.claim_due_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_due_notifications(integer) to service_role;
