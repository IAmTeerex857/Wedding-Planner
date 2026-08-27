create or replace function public.sync_task_reminder()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.notifications
  set status = 'cancelled', deleted_at = now(), updated_at = now(), updated_by = new.updated_by
  where source_table = 'tasks' and source_id = new.id and status in ('pending', 'scheduled');

  if new.reminder_at is not null and new.status <> 'done' and new.deleted_at is null then
    insert into public.notifications (
      workspace_id, recipient_id, notification_type, channel, title, body,
      status, scheduled_for, source_table, source_id, created_by, updated_by
    )
    select
      new.workspace_id, profile_id, 'task_reminder', 'email',
      'Wedding task reminder: ' || new.title,
      coalesce(new.description, 'This task needs your attention.'),
      'scheduled', new.reminder_at, 'tasks', new.id, new.updated_by, new.updated_by
    from public.workspace_members
    where workspace_id = new.workspace_id;
  end if;
  return new;
end;
$$;

create trigger tasks_sync_reminder
after insert or update of title, description, status, reminder_at, deleted_at on public.tasks
for each row execute function public.sync_task_reminder();

create or replace function public.sync_payment_reminder()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.notifications
  set status = 'cancelled', deleted_at = now(), updated_at = now(), updated_by = new.updated_by
  where source_table = 'payment_schedules' and source_id = new.id and status in ('pending', 'scheduled');

  if new.reminder_at is not null and new.status not in ('paid', 'waived') and new.deleted_at is null then
    insert into public.notifications (
      workspace_id, recipient_id, notification_type, channel, title, body,
      status, scheduled_for, source_table, source_id, created_by, updated_by
    )
    select
      new.workspace_id, profile_id, 'payment_reminder', 'email',
      'Wedding payment reminder: ' || new.label,
      'A scheduled wedding payment is approaching.',
      'scheduled', new.reminder_at, 'payment_schedules', new.id, new.updated_by, new.updated_by
    from public.workspace_members
    where workspace_id = new.workspace_id;
  end if;
  return new;
end;
$$;

create trigger payment_schedules_sync_reminder
after insert or update of label, status, reminder_at, deleted_at on public.payment_schedules
for each row execute function public.sync_payment_reminder();
