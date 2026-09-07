-- I Do AI schema, flexible ceremonies, and planner workspace access.

-- Ceremony kinds are user-defined labels. Preserve every existing enum value and
-- allow more than one ceremony of the same kind in a workspace.
alter table public.ceremonies
  drop constraint if exists ceremonies_workspace_id_kind_key;

alter table public.ceremonies
  alter column kind type text using kind::text;

alter table public.ceremonies
  add constraint ceremonies_kind_check
  check (char_length(btrim(kind)) between 1 and 80);

do $$
begin
  while exists (
    select 1 from public.ceremonies where deleted_at is null
    group by workspace_id, lower(btrim(name)) having count(*) > 1
  ) loop
    with duplicate_names as (
      select id, row_number() over (partition by workspace_id, lower(btrim(name)) order by created_at, id) as duplicate_number
      from public.ceremonies where deleted_at is null
    )
    update public.ceremonies
    set name = public.ceremonies.name || ' [' || public.ceremonies.id || ']'
    from duplicate_names
    where public.ceremonies.id = duplicate_names.id and duplicate_names.duplicate_number > 1;
  end loop;
end;
$$;

create unique index ceremonies_workspace_name_uidx
on public.ceremonies(workspace_id, lower(btrim(name)))
where deleted_at is null;

-- These validators previously encoded the original three ceremony kinds. Keep
-- their relationship and workspace checks without restricting custom ceremonies.
create or replace function public.validate_traditional_requirement_ceremony()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.ceremonies
    where id = new.ceremony_id
      and workspace_id = new.workspace_id
  ) then
    raise exception 'Ceremony must belong to the requirement workspace';
  end if;
  return new;
end;
$$;

create or replace function public.validate_seating_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.seating_tables
    where id = new.table_id
      and ceremony_id = new.ceremony_id
      and workspace_id = new.workspace_id
  ) then
    raise exception 'Seating table must belong to the assignment ceremony and workspace';
  end if;

  if new.seat_id is not null and not exists (
    select 1
    from public.seating_seats
    where id = new.seat_id
      and table_id = new.table_id
      and workspace_id = new.workspace_id
      and deleted_at is null
  ) then
    raise exception 'Seat must belong to the assignment table and workspace';
  end if;

  return new;
end;
$$;

create or replace function public.validate_seating_table_ceremony()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.ceremonies
    where id = new.ceremony_id
      and workspace_id = new.workspace_id
  ) then
    raise exception 'Ceremony must belong to the seating table workspace';
  end if;
  return new;
end;
$$;

drop type public.ceremony_kind;

-- Owners control workspace access. Planners retain the existing member-level
-- access to all planning data, but cannot change workspace or membership data.
alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check check (role in ('owner', 'planner'));

create or replace function public.is_workspace_owner(target_workspace_id uuid)
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
      and role = 'owner'
  );
$$;

revoke all on function public.is_workspace_owner(uuid) from public;
grant execute on function public.is_workspace_owner(uuid) to authenticated;

create or replace function public.guard_last_workspace_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner'
    and (tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.role <> 'owner'))
    and not exists (
      select 1
      from public.workspace_members
      where workspace_id = old.workspace_id
        and profile_id <> old.profile_id
        and role = 'owner'
    )
  then
    raise exception 'A workspace must retain at least one owner';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger workspace_members_guard_last_owner
before update of role or delete on public.workspace_members
for each row execute function public.guard_last_workspace_owner();

drop policy if exists "members_read_workspace" on public.workspace_members;
create policy "members_read_workspace"
on public.workspace_members for select to authenticated
using (profile_id = auth.uid() or public.is_workspace_owner(workspace_id));

revoke insert, update, delete on public.workspace_members from authenticated;

drop policy if exists "workspaces_update" on public.workspaces;
create policy "workspaces_update"
on public.workspaces for update to authenticated
using (public.is_workspace_owner(id))
with check (public.is_workspace_owner(id));

create or replace function public.add_workspace_owner_by_email(target_workspace_id uuid, owner_email text)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  target_profile_id uuid;
  owner_count integer;
begin
  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'Only a workspace owner can add another owner';
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
  where workspace_id = target_workspace_id and role = 'owner';

  if owner_count >= 2 then
    raise exception 'This workspace already has two owners';
  end if;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (target_workspace_id, target_profile_id, 'owner');
  return target_profile_id;
end;
$$;

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (char_length(btrim(email)) between 3 and 320),
  role text not null default 'planner' check (role = 'planner'),
  token_hash bytea not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  invited_by uuid not null references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (expires_at > created_at),
  check ((status = 'accepted') = (accepted_by is not null and accepted_at is not null))
);

create unique index workspace_invitations_pending_email_uidx
on public.workspace_invitations(workspace_id, lower(btrim(email)))
where status = 'pending';

create index workspace_invitations_workspace_status_idx
on public.workspace_invitations(workspace_id, status, created_at desc);

create trigger workspace_invitations_set_updated_at
before update on public.workspace_invitations
for each row execute function public.set_updated_at();

alter table public.workspace_invitations enable row level security;

create policy "owners_read_workspace_invitations"
on public.workspace_invitations for select to authenticated
using (public.is_workspace_owner(workspace_id));

create or replace function public.create_workspace_planner_invitation(
  target_workspace_id uuid,
  invitee_email text,
  valid_for interval default interval '7 days'
)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  invitation_token text;
  normalized_email text := lower(btrim(invitee_email));
begin
  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'Only a workspace owner can invite planners';
  end if;
  if char_length(normalized_email) not between 3 and 320 then
    raise exception 'A valid email address is required';
  end if;
  if valid_for is null or valid_for <= interval '0 seconds' or valid_for > interval '30 days' then
    raise exception 'Invitation validity must be between zero and 30 days';
  end if;

  update public.workspace_invitations
  set status = 'revoked', updated_at = now()
  where workspace_id = target_workspace_id
    and lower(btrim(email)) = normalized_email
    and status = 'pending';

  invitation_token := encode(gen_random_bytes(32), 'hex');
  insert into public.workspace_invitations (
    workspace_id, email, token_hash, expires_at, invited_by
  ) values (
    target_workspace_id,
    normalized_email,
    digest(convert_to(invitation_token, 'UTF8'), 'sha256'),
    now() + valid_for,
    auth.uid()
  );

  return invitation_token;
end;
$$;

create or replace function public.accept_workspace_planner_invitation(invitation_token text)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  invitation public.workspace_invitations%rowtype;
  current_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select lower(email) into current_email from auth.users where id = auth.uid();
  select * into invitation
  from public.workspace_invitations
  where token_hash = digest(convert_to(invitation_token, 'UTF8'), 'sha256')
  for update;

  if invitation.id is null or invitation.status <> 'pending' then
    raise exception 'Invitation is invalid or no longer available';
  end if;
  if invitation.expires_at <= now() then
    update public.workspace_invitations set status = 'expired' where id = invitation.id;
    raise exception 'Invitation has expired';
  end if;
  if current_email is null or current_email <> lower(btrim(invitation.email)) then
    raise exception 'Invitation email does not match the signed-in account';
  end if;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (invitation.workspace_id, auth.uid(), 'planner')
  on conflict (workspace_id, profile_id) do nothing;

  update public.workspace_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now(), updated_at = now()
  where id = invitation.id;

  return invitation.workspace_id;
end;
$$;

create or replace function public.revoke_workspace_planner_invitation(invitation_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  target_workspace_id uuid;
begin
  select workspace_id into target_workspace_id
  from public.workspace_invitations
  where id = invitation_id and status = 'pending';

  if target_workspace_id is null or not public.is_workspace_owner(target_workspace_id) then
    raise exception 'Invitation not found';
  end if;

  update public.workspace_invitations
  set status = 'revoked', updated_at = now()
  where id = invitation_id;
end;
$$;

create or replace function public.remove_workspace_planner(target_workspace_id uuid, planner_profile_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'Only a workspace owner can remove planners';
  end if;

  delete from public.workspace_members
  where workspace_id = target_workspace_id
    and profile_id = planner_profile_id
    and role = 'planner';

  if not found then
    raise exception 'Planner membership not found';
  end if;
end;
$$;

revoke all on function public.create_workspace_planner_invitation(uuid, text, interval) from public;
revoke all on function public.accept_workspace_planner_invitation(text) from public;
revoke all on function public.revoke_workspace_planner_invitation(uuid) from public;
revoke all on function public.remove_workspace_planner(uuid, uuid) from public;
grant execute on function public.create_workspace_planner_invitation(uuid, text, interval) to authenticated;
grant execute on function public.accept_workspace_planner_invitation(text) to authenticated;
grant execute on function public.revoke_workspace_planner_invitation(uuid) to authenticated;
grant execute on function public.remove_workspace_planner(uuid, uuid) to authenticated;
revoke insert, update, delete on public.workspace_invitations from authenticated;

-- Agent conversations and service-produced runs/messages.
create table public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(btrim(title)) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  model text,
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  output jsonb check (output is null or jsonb_typeof(output) = 'object'),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, conversation_id) references public.agent_conversations(workspace_id, id) on delete cascade,
  check (completed_at is null or started_at is null or completed_at >= started_at)
);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  run_id uuid,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null check (char_length(content) > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, conversation_id) references public.agent_conversations(workspace_id, id) on delete cascade,
  foreign key (workspace_id, run_id) references public.agent_runs(workspace_id, id)
);

create table public.agent_planning_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  onboarding_status text not null default 'not_started' check (onboarding_status in ('not_started', 'in_progress', 'completed')),
  wedding_date date,
  priorities jsonb not null default '[]'::jsonb check (jsonb_typeof(priorities) = 'array'),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  constraints jsonb not null default '{}'::jsonb check (jsonb_typeof(constraints) = 'object'),
  onboarding_answers jsonb not null default '{}'::jsonb check (jsonb_typeof(onboarding_answers) = 'object'),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id),
  unique (workspace_id, id)
);

create table public.agent_action_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid,
  run_id uuid,
  source_ref text,
  summary text not null check (char_length(btrim(summary)) between 1 and 500),
  status text not null default 'proposed' check (status in ('proposed', 'partially_approved', 'approved', 'executing', 'completed', 'failed', 'rejected', 'cancelled')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, conversation_id) references public.agent_conversations(workspace_id, id),
  foreign key (workspace_id, run_id) references public.agent_runs(workspace_id, id)
);

create unique index agent_action_batches_source_uidx
on public.agent_action_batches(workspace_id, source_ref)
where source_ref is not null;

create table public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid not null,
  position integer not null default 0 check (position >= 0),
  action_type text not null check (action_type in ('create', 'update', 'archive', 'restore')),
  resource_type text not null check (resource_type in (
    'ceremony', 'ceremony_segment', 'task', 'guest', 'guest_invitation', 'budget', 'budget_allocation',
    'vendor', 'vendor_quote', 'vendor_appointment', 'expense', 'payment_schedule', 'venue',
    'food_drink_plan', 'attire', 'traditional_requirement', 'seating_table', 'itinerary_item',
    'calendar_entry', 'packing_item', 'gift', 'honeymoon_trip', 'honeymoon_booking',
    'vendor_research'
  )),
  target_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  rationale text,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'executing', 'executed', 'failed', 'cancelled')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  executed_by uuid references public.profiles(id),
  execution_started_at timestamptz,
  executed_at timestamptz,
  execution_result jsonb check (execution_result is null or jsonb_typeof(execution_result) = 'object'),
  execution_error text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (batch_id, position),
  foreign key (workspace_id, batch_id) references public.agent_action_batches(workspace_id, id) on delete cascade,
  check ((approved_by is null and approved_at is null) or (approved_by is not null and approved_at is not null)),
  check (action_type = 'create' or target_id is not null)
);

create or replace function public.guard_agent_action_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.agent_action_batches
    where id = new.batch_id and workspace_id = new.workspace_id and status = 'proposed'
    for key share
  ) then
    raise exception 'Actions can only be added to a proposed batch';
  end if;
  return new;
end;
$$;

create trigger agent_actions_guard_insert
before insert on public.agent_actions
for each row execute function public.guard_agent_action_insert();

create table public.vendor_research_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text not null,
  website text,
  location text,
  contact_details jsonb not null default '{}'::jsonb check (jsonb_typeof(contact_details) = 'object'),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'shortlisted', 'dismissed', 'converted')),
  converted_vendor_id uuid,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, run_id) references public.agent_runs(workspace_id, id),
  foreign key (workspace_id, converted_vendor_id) references public.vendors(workspace_id, id)
);

create table public.agent_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid,
  source_ref text,
  suggestion_type text not null,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  body text not null,
  priority public.task_priority not null default 'medium',
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed', 'completed')),
  related_table text,
  related_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, source_ref),
  foreign key (workspace_id, run_id) references public.agent_runs(workspace_id, id),
  check ((related_table is null) = (related_id is null))
);

create table public.agent_audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  run_id uuid,
  action_id uuid,
  event_type text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, run_id) references public.agent_runs(workspace_id, id),
  foreign key (workspace_id, action_id) references public.agent_actions(workspace_id, id)
);

create index agent_conversations_workspace_updated_idx on public.agent_conversations(workspace_id, updated_at desc) where deleted_at is null;
create index agent_runs_conversation_created_idx on public.agent_runs(conversation_id, created_at desc);
create index agent_messages_conversation_created_idx on public.agent_messages(conversation_id, created_at);
create index agent_action_batches_workspace_status_idx on public.agent_action_batches(workspace_id, status, created_at desc);
create index agent_actions_batch_status_idx on public.agent_actions(batch_id, status, position);
create index vendor_research_candidates_workspace_review_idx on public.vendor_research_candidates(workspace_id, review_status) where deleted_at is null;
create index agent_suggestions_workspace_status_idx on public.agent_suggestions(workspace_id, status, created_at desc) where deleted_at is null;
create index agent_audit_logs_workspace_created_idx on public.agent_audit_logs(workspace_id, created_at desc);

create trigger agent_conversations_set_updated_at before update on public.agent_conversations
for each row execute function public.set_updated_at();
create trigger agent_runs_set_updated_at before update on public.agent_runs
for each row execute function public.set_updated_at();
create trigger agent_planning_profiles_set_updated_at before update on public.agent_planning_profiles
for each row execute function public.set_updated_at();
create trigger agent_action_batches_set_updated_at before update on public.agent_action_batches
for each row execute function public.set_updated_at();
create trigger agent_actions_set_updated_at before update on public.agent_actions
for each row execute function public.set_updated_at();
create trigger vendor_research_candidates_set_updated_at before update on public.vendor_research_candidates
for each row execute function public.set_updated_at();
create trigger agent_suggestions_set_updated_at before update on public.agent_suggestions
for each row execute function public.set_updated_at();

alter table public.agent_conversations enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_planning_profiles enable row level security;
alter table public.agent_action_batches enable row level security;
alter table public.agent_actions enable row level security;
alter table public.vendor_research_candidates enable row level security;
alter table public.agent_suggestions enable row level security;
alter table public.agent_audit_logs enable row level security;

create policy "agent_conversations_workspace_all" on public.agent_conversations
for all to authenticated using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "agent_planning_profiles_workspace_all" on public.agent_planning_profiles
for all to authenticated using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "vendor_research_candidates_workspace_all" on public.vendor_research_candidates
for all to authenticated using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "agent_suggestions_workspace_all" on public.agent_suggestions
for all to authenticated using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "agent_messages_workspace_read" on public.agent_messages
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "agent_messages_workspace_user_insert" on public.agent_messages
for insert to authenticated with check (
  public.is_workspace_member(workspace_id)
  and role = 'user'
  and created_by = auth.uid()
);

create policy "agent_runs_workspace_read" on public.agent_runs
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "agent_action_batches_workspace_read" on public.agent_action_batches
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "agent_actions_workspace_read" on public.agent_actions
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "agent_audit_logs_workspace_read" on public.agent_audit_logs
for select to authenticated using (public.is_workspace_member(workspace_id));

-- Approval is explicit and member-scoped. Execution is recorded separately by a
-- trusted worker; neither function interprets resource names or executes SQL.
create or replace function public.review_agent_action(target_action_id uuid, approve boolean)
returns public.agent_actions
language plpgsql
security definer set search_path = ''
as $$
declare
  reviewed_action public.agent_actions%rowtype;
  new_batch_status text;
begin
  if approve is null then
    raise exception 'An approval decision is required';
  end if;

  select * into reviewed_action
  from public.agent_actions
  where id = target_action_id
  for update;

  if reviewed_action.id is null or not public.is_workspace_member(reviewed_action.workspace_id) then
    raise exception 'Agent action not found';
  end if;
  if reviewed_action.status <> 'proposed' then
    raise exception 'Only proposed actions can be reviewed';
  end if;

  update public.agent_actions
  set status = case when approve then 'approved' else 'rejected' end,
      approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = target_action_id
  returning * into reviewed_action;

  select case
    when bool_and(status = 'approved') then 'approved'
    when bool_and(status = 'rejected') then 'rejected'
    else 'partially_approved'
  end into new_batch_status
  from public.agent_actions
  where batch_id = reviewed_action.batch_id;

  update public.agent_action_batches
  set status = new_batch_status, updated_at = now()
  where id = reviewed_action.batch_id;

  insert into public.agent_audit_logs (workspace_id, actor_id, action_id, event_type, details)
  values (reviewed_action.workspace_id, auth.uid(), reviewed_action.id, 'action_reviewed', jsonb_build_object('approved', approve));

  return reviewed_action;
end;
$$;

create or replace function public.record_agent_action_execution(
  target_action_id uuid,
  execution_status text,
  result jsonb default null,
  error_message text default null
)
returns public.agent_actions
language plpgsql
security definer set search_path = ''
as $$
declare
  executed_action public.agent_actions%rowtype;
begin
  if execution_status not in ('executing', 'executed', 'failed') then
    raise exception 'Invalid execution status';
  end if;
  if result is not null and jsonb_typeof(result) <> 'object' then
    raise exception 'Execution result must be a JSON object';
  end if;

  select * into executed_action
  from public.agent_actions
  where id = target_action_id
  for update;

  if executed_action.id is null then
    raise exception 'Agent action not found';
  end if;
  if execution_status = 'executing' and executed_action.status <> 'approved' then
    raise exception 'Only approved actions can begin execution';
  end if;
  if execution_status = 'executed' and executed_action.status <> 'executing' then
    raise exception 'Only executing actions can be completed';
  end if;
  if execution_status = 'failed' and executed_action.status not in ('approved', 'executing') then
    raise exception 'Only approved or executing actions can fail';
  end if;

  update public.agent_actions
  set status = execution_status,
      executed_by = case when execution_status = 'executing' then auth.uid() else executed_by end,
       execution_started_at = case when execution_status = 'executing' or (execution_status = 'failed' and execution_started_at is null) then now() else execution_started_at end,
      executed_at = case when execution_status in ('executed', 'failed') then now() else null end,
      execution_result = result,
      execution_error = error_message,
      updated_at = now()
  where id = target_action_id
  returning * into executed_action;

  update public.agent_action_batches
  set status = case
        when exists (
          select 1 from public.agent_actions
          where batch_id = executed_action.batch_id and status = 'failed'
        ) then 'failed'
        when not exists (
          select 1 from public.agent_actions
          where batch_id = executed_action.batch_id and status <> 'executed'
        ) then 'completed'
        else 'executing'
      end,
      updated_at = now()
  where id = executed_action.batch_id;

  insert into public.agent_audit_logs (workspace_id, actor_id, action_id, event_type, details)
  values (
    executed_action.workspace_id,
    auth.uid(),
    executed_action.id,
    'action_' || execution_status,
    jsonb_build_object('has_result', result is not null, 'has_error', error_message is not null)
  );

  return executed_action;
end;
$$;

revoke all on function public.review_agent_action(uuid, boolean) from public;
revoke all on function public.record_agent_action_execution(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.review_agent_action(uuid, boolean) to authenticated;
grant execute on function public.record_agent_action_execution(uuid, text, jsonb, text) to service_role;

create or replace function public.review_agent_action_batch(target_batch_id uuid, approve boolean)
returns public.agent_action_batches
language plpgsql
security definer set search_path = ''
as $$
declare
  reviewed_batch public.agent_action_batches%rowtype;
begin
  if approve is null then raise exception 'An approval decision is required'; end if;

  select * into reviewed_batch
  from public.agent_action_batches
  where id = target_batch_id
  for update;

  if reviewed_batch.id is null or not public.is_workspace_member(reviewed_batch.workspace_id) then
    raise exception 'Agent action batch not found';
  end if;
  if (approve and reviewed_batch.status = 'approved') or (not approve and reviewed_batch.status = 'rejected') then
    return reviewed_batch;
  end if;
  if reviewed_batch.status <> 'proposed' then
    raise exception 'Only proposed action batches can be reviewed';
  end if;
  if not exists (select 1 from public.agent_actions where batch_id = target_batch_id and status = 'proposed') then
    raise exception 'Action batch has no proposals';
  end if;

  update public.agent_actions
  set status = case when approve then 'approved' else 'rejected' end,
      approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where batch_id = target_batch_id and status = 'proposed';

  update public.agent_action_batches
  set status = case when approve then 'approved' else 'rejected' end, updated_at = now()
  where id = target_batch_id
  returning * into reviewed_batch;

  insert into public.agent_audit_logs (workspace_id, actor_id, run_id, event_type, details)
  values (reviewed_batch.workspace_id, auth.uid(), reviewed_batch.run_id, 'batch_reviewed', jsonb_build_object('batch_id', target_batch_id, 'approved', approve));
  return reviewed_batch;
end;
$$;

create or replace function public.execute_agent_domain_action(target_action_id uuid, requester_id uuid)
returns public.agent_actions
language plpgsql
security definer set search_path = ''
as $$
declare
  pending_action public.agent_actions%rowtype;
  resource_id uuid;
  proposed_priority public.task_priority;
  active_budget_id uuid;
  proposed_currency public.currency_code;
  proposed_rate numeric(20,10);
  proposed_rate_source text;
  parent_id uuid;
  proposed_destinations text[];
begin
  select * into pending_action from public.agent_actions where id = target_action_id for update;
  if pending_action.id is null then raise exception 'Agent action not found'; end if;
  if pending_action.status = 'executed' then return pending_action; end if;
  if pending_action.status <> 'approved' then raise exception 'Only approved actions can be executed'; end if;
  if not exists (select 1 from public.workspace_members where workspace_id = pending_action.workspace_id and profile_id = requester_id) then
    raise exception 'Requesting member no longer has workspace access';
  end if;
  perform 1 from public.agent_action_batches where id = pending_action.batch_id for update;
  if nullif(pending_action.payload ->> 'ceremony_id', '') is not null and not exists (
    select 1 from public.ceremonies where id = (pending_action.payload ->> 'ceremony_id')::uuid and workspace_id = pending_action.workspace_id
  ) then raise exception 'Ceremony does not belong to this workspace'; end if;
  if nullif(pending_action.payload ->> 'vendor_id', '') is not null and not exists (
    select 1 from public.vendors where id = (pending_action.payload ->> 'vendor_id')::uuid and workspace_id = pending_action.workspace_id
  ) then raise exception 'Vendor does not belong to this workspace'; end if;
  if nullif(pending_action.payload ->> 'guest_id', '') is not null and not exists (
    select 1 from public.guests where id = (pending_action.payload ->> 'guest_id')::uuid and workspace_id = pending_action.workspace_id
  ) then raise exception 'Guest does not belong to this workspace'; end if;
  if nullif(pending_action.payload ->> 'expense_id', '') is not null and not exists (
    select 1 from public.expenses where id = (pending_action.payload ->> 'expense_id')::uuid and workspace_id = pending_action.workspace_id
  ) then raise exception 'Expense does not belong to this workspace'; end if;
  if nullif(pending_action.payload ->> 'trip_id', '') is not null and not exists (
    select 1 from public.honeymoon_trips where id = (pending_action.payload ->> 'trip_id')::uuid and workspace_id = pending_action.workspace_id
  ) then raise exception 'Honeymoon trip does not belong to this workspace'; end if;

  if pending_action.resource_type = 'task' then
    if pending_action.action_type = 'create' then
      if nullif(btrim(pending_action.payload ->> 'title'), '') is null then raise exception 'Task title is required'; end if;
      proposed_priority := coalesce(nullif(pending_action.payload ->> 'priority', '')::public.task_priority, 'medium');
      insert into public.tasks (workspace_id, title, description, priority, due_at, created_by, updated_by)
      values (pending_action.workspace_id, left(btrim(pending_action.payload ->> 'title'), 240), nullif(btrim(pending_action.payload ->> 'description'), ''), proposed_priority, nullif(pending_action.payload ->> 'due_at', '')::timestamptz, requester_id, requester_id)
      returning id into resource_id;
    elsif pending_action.action_type = 'update' then
      update public.tasks set
        title = case when pending_action.payload ? 'title' then left(btrim(pending_action.payload ->> 'title'), 240) else title end,
        description = case when pending_action.payload ? 'description' then nullif(btrim(pending_action.payload ->> 'description'), '') else description end,
        priority = case when pending_action.payload ? 'priority' and nullif(pending_action.payload ->> 'priority', '') is not null then (pending_action.payload ->> 'priority')::public.task_priority else priority end,
        due_at = case when pending_action.payload ? 'due_at' then nullif(pending_action.payload ->> 'due_at', '')::timestamptz else due_at end,
        updated_by = requester_id
      where id = pending_action.target_id and workspace_id = pending_action.workspace_id and deleted_at is null
      returning id into resource_id;
      if resource_id is null then raise exception 'Task not found'; end if;
    else
      raise exception 'Unsupported task action';
    end if;
  elsif pending_action.resource_type = 'vendor' and pending_action.action_type = 'create' then
    if nullif(btrim(pending_action.payload ->> 'name'), '') is null then raise exception 'Vendor name is required'; end if;
    if nullif(btrim(pending_action.payload ->> 'category'), '') is null then raise exception 'Vendor category is required'; end if;
    insert into public.vendors (workspace_id, name, category, website, social_links, selection_status, created_by, updated_by)
    values (
      pending_action.workspace_id,
      left(btrim(pending_action.payload ->> 'name'), 200),
      left(btrim(pending_action.payload ->> 'category'), 100),
      nullif(btrim(coalesce(pending_action.payload ->> 'source_url', pending_action.payload ->> 'website')), ''),
      case when nullif(btrim(coalesce(pending_action.payload ->> 'source_url', pending_action.payload ->> 'website')), '') is null then '{}'::jsonb else jsonb_build_object('source', coalesce(pending_action.payload ->> 'source_url', pending_action.payload ->> 'website')) end,
      'researching', requester_id, requester_id
    ) returning id into resource_id;
  elsif pending_action.resource_type = 'vendor' and pending_action.action_type = 'update' then
    update public.vendors set
      selection_status = case when pending_action.payload ? 'selection_status' then (pending_action.payload ->> 'selection_status') else selection_status end,
      updated_by = requester_id
    where id = pending_action.target_id and workspace_id = pending_action.workspace_id and deleted_at is null
    returning id into resource_id;
    if resource_id is null then raise exception 'Vendor not found'; end if;
  elsif pending_action.resource_type = 'ceremony' and pending_action.action_type = 'create' then
    if nullif(btrim(pending_action.payload ->> 'name'), '') is null then raise exception 'Ceremony name is required'; end if;
    insert into public.ceremonies (workspace_id, kind, name, status, starts_at, location_name, guest_capacity, created_by, updated_by)
    values (
      pending_action.workspace_id,
      left(coalesce(nullif(btrim(pending_action.payload ->> 'kind'), ''), btrim(pending_action.payload ->> 'name')), 80),
      left(btrim(pending_action.payload ->> 'name'), 120),
      coalesce(nullif(pending_action.payload ->> 'status', '')::public.ceremony_status, 'tentative'),
      nullif(pending_action.payload ->> 'starts_at', '')::timestamptz,
      nullif(btrim(pending_action.payload ->> 'location_name'), ''),
      nullif(pending_action.payload ->> 'guest_capacity', '')::integer,
      requester_id, requester_id
    ) returning id into resource_id;
  elsif pending_action.resource_type = 'budget' and pending_action.action_type = 'create' then
    if coalesce((pending_action.payload ->> 'total_minor')::bigint, -1) < 0 then raise exception 'Budget amount is required'; end if;
    proposed_currency := coalesce(nullif(pending_action.payload ->> 'reporting_currency', '')::public.currency_code, 'NGN');
    select id into active_budget_id from public.budgets where workspace_id = pending_action.workspace_id and deleted_at is null for update;
    if active_budget_id is null then
      insert into public.budgets (workspace_id, name, reporting_currency, total_minor, created_by, updated_by)
      values (pending_action.workspace_id, 'Wedding budget', proposed_currency, (pending_action.payload ->> 'total_minor')::bigint, requester_id, requester_id)
      returning id into resource_id;
    else
      update public.budgets set total_minor = (pending_action.payload ->> 'total_minor')::bigint, reporting_currency = proposed_currency, updated_by = requester_id
      where id = active_budget_id returning id into resource_id;
    end if;
  elsif pending_action.resource_type = 'budget_allocation' and pending_action.action_type = 'create' then
    if nullif(btrim(pending_action.payload ->> 'category'), '') is null then raise exception 'Allocation category is required'; end if;
    if coalesce((pending_action.payload ->> 'planned_minor')::bigint, -1) < 0 then raise exception 'Allocation amount is required'; end if;
    select id into active_budget_id from public.budgets where workspace_id = pending_action.workspace_id and deleted_at is null;
    if active_budget_id is null then
      insert into public.budgets (workspace_id, name, reporting_currency, created_by, updated_by)
      values (pending_action.workspace_id, 'Wedding budget', 'NGN', requester_id, requester_id)
      returning id into active_budget_id;
    end if;
    insert into public.budget_allocations (workspace_id, budget_id, ceremony_id, category, planned_minor, created_by, updated_by)
    values (pending_action.workspace_id, active_budget_id, nullif(pending_action.payload ->> 'ceremony_id', '')::uuid, left(btrim(pending_action.payload ->> 'category'), 100), (pending_action.payload ->> 'planned_minor')::bigint, requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'expense' and pending_action.action_type = 'create' then
    if nullif(btrim(pending_action.payload ->> 'description'), '') is null then raise exception 'Expense description is required'; end if;
    if nullif(btrim(pending_action.payload ->> 'category'), '') is null then raise exception 'Expense category is required'; end if;
    if coalesce((pending_action.payload ->> 'amount_minor')::bigint, -1) < 0 then raise exception 'Expense amount is required'; end if;
    proposed_currency := coalesce(nullif(pending_action.payload ->> 'currency', '')::public.currency_code, 'NGN');
    if proposed_currency = 'NGN' then
      proposed_rate := 1;
      proposed_rate_source := 'native';
    else
      select rate, source into proposed_rate, proposed_rate_source
      from public.exchange_rates
      where workspace_id = pending_action.workspace_id and base_currency = proposed_currency and quote_currency = 'NGN' and deleted_at is null
      order by rate_date desc limit 1;
      if proposed_rate is null then raise exception 'Add an exchange rate before recording this expense'; end if;
    end if;
    insert into public.expenses (workspace_id, vendor_id, description, category, status, amount_minor, currency, transaction_date, exchange_rate, rate_source, rate_retrieved_at, ngn_minor, created_by, updated_by)
    values (
      pending_action.workspace_id,
      nullif(pending_action.payload ->> 'vendor_id', '')::uuid,
      left(btrim(pending_action.payload ->> 'description'), 240),
      left(btrim(pending_action.payload ->> 'category'), 100),
      coalesce(nullif(pending_action.payload ->> 'status', ''), 'planned'),
      (pending_action.payload ->> 'amount_minor')::bigint,
      proposed_currency,
      coalesce(nullif(pending_action.payload ->> 'transaction_date', '')::date, current_date),
      proposed_rate, proposed_rate_source, now(), round((pending_action.payload ->> 'amount_minor')::numeric * proposed_rate)::bigint,
      requester_id, requester_id
    ) returning id into resource_id;
  elsif pending_action.resource_type = 'ceremony_segment' and pending_action.action_type = 'create' then
    insert into public.ceremony_segments (ceremony_id, name, starts_at, notes, created_by, updated_by)
    values ((pending_action.payload ->> 'ceremony_id')::uuid, btrim(pending_action.payload ->> 'name'), nullif(pending_action.payload ->> 'starts_at', '')::timestamptz, nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'guest' and pending_action.action_type = 'create' then
    insert into public.guests (workspace_id, full_name, email, phone, plus_one_allowed, notes, created_by, updated_by)
    values (pending_action.workspace_id, btrim(pending_action.payload ->> 'full_name'), nullif(btrim(pending_action.payload ->> 'email'), ''), nullif(btrim(pending_action.payload ->> 'phone'), ''), coalesce((pending_action.payload ->> 'plus_one_allowed')::boolean, false), nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'guest_invitation' and pending_action.action_type = 'create' then
    insert into public.guest_invitations (workspace_id, guest_id, ceremony_id, invitation_status, rsvp_status, invited_plus_one, created_by, updated_by)
    values (pending_action.workspace_id, (pending_action.payload ->> 'guest_id')::uuid, (pending_action.payload ->> 'ceremony_id')::uuid, coalesce(nullif(pending_action.payload ->> 'invitation_status', ''), 'not_sent'), coalesce(nullif(pending_action.payload ->> 'rsvp_status', ''), 'pending'), coalesce((pending_action.payload ->> 'invited_plus_one')::boolean, false), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'vendor_quote' and pending_action.action_type = 'create' then
    proposed_currency := coalesce(nullif(pending_action.payload ->> 'currency', '')::public.currency_code, 'NGN');
    if proposed_currency <> 'NGN' then raise exception 'Non-NGN quotes require an exchange-rate review'; end if;
    insert into public.vendor_quotes (workspace_id, vendor_id, ceremony_id, title, amount_minor, currency, exchange_rate, ngn_minor, rate_source, rate_retrieved_at, valid_until, status, details, created_by, updated_by)
    values (pending_action.workspace_id, (pending_action.payload ->> 'vendor_id')::uuid, nullif(pending_action.payload ->> 'ceremony_id', '')::uuid, btrim(pending_action.payload ->> 'title'), (pending_action.payload ->> 'amount_minor')::bigint, proposed_currency, 1, (pending_action.payload ->> 'amount_minor')::bigint, 'native', now(), nullif(pending_action.payload ->> 'valid_until', '')::date, coalesce(nullif(pending_action.payload ->> 'status', ''), 'received'), nullif(pending_action.payload ->> 'details', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'vendor_appointment' and pending_action.action_type = 'create' then
    insert into public.vendor_appointments (workspace_id, vendor_id, ceremony_id, title, appointment_type, starts_at, ends_at, location, notes, created_by, updated_by)
    values (pending_action.workspace_id, (pending_action.payload ->> 'vendor_id')::uuid, nullif(pending_action.payload ->> 'ceremony_id', '')::uuid, btrim(pending_action.payload ->> 'title'), nullif(pending_action.payload ->> 'appointment_type', ''), (pending_action.payload ->> 'starts_at')::timestamptz, nullif(pending_action.payload ->> 'ends_at', '')::timestamptz, nullif(pending_action.payload ->> 'location', ''), nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'payment_schedule' and pending_action.action_type = 'create' then
    insert into public.payment_schedules (workspace_id, expense_id, label, amount_minor, due_date, notes, created_by, updated_by)
    values (pending_action.workspace_id, (pending_action.payload ->> 'expense_id')::uuid, btrim(pending_action.payload ->> 'label'), (pending_action.payload ->> 'amount_minor')::bigint, nullif(pending_action.payload ->> 'due_date', '')::date, nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'venue' and pending_action.action_type = 'create' then
    insert into public.venues (workspace_id, name, address, capacity, website, availability_notes, selection_status, notes, created_by, updated_by)
    values (pending_action.workspace_id, btrim(pending_action.payload ->> 'name'), nullif(pending_action.payload ->> 'address', ''), nullif(pending_action.payload ->> 'capacity', '')::integer, nullif(pending_action.payload ->> 'website', ''), nullif(pending_action.payload ->> 'availability_notes', ''), coalesce(nullif(pending_action.payload ->> 'selection_status', ''), 'researching'), nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'food_drink_plan' and pending_action.action_type = 'create' then
    insert into public.food_drink_plans (workspace_id, ceremony_id, vendor_id, name, service_type, package_name, guest_count, status, notes, created_by, updated_by)
    values (pending_action.workspace_id, (pending_action.payload ->> 'ceremony_id')::uuid, nullif(pending_action.payload ->> 'vendor_id', '')::uuid, btrim(pending_action.payload ->> 'name'), coalesce(nullif(pending_action.payload ->> 'service_type', ''), 'combined'), nullif(pending_action.payload ->> 'package_name', ''), nullif(pending_action.payload ->> 'guest_count', '')::integer, coalesce(nullif(pending_action.payload ->> 'status', ''), 'option'), nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'attire' and pending_action.action_type = 'create' then
    insert into public.attire_looks (workspace_id, ceremony_id, wearer_type, name, outfit_type, fabric, color, production_status, notes, created_by, updated_by)
    values (pending_action.workspace_id, (pending_action.payload ->> 'ceremony_id')::uuid, coalesce(nullif(pending_action.payload ->> 'wearer_type', ''), 'group'), btrim(pending_action.payload ->> 'name'), nullif(pending_action.payload ->> 'outfit_type', ''), nullif(pending_action.payload ->> 'fabric', ''), nullif(pending_action.payload ->> 'color', ''), coalesce(nullif(pending_action.payload ->> 'production_status', ''), 'planned'), nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'traditional_requirement' and pending_action.action_type = 'create' then
    insert into public.traditional_requirements (workspace_id, ceremony_id, category, item_name, description, required_quantity, unit, responsible_party, due_date, status, created_by, updated_by)
    values (pending_action.workspace_id, (pending_action.payload ->> 'ceremony_id')::uuid, btrim(pending_action.payload ->> 'category'), btrim(pending_action.payload ->> 'item_name'), nullif(pending_action.payload ->> 'description', ''), coalesce(nullif(pending_action.payload ->> 'required_quantity', '')::numeric, 1), coalesce(nullif(pending_action.payload ->> 'unit', ''), 'piece'), nullif(pending_action.payload ->> 'responsible_party', ''), nullif(pending_action.payload ->> 'due_date', '')::date, coalesce(nullif(pending_action.payload ->> 'status', ''), 'outstanding'), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'seating_table' and pending_action.action_type = 'create' then
    insert into public.seating_tables (workspace_id, ceremony_id, name, capacity, notes, created_by, updated_by)
    values (pending_action.workspace_id, (pending_action.payload ->> 'ceremony_id')::uuid, btrim(pending_action.payload ->> 'name'), (pending_action.payload ->> 'capacity')::integer, nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'itinerary_item' and pending_action.action_type = 'create' then
    insert into public.itinerary_items (workspace_id, ceremony_id, vendor_id, title, starts_at, ends_at, location, responsible_person, details, status, created_by, updated_by)
    values (pending_action.workspace_id, (pending_action.payload ->> 'ceremony_id')::uuid, nullif(pending_action.payload ->> 'vendor_id', '')::uuid, btrim(pending_action.payload ->> 'title'), (pending_action.payload ->> 'starts_at')::timestamptz, nullif(pending_action.payload ->> 'ends_at', '')::timestamptz, nullif(pending_action.payload ->> 'location', ''), nullif(pending_action.payload ->> 'responsible_person', ''), nullif(pending_action.payload ->> 'details', ''), coalesce(nullif(pending_action.payload ->> 'status', ''), 'planned'), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'calendar_entry' and pending_action.action_type = 'create' then
    insert into public.calendar_entries (workspace_id, ceremony_id, title, entry_type, starts_at, ends_at, all_day, location, notes, created_by, updated_by)
    values (pending_action.workspace_id, nullif(pending_action.payload ->> 'ceremony_id', '')::uuid, btrim(pending_action.payload ->> 'title'), coalesce(nullif(pending_action.payload ->> 'entry_type', ''), 'custom'), (pending_action.payload ->> 'starts_at')::timestamptz, nullif(pending_action.payload ->> 'ends_at', '')::timestamptz, coalesce((pending_action.payload ->> 'all_day')::boolean, false), nullif(pending_action.payload ->> 'location', ''), nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'packing_item' and pending_action.action_type = 'create' then
    select id into parent_id from public.packing_lists where workspace_id = pending_action.workspace_id and ceremony_id is not distinct from nullif(pending_action.payload ->> 'ceremony_id', '')::uuid and deleted_at is null limit 1;
    if parent_id is null then
      insert into public.packing_lists (workspace_id, ceremony_id, name, list_type, created_by, updated_by)
      values (pending_action.workspace_id, nullif(pending_action.payload ->> 'ceremony_id', '')::uuid, coalesce(nullif(pending_action.payload ->> 'list_name', ''), 'Wedding packing'), case when nullif(pending_action.payload ->> 'ceremony_id', '') is null then 'custom' else 'ceremony' end, requester_id, requester_id)
      returning id into parent_id;
    end if;
    insert into public.packing_items (workspace_id, packing_list_id, category, name, quantity, responsible_person, packed, created_by, updated_by)
    values (pending_action.workspace_id, parent_id, coalesce(nullif(pending_action.payload ->> 'category', ''), 'General'), btrim(pending_action.payload ->> 'name'), coalesce(nullif(pending_action.payload ->> 'quantity', '')::numeric, 1), nullif(pending_action.payload ->> 'responsible_person', ''), false, requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'gift' and pending_action.action_type = 'create' then
    insert into public.gifts (workspace_id, ceremony_id, giver_name, description, gift_type, received_on, thank_you_status, notes, created_by, updated_by)
    values (pending_action.workspace_id, nullif(pending_action.payload ->> 'ceremony_id', '')::uuid, nullif(pending_action.payload ->> 'giver_name', ''), btrim(pending_action.payload ->> 'description'), 'physical', coalesce(nullif(pending_action.payload ->> 'received_on', '')::date, current_date), 'pending', nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'honeymoon_trip' and pending_action.action_type = 'create' then
    select coalesce(array_agg(destination), '{}'::text[]) into proposed_destinations from jsonb_array_elements_text(coalesce(pending_action.payload -> 'destinations', '[]'::jsonb)) as destination;
    insert into public.honeymoon_trips (workspace_id, name, destinations, start_date, end_date, status, notes, created_by, updated_by)
    values (pending_action.workspace_id, btrim(pending_action.payload ->> 'name'), proposed_destinations, nullif(pending_action.payload ->> 'start_date', '')::date, nullif(pending_action.payload ->> 'end_date', '')::date, coalesce(nullif(pending_action.payload ->> 'status', ''), 'planning'), nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  elsif pending_action.resource_type = 'honeymoon_booking' and pending_action.action_type = 'create' then
    insert into public.honeymoon_bookings (workspace_id, trip_id, booking_type, provider, title, starts_at, ends_at, location, booking_reference, contact_details, status, notes, created_by, updated_by)
    values (pending_action.workspace_id, (pending_action.payload ->> 'trip_id')::uuid, coalesce(nullif(pending_action.payload ->> 'booking_type', ''), 'other'), nullif(pending_action.payload ->> 'provider', ''), btrim(pending_action.payload ->> 'title'), nullif(pending_action.payload ->> 'starts_at', '')::timestamptz, nullif(pending_action.payload ->> 'ends_at', '')::timestamptz, nullif(pending_action.payload ->> 'location', ''), nullif(pending_action.payload ->> 'booking_reference', ''), nullif(pending_action.payload ->> 'contact_details', ''), coalesce(nullif(pending_action.payload ->> 'status', ''), 'planned'), nullif(pending_action.payload ->> 'notes', ''), requester_id, requester_id)
    returning id into resource_id;
  else
    raise exception 'Unsupported domain action';
  end if;

  update public.agent_actions
  set status = 'executed', executed_by = requester_id, execution_started_at = now(), executed_at = now(), execution_result = jsonb_build_object('resourceId', resource_id), execution_error = null, updated_at = now()
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

revoke all on function public.review_agent_action_batch(uuid, boolean) from public;
revoke all on function public.execute_agent_domain_action(uuid, uuid) from public, anon, authenticated;
revoke all on function public.review_agent_action(uuid, boolean) from authenticated;
grant execute on function public.review_agent_action_batch(uuid, boolean) to authenticated;
grant execute on function public.execute_agent_domain_action(uuid, uuid) to service_role;

-- Explicitly keep service-managed rows read-only to API users even if project
-- default privileges grant table writes to authenticated.
revoke insert, update, delete on public.agent_runs from authenticated;
revoke update, delete on public.agent_messages from authenticated;
revoke insert, update, delete on public.agent_action_batches from authenticated;
revoke insert, update, delete on public.agent_actions from authenticated;
revoke insert, update, delete on public.agent_audit_logs from authenticated;
