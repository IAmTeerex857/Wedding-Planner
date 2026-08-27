create or replace function public.add_workspace_owner_by_email(target_workspace_id uuid, owner_email text)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  target_profile_id uuid;
  owner_count integer;
begin
  if not public.is_workspace_member(target_workspace_id) then
    raise exception 'You do not have access to this workspace';
  end if;

  select id into target_profile_id
  from auth.users
  where lower(email) = lower(btrim(owner_email));

  if target_profile_id is null then
    raise exception 'No confirmed account exists for that email';
  end if;

  if exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and profile_id = target_profile_id
  ) then
    return target_profile_id;
  end if;

  select count(*) into owner_count
  from public.workspace_members
  where workspace_id = target_workspace_id;

  if owner_count >= 2 then
    raise exception 'This workspace already has two owners';
  end if;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (target_workspace_id, target_profile_id, 'owner');

  return target_profile_id;
end;
$$;

revoke all on function public.add_workspace_owner_by_email(uuid, text) from public;
grant execute on function public.add_workspace_owner_by_email(uuid, text) to authenticated;
