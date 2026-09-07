-- Preserve previously soft-deleted agent conversations as accessible history.
update public.agent_conversations
set status = 'archived', deleted_at = null, updated_at = now()
where deleted_at is not null;
