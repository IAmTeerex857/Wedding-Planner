create or replace function public.execute_agent_food_drink_action(target_action_id uuid, requester_id uuid)
returns public.agent_actions
language plpgsql
security definer set search_path = ''
as $$
declare
  pending_action public.agent_actions%rowtype;
  resource_id uuid;
  normalized_service_type text;
  normalized_package_name text;
  normalized_notes text;
begin
  select * into pending_action from public.agent_actions where id = target_action_id for update;
  if pending_action.id is null then raise exception 'Agent action not found'; end if;
  if pending_action.status = 'executed' then return pending_action; end if;
  if pending_action.status <> 'approved' then raise exception 'Only approved actions can be executed'; end if;
  if pending_action.resource_type <> 'food_drink_plan' or pending_action.action_type <> 'create' then
    raise exception 'Unsupported food and drink action';
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = pending_action.workspace_id and profile_id = requester_id
  ) then raise exception 'Requesting member no longer has workspace access'; end if;
  if not exists (
    select 1 from public.ceremonies
    where id = (pending_action.payload ->> 'ceremony_id')::uuid
      and workspace_id = pending_action.workspace_id
  ) then raise exception 'Ceremony does not belong to this workspace'; end if;
  if nullif(pending_action.payload ->> 'vendor_id', '') is not null and not exists (
    select 1 from public.vendors
    where id = (pending_action.payload ->> 'vendor_id')::uuid
      and workspace_id = pending_action.workspace_id
  ) then raise exception 'Vendor does not belong to this workspace'; end if;

  normalized_service_type := case lower(replace(coalesce(pending_action.payload ->> 'service_type', 'combined'), '-', '_'))
    when 'food' then 'caterer'
    when 'catering' then 'caterer'
    when 'caterer' then 'caterer'
    when 'drink' then 'bartender'
    when 'drinks' then 'bartender'
    when 'wine' then 'bartender'
    when 'beverage' then 'bartender'
    when 'beverages' then 'bartender'
    when 'bar' then 'bartender'
    when 'bartender' then 'bartender'
    when 'service' then 'combined'
    when 'combined' then 'combined'
    when 'cake' then 'self_managed'
    when 'self_managed' then 'self_managed'
    else null
  end;
  if normalized_service_type is null then raise exception 'Food and drink service type is invalid'; end if;
  normalized_package_name := coalesce(nullif(pending_action.payload ->> 'package_name', ''), nullif(pending_action.payload ->> 'supplier', ''));
  if lower(coalesce(normalized_package_name, '')) = 'unspecified' then normalized_package_name := null; end if;
  normalized_notes := concat_ws(' · ',
    nullif(pending_action.payload ->> 'notes', ''),
    case when nullif(pending_action.payload ->> 'quantity', '') is not null then 'Quantity: ' || (pending_action.payload ->> 'quantity') end,
    case when nullif(pending_action.payload ->> 'supply_status', '') is not null then 'Supply status: ' || (pending_action.payload ->> 'supply_status') end,
    case when nullif(pending_action.payload ->> 'bartender_status', '') is not null then 'Bartender: ' || (pending_action.payload ->> 'bartender_status') end
  );

  insert into public.food_drink_plans (
    workspace_id, ceremony_id, vendor_id, name, service_type, package_name,
    package_price_minor, currency, guest_count, status, notes, created_by, updated_by
  ) values (
    pending_action.workspace_id,
    (pending_action.payload ->> 'ceremony_id')::uuid,
    nullif(pending_action.payload ->> 'vendor_id', '')::uuid,
    btrim(pending_action.payload ->> 'name'),
    normalized_service_type,
    normalized_package_name,
    coalesce(nullif(pending_action.payload ->> 'package_price_minor', ''), nullif(pending_action.payload ->> 'estimated_cost_minor', ''))::bigint,
    coalesce(nullif(pending_action.payload ->> 'currency', '')::public.currency_code, 'NGN'),
    nullif(pending_action.payload ->> 'guest_count', '')::integer,
    coalesce(nullif(pending_action.payload ->> 'status', ''), 'option'),
    nullif(normalized_notes, ''),
    requester_id,
    requester_id
  ) returning id into resource_id;

  update public.agent_actions
  set status = 'executed', executed_by = requester_id, execution_started_at = now(),
      executed_at = now(), execution_result = jsonb_build_object('resourceId', resource_id),
      execution_error = null, updated_at = now()
  where id = target_action_id returning * into pending_action;

  update public.agent_action_batches set
    status = case
      when exists (select 1 from public.agent_actions where batch_id = pending_action.batch_id and status = 'failed') then 'failed'
      when exists (select 1 from public.agent_actions where batch_id = pending_action.batch_id and status in ('approved', 'executing', 'proposed')) then 'executing'
      else 'completed'
    end,
    updated_at = now()
  where id = pending_action.batch_id;

  insert into public.agent_audit_logs (workspace_id, actor_id, action_id, event_type, details)
  values (pending_action.workspace_id, requester_id, pending_action.id, 'action_executed', jsonb_build_object('resource_id', resource_id));

  return pending_action;
end;
$$;

revoke all on function public.execute_agent_food_drink_action(uuid, uuid) from public, anon, authenticated;
grant execute on function public.execute_agent_food_drink_action(uuid, uuid) to service_role;
