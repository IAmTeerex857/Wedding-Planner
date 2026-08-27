create or replace function public.import_guest_rows(target_workspace_id uuid, import_source text, guest_rows jsonb)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  batch_id uuid;
  row_data jsonb;
  guest_data jsonb;
  new_guest_id uuid;
  matched_id uuid;
  tag_name text;
  tag_id uuid;
  ceremony_record record;
  response_value text;
  v_created_count integer := 0;
  v_skipped_count integer := 0;
  v_invalid_count integer := 0;
  row_number integer := 0;
  email_value text;
  phone_value text;
  full_name_value text;
begin
  if not public.is_workspace_member(target_workspace_id) then raise exception 'Workspace access denied'; end if;
  if import_source not in ('csv', 'xlsx', 'clipboard') then raise exception 'Unsupported import source'; end if;
  if jsonb_typeof(guest_rows) <> 'array' then raise exception 'Guest rows must be an array'; end if;

  insert into public.import_batches (workspace_id, source_type, status, total_count, created_by, updated_by)
  values (target_workspace_id, import_source, 'importing', jsonb_array_length(guest_rows), auth.uid(), auth.uid())
  returning id into batch_id;

  for row_data in select value from jsonb_array_elements(guest_rows) loop
    row_number := row_number + 1;
    guest_data := coalesce(row_data -> 'guest', row_data);
    email_value := nullif(lower(btrim(guest_data ->> 'email')), '');
    phone_value := nullif(regexp_replace(coalesce(guest_data ->> 'phone', ''), '[^0-9+]', '', 'g'), '');
    full_name_value := btrim(concat_ws(' ', guest_data ->> 'firstName', guest_data ->> 'lastName'));

    if coalesce(row_data ->> 'status', 'ready') <> 'ready' or full_name_value = '' or (email_value is null and phone_value is null) then
      if row_data ->> 'status' = 'duplicate' then v_skipped_count := v_skipped_count + 1; else v_invalid_count := v_invalid_count + 1; end if;
      insert into public.import_rows (workspace_id, import_batch_id, row_number, raw_data, normalized_data, validation_errors, status, resolution_notes, created_by, updated_by)
      values (target_workspace_id, batch_id, row_number, coalesce(row_data -> 'source', '{}'::jsonb), guest_data, jsonb_build_array(coalesce(row_data ->> 'reason', 'Invalid row')), case when row_data ->> 'status' = 'duplicate' then 'skipped_duplicate' else 'invalid' end, row_data ->> 'reason', auth.uid(), auth.uid());
      continue;
    end if;

    matched_id := null;
    if email_value is not null then select id into matched_id from public.guests where workspace_id = target_workspace_id and normalized_email = email_value and deleted_at is null limit 1; end if;
    if matched_id is null and phone_value is not null then select id into matched_id from public.guests where workspace_id = target_workspace_id and normalized_phone = phone_value and deleted_at is null limit 1; end if;
    if matched_id is not null then
      v_skipped_count := v_skipped_count + 1;
      insert into public.import_rows (workspace_id, import_batch_id, row_number, raw_data, normalized_data, status, matched_guest_id, resolution_notes, created_by, updated_by)
      values (target_workspace_id, batch_id, row_number, coalesce(row_data -> 'source', '{}'::jsonb), guest_data, 'skipped_duplicate', matched_id, 'Matched by email or phone', auth.uid(), auth.uid());
      continue;
    end if;

    begin
      insert into public.guests (workspace_id, full_name, email, normalized_email, phone, normalized_phone, plus_one_allowed, plus_one_name, source_type, import_batch_id, created_by, updated_by)
      values (target_workspace_id, full_name_value, nullif(guest_data ->> 'email', ''), email_value, nullif(guest_data ->> 'phone', ''), phone_value, coalesce((guest_data ->> 'plusOneAllowed')::boolean, false), nullif(guest_data ->> 'plusOneName', ''), import_source, batch_id, auth.uid(), auth.uid())
      returning id into new_guest_id;

      if nullif(guest_data ->> 'accommodation', '') is not null then
        insert into public.guest_accommodations (workspace_id, guest_id, name, created_by, updated_by)
        values (target_workspace_id, new_guest_id, guest_data ->> 'accommodation', auth.uid(), auth.uid());
      end if;

      for tag_name in select jsonb_array_elements_text(coalesce(guest_data -> 'tags', '[]'::jsonb)) loop
        select id into tag_id from public.guest_tags where workspace_id = target_workspace_id and lower(name) = lower(btrim(tag_name)) and deleted_at is null limit 1;
        if tag_id is null then insert into public.guest_tags (workspace_id, name, created_by, updated_by) values (target_workspace_id, btrim(tag_name), auth.uid(), auth.uid()) returning id into tag_id; end if;
        insert into public.guest_tag_assignments (workspace_id, guest_id, tag_id, created_by) values (target_workspace_id, new_guest_id, tag_id, auth.uid()) on conflict do nothing;
      end loop;

      for ceremony_record in select id, kind::text as kind from public.ceremonies where workspace_id = target_workspace_id and deleted_at is null loop
        response_value := coalesce(guest_data -> 'rsvps' ->> ceremony_record.kind, 'pending');
        insert into public.guest_invitations (workspace_id, guest_id, ceremony_id, rsvp_status, invited_plus_one, responded_at, created_by, updated_by)
        values (target_workspace_id, new_guest_id, ceremony_record.id, case response_value when 'attending' then 'accepted' when 'declined' then 'declined' else 'pending' end, coalesce((guest_data ->> 'plusOneAllowed')::boolean, false), case when response_value = 'pending' then null else now() end, auth.uid(), auth.uid());
      end loop;

      insert into public.import_rows (workspace_id, import_batch_id, row_number, raw_data, normalized_data, status, created_guest_id, created_by, updated_by)
      values (target_workspace_id, batch_id, row_number, coalesce(row_data -> 'source', '{}'::jsonb), guest_data, 'created', new_guest_id, auth.uid(), auth.uid());
      v_created_count := v_created_count + 1;
    exception when others then
      v_invalid_count := v_invalid_count + 1;
      insert into public.import_rows (workspace_id, import_batch_id, row_number, raw_data, normalized_data, validation_errors, status, resolution_notes, created_by, updated_by)
      values (target_workspace_id, batch_id, row_number, coalesce(row_data -> 'source', '{}'::jsonb), guest_data, jsonb_build_array(sqlerrm), 'invalid', sqlerrm, auth.uid(), auth.uid());
    end;
  end loop;

  update public.import_batches set status = 'completed', created_count = v_created_count, skipped_count = v_skipped_count, invalid_count = v_invalid_count, completed_at = now(), updated_at = now() where id = batch_id;
  return batch_id;
end;
$$;

revoke all on function public.import_guest_rows(uuid, text, jsonb) from public;
grant execute on function public.import_guest_rows(uuid, text, jsonb) to authenticated;
