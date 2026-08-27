-- Full wedding-planning domain. Monetary values are stored in minor currency units.

alter table public.ceremonies
  add constraint ceremonies_workspace_id_id_key unique (workspace_id, id);

alter table public.ceremony_segments
  add constraint ceremony_segments_ceremony_id_id_key unique (ceremony_id, id);

alter table public.tasks
  add constraint tasks_workspace_id_id_key unique (workspace_id, id);

create domain public.currency_code as text
  check (value ~ '^[A-Z]{3}$');

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null check (source_type in ('csv', 'xlsx', 'clipboard')),
  source_name text,
  sheet_name text,
  status text not null default 'pending' check (status in ('pending', 'validated', 'importing', 'completed', 'failed')),
  column_mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(column_mapping) = 'object'),
  total_count integer not null default 0 check (total_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  invalid_count integer not null default 0 check (invalid_count >= 0),
  unresolved_count integer not null default 0 check (unresolved_count >= 0),
  error_report_path text,
  completed_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  check (created_count + skipped_count + invalid_count + unresolved_count <= total_count)
);

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  email text,
  normalized_email text,
  phone text,
  normalized_phone text,
  plus_one_allowed boolean not null default false,
  plus_one_name text,
  notes text,
  source_type text not null default 'manual' check (source_type in ('manual', 'csv', 'xlsx', 'clipboard')),
  import_batch_id uuid,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, import_batch_id) references public.import_batches(workspace_id, id),
  check (email is null or char_length(email) <= 320),
  check (normalized_email is null or normalized_email = lower(btrim(normalized_email))),
  check (not plus_one_allowed or plus_one_name is null or char_length(btrim(plus_one_name)) > 0)
);

create unique index guests_workspace_email_uidx on public.guests(workspace_id, normalized_email)
  where deleted_at is null and normalized_email is not null;
create unique index guests_workspace_phone_uidx on public.guests(workspace_id, normalized_phone)
  where deleted_at is null and normalized_phone is not null;

create table public.guest_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  color text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);
create unique index guest_tags_workspace_name_uidx on public.guest_tags(workspace_id, lower(name)) where deleted_at is null;

create table public.guest_tag_assignments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  guest_id uuid not null,
  tag_id uuid not null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (guest_id, tag_id),
  foreign key (workspace_id, guest_id) references public.guests(workspace_id, id) on delete cascade,
  foreign key (workspace_id, tag_id) references public.guest_tags(workspace_id, id) on delete cascade
);

create table public.guest_accommodations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  guest_id uuid not null,
  name text,
  address text,
  check_in_date date,
  check_out_date date,
  booking_reference text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, guest_id) references public.guests(workspace_id, id) on delete cascade,
  check (check_out_date is null or check_in_date is null or check_out_date >= check_in_date)
);

create table public.guest_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  guest_id uuid not null,
  ceremony_id uuid not null,
  invitation_status text not null default 'not_sent' check (invitation_status in ('not_sent', 'scheduled', 'sent', 'delivered', 'failed')),
  rsvp_status text not null default 'pending' check (rsvp_status in ('pending', 'accepted', 'declined', 'maybe', 'no_response')),
  invited_plus_one boolean not null default false,
  sent_at timestamptz,
  responded_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, guest_id) references public.guests(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id) on delete cascade
);
create unique index guest_invitations_guest_ceremony_uidx
  on public.guest_invitations(workspace_id, guest_id, ceremony_id) where deleted_at is null;

create table public.rsvp_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invitation_id uuid not null,
  import_batch_id uuid,
  response text not null check (response in ('accepted', 'declined', 'maybe')),
  plus_one_attending boolean not null default false,
  plus_one_name text,
  submitted_at timestamptz not null default now(),
  source_type text not null default 'manual' check (source_type in ('manual', 'csv', 'xlsx', 'clipboard')),
  raw_response jsonb check (raw_response is null or jsonb_typeof(raw_response) = 'object'),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, invitation_id) references public.guest_invitations(workspace_id, id) on delete cascade,
  foreign key (workspace_id, import_batch_id) references public.import_batches(workspace_id, id),
  check (plus_one_attending = false or response = 'accepted')
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  import_batch_id uuid not null,
  row_number integer not null check (row_number > 0),
  raw_data jsonb not null check (jsonb_typeof(raw_data) = 'object'),
  normalized_data jsonb check (normalized_data is null or jsonb_typeof(normalized_data) = 'object'),
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'valid', 'created', 'skipped_duplicate', 'conflict', 'invalid', 'manually_resolved')),
  matched_guest_id uuid,
  created_guest_id uuid,
  resolution_notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  unique (import_batch_id, row_number),
  foreign key (workspace_id, import_batch_id) references public.import_batches(workspace_id, id) on delete cascade,
  foreign key (workspace_id, matched_guest_id) references public.guests(workspace_id, id),
  foreign key (workspace_id, created_guest_id) references public.guests(workspace_id, id)
);

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  base_currency public.currency_code not null,
  quote_currency public.currency_code not null default 'NGN',
  rate numeric(20,10) not null check (rate > 0),
  rate_date date not null,
  source text not null,
  retrieved_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  check (base_currency <> quote_currency or rate = 1)
);
create unique index exchange_rates_natural_uidx
  on public.exchange_rates(workspace_id, base_currency, quote_currency, rate_date, source) where deleted_at is null;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  reporting_currency public.currency_code not null default 'NGN',
  total_minor bigint not null default 0 check (total_minor >= 0),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);
create unique index budgets_one_active_uidx on public.budgets(workspace_id) where deleted_at is null;

create table public.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  budget_id uuid not null,
  ceremony_id uuid,
  category text not null check (char_length(btrim(category)) between 1 and 100),
  planned_minor bigint not null default 0 check (planned_minor >= 0),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, budget_id) references public.budgets(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id)
);
create unique index budget_allocations_scope_category_uidx
  on public.budget_allocations(workspace_id, budget_id, coalesce(ceremony_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(category))
  where deleted_at is null;

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text not null,
  website text,
  social_links jsonb not null default '{}'::jsonb check (jsonb_typeof(social_links) = 'object'),
  package_details text,
  selection_status text not null default 'researching' check (selection_status in ('researching', 'shortlisted', 'selected', 'rejected', 'cancelled')),
  rating numeric(2,1) check (rating between 0 and 5),
  comparison_notes text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);

create table public.vendor_ceremonies (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vendor_id uuid not null,
  ceremony_id uuid not null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (vendor_id, ceremony_id),
  foreign key (workspace_id, vendor_id) references public.vendors(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id) on delete cascade
);

create table public.vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vendor_id uuid not null,
  name text not null,
  role text,
  email text,
  phone text,
  is_primary boolean not null default false,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, vendor_id) references public.vendors(workspace_id, id) on delete cascade
);
create unique index vendor_contacts_primary_uidx on public.vendor_contacts(vendor_id) where is_primary and deleted_at is null;

create table public.vendor_quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vendor_id uuid not null,
  ceremony_id uuid,
  title text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency public.currency_code not null,
  exchange_rate numeric(20,10) not null check (exchange_rate > 0),
  ngn_minor bigint not null check (ngn_minor >= 0),
  rate_source text not null,
  rate_retrieved_at timestamptz not null,
  valid_until date,
  status text not null default 'received' check (status in ('requested', 'received', 'accepted', 'rejected', 'expired')),
  details text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, vendor_id) references public.vendors(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id)
);

create table public.vendor_appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vendor_id uuid not null,
  ceremony_id uuid,
  title text not null,
  appointment_type text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'missed')),
  reminder_at timestamptz,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, vendor_id) references public.vendors(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id),
  check (ends_at is null or ends_at >= starts_at)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  budget_allocation_id uuid,
  vendor_id uuid,
  description text not null,
  category text not null,
  status text not null default 'planned' check (status in ('planned', 'committed', 'part_paid', 'paid', 'cancelled')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency public.currency_code not null,
  transaction_date date not null,
  exchange_rate numeric(20,10) not null check (exchange_rate > 0),
  rate_source text not null,
  rate_retrieved_at timestamptz not null,
  ngn_minor bigint not null check (ngn_minor >= 0),
  invoice_number text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, budget_allocation_id) references public.budget_allocations(workspace_id, id),
  foreign key (workspace_id, vendor_id) references public.vendors(workspace_id, id)
);

create table public.expense_ceremonies (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  expense_id uuid not null,
  ceremony_id uuid not null,
  allocation_percent numeric(5,2) check (allocation_percent > 0 and allocation_percent <= 100),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (expense_id, ceremony_id),
  foreign key (workspace_id, expense_id) references public.expenses(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id) on delete cascade
);

create table public.payment_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  expense_id uuid not null,
  label text not null,
  amount_minor bigint not null check (amount_minor > 0),
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'due', 'paid', 'overdue', 'waived')),
  reminder_at timestamptz,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, expense_id) references public.expenses(workspace_id, id) on delete cascade
);

create table public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  expense_id uuid not null,
  payment_schedule_id uuid,
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency_code not null,
  paid_on date not null,
  exchange_rate numeric(20,10) not null check (exchange_rate > 0),
  rate_source text not null,
  rate_retrieved_at timestamptz not null,
  ngn_minor bigint not null check (ngn_minor >= 0),
  method text,
  reference text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, expense_id) references public.expenses(workspace_id, id) on delete cascade,
  foreign key (workspace_id, payment_schedule_id) references public.payment_schedules(workspace_id, id)
);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contributor_name text not null,
  pledged_minor bigint not null default 0 check (pledged_minor >= 0),
  received_minor bigint not null default 0 check (received_minor >= 0),
  currency public.currency_code not null,
  exchange_rate numeric(20,10) not null check (exchange_rate > 0),
  rate_source text not null,
  rate_retrieved_at timestamptz not null,
  ngn_received_minor bigint not null default 0 check (ngn_received_minor >= 0),
  received_on date,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);

create table public.contribution_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contribution_id uuid not null,
  ceremony_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, contribution_id) references public.contributions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id)
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vendor_id uuid,
  name text not null,
  contact_name text,
  phone text,
  email text,
  website text,
  address text,
  capacity integer check (capacity is null or capacity >= 0),
  availability_notes text,
  ceremony_fee_minor bigint check (ceremony_fee_minor is null or ceremony_fee_minor >= 0),
  reception_fee_minor bigint check (reception_fee_minor is null or reception_fee_minor >= 0),
  food_drink_minor bigint check (food_drink_minor is null or food_drink_minor >= 0),
  rental_minor bigint check (rental_minor is null or rental_minor >= 0),
  corkage_minor bigint check (corkage_minor is null or corkage_minor >= 0),
  total_estimated_minor bigint generated always as (
    coalesce(ceremony_fee_minor, 0) + coalesce(reception_fee_minor, 0)
    + coalesce(food_drink_minor, 0) + coalesce(rental_minor, 0) + coalesce(corkage_minor, 0)
  ) stored,
  currency public.currency_code not null default 'NGN',
  decoration_restrictions text,
  included_services text,
  pros text,
  cons text,
  selection_status text not null default 'researching' check (selection_status in ('researching', 'shortlisted', 'selected', 'rejected')),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, vendor_id) references public.vendors(workspace_id, id)
);

create table public.venue_ceremonies (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  venue_id uuid not null,
  ceremony_id uuid not null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (venue_id, ceremony_id),
  foreign key (workspace_id, venue_id) references public.venues(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id) on delete cascade
);

create table public.food_drink_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ceremony_id uuid not null,
  vendor_id uuid,
  name text not null,
  service_type text not null check (service_type in ('caterer', 'bartender', 'combined', 'self_managed')),
  package_name text,
  package_price_minor bigint check (package_price_minor is null or package_price_minor >= 0),
  currency public.currency_code not null default 'NGN',
  guest_count integer check (guest_count is null or guest_count >= 0),
  status text not null default 'option' check (status in ('option', 'shortlisted', 'selected', 'rejected')),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id),
  foreign key (workspace_id, vendor_id) references public.vendors(workspace_id, id)
);

create table public.menu_sections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null,
  name text not null,
  position integer not null default 0 check (position >= 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, plan_id) references public.food_drink_plans(workspace_id, id) on delete cascade
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  section_id uuid not null,
  name text not null,
  item_type text not null check (item_type in ('food', 'drink')),
  unit text,
  quantity numeric(12,3) check (quantity is null or quantity >= 0),
  unit_price_minor bigint check (unit_price_minor is null or unit_price_minor >= 0),
  currency public.currency_code not null default 'NGN',
  serves_count integer check (serves_count is null or serves_count > 0),
  notes text,
  position integer not null default 0 check (position >= 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, section_id) references public.menu_sections(workspace_id, id) on delete cascade
);

create table public.wedding_party_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  guest_id uuid,
  name text not null,
  email text,
  phone text,
  role text not null,
  processional_order integer check (processional_order is null or processional_order >= 0),
  escort_name text,
  responsibilities text,
  outfit_status text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, guest_id) references public.guests(workspace_id, id)
);

create table public.wedding_party_ceremonies (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null,
  ceremony_id uuid not null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (member_id, ceremony_id),
  foreign key (workspace_id, member_id) references public.wedding_party_members(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id) on delete cascade
);

create table public.wedding_party_tasks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null,
  task_id uuid not null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (member_id, task_id),
  foreign key (workspace_id, member_id) references public.wedding_party_members(workspace_id, id) on delete cascade,
  foreign key (workspace_id, task_id) references public.tasks(workspace_id, id) on delete cascade
);

create table public.attire_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  group_type text not null check (group_type in ('aso_ebi', 'groomsmen', 'bridesmaids', 'parents', 'family', 'couple', 'other')),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);

create table public.attire_looks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attire_group_id uuid,
  ceremony_id uuid not null,
  wearer_type text not null check (wearer_type in ('guest', 'wedding_party', 'timmy', 'bisola', 'family', 'group')),
  name text not null,
  outfit_type text,
  fabric text,
  color text,
  accessories text,
  designer_vendor_id uuid,
  tailor_vendor_id uuid,
  supplier_vendor_id uuid,
  standard_size text,
  fit_notes text,
  production_status text not null default 'planned' check (production_status in ('planned', 'ordered', 'in_production', 'ready', 'collected', 'cancelled')),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, attire_group_id) references public.attire_groups(workspace_id, id),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id),
  foreign key (workspace_id, designer_vendor_id) references public.vendors(workspace_id, id),
  foreign key (workspace_id, tailor_vendor_id) references public.vendors(workspace_id, id),
  foreign key (workspace_id, supplier_vendor_id) references public.vendors(workspace_id, id)
);

create table public.attire_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attire_group_id uuid,
  supplier_vendor_id uuid,
  sku text,
  name text not null,
  item_type text not null,
  unit text not null,
  reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0),
  unit_cost_minor bigint check (unit_cost_minor is null or unit_cost_minor >= 0),
  selling_price_minor bigint check (selling_price_minor is null or selling_price_minor >= 0),
  currency public.currency_code not null default 'NGN',
  quantity_ordered numeric(12,3) not null default 0 check (quantity_ordered >= 0),
  quantity_received numeric(12,3) not null default 0 check (quantity_received >= 0),
  expected_delivery_date date,
  actual_delivery_date date,
  purchase_order_reference text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, attire_group_id) references public.attire_groups(workspace_id, id),
  foreign key (workspace_id, supplier_vendor_id) references public.vendors(workspace_id, id)
);
create unique index attire_items_sku_uidx on public.attire_items(workspace_id, sku) where sku is not null and deleted_at is null;

create table public.attire_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attire_item_id uuid not null,
  movement_type text not null check (movement_type in ('receipt', 'reservation', 'release', 'distribution', 'return', 'adjustment')),
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  occurred_at timestamptz not null default now(),
  reason text,
  reference text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, attire_item_id) references public.attire_items(workspace_id, id)
);

create table public.attire_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ceremony_id uuid not null,
  attire_group_id uuid,
  guest_id uuid,
  wedding_party_member_id uuid,
  recipient_name text not null,
  tailor_vendor_id uuid,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'in_production', 'ready', 'part_distributed', 'completed', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'deposit_paid', 'part_paid', 'paid', 'refunded')),
  currency public.currency_code not null default 'NGN',
  agreed_total_minor bigint not null default 0 check (agreed_total_minor >= 0),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id),
  foreign key (workspace_id, attire_group_id) references public.attire_groups(workspace_id, id),
  foreign key (workspace_id, guest_id) references public.guests(workspace_id, id),
  foreign key (workspace_id, wedding_party_member_id) references public.wedding_party_members(workspace_id, id),
  foreign key (workspace_id, tailor_vendor_id) references public.vendors(workspace_id, id),
  check (num_nonnulls(guest_id, wedding_party_member_id) <= 1)
);

create table public.attire_order_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attire_order_id uuid not null,
  attire_item_id uuid not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit text not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, attire_order_id) references public.attire_orders(workspace_id, id) on delete cascade,
  foreign key (workspace_id, attire_item_id) references public.attire_items(workspace_id, id)
);

create table public.attire_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attire_order_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency_code not null,
  paid_on date not null,
  exchange_rate numeric(20,10) not null check (exchange_rate > 0),
  rate_source text not null,
  rate_retrieved_at timestamptz not null,
  ngn_minor bigint not null check (ngn_minor >= 0),
  method text,
  reference text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, attire_order_id) references public.attire_orders(workspace_id, id) on delete cascade
);

create table public.attire_fittings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attire_order_id uuid not null,
  scheduled_at timestamptz not null,
  location text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'rescheduled')),
  fit_notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, attire_order_id) references public.attire_orders(workspace_id, id) on delete cascade
);

create table public.attire_distributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attire_order_item_id uuid not null,
  quantity numeric(12,3) not null check (quantity > 0),
  distributed_at timestamptz not null default now(),
  collected_by text,
  status text not null default 'distributed' check (status in ('ready', 'distributed', 'collected', 'returned')),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, attire_order_item_id) references public.attire_order_items(workspace_id, id)
);

create table public.traditional_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ceremony_id uuid not null,
  category text not null,
  item_name text not null,
  description text,
  required_quantity numeric(12,3) not null default 1 check (required_quantity > 0),
  unit text not null default 'piece',
  responsible_party text,
  supplier_vendor_id uuid,
  estimated_minor bigint check (estimated_minor is null or estimated_minor >= 0),
  actual_minor bigint check (actual_minor is null or actual_minor >= 0),
  currency public.currency_code not null default 'NGN',
  exchange_rate numeric(20,10) check (exchange_rate is null or exchange_rate > 0),
  rate_source text,
  rate_retrieved_at timestamptz,
  ngn_actual_minor bigint check (ngn_actual_minor is null or ngn_actual_minor >= 0),
  due_date date,
  status text not null default 'outstanding' check (status in ('outstanding', 'ordered', 'sourced', 'delivered', 'approved', 'complete', 'cancelled')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'accepted', 'rejected', 'not_required')),
  delivery_recipient text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id),
  foreign key (workspace_id, supplier_vendor_id) references public.vendors(workspace_id, id),
  check (
    (actual_minor is null and exchange_rate is null and rate_source is null and rate_retrieved_at is null and ngn_actual_minor is null)
    or
    (actual_minor is not null and exchange_rate is not null and rate_source is not null and rate_retrieved_at is not null and ngn_actual_minor is not null)
  )
);

create or replace function public.validate_traditional_requirement_ceremony()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ceremonies
    where id = new.ceremony_id and workspace_id = new.workspace_id and kind = 'traditional'
  ) then
    raise exception 'Traditional requirements must belong to the Traditional ceremony';
  end if;
  return new;
end;
$$;
create trigger traditional_requirements_validate before insert or update on public.traditional_requirements
for each row execute function public.validate_traditional_requirement_ceremony();

create table public.traditional_requirement_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requirement_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency_code not null,
  paid_on date not null,
  exchange_rate numeric(20,10) not null check (exchange_rate > 0),
  rate_source text not null,
  rate_retrieved_at timestamptz not null,
  ngn_minor bigint not null check (ngn_minor >= 0),
  method text,
  reference text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, requirement_id) references public.traditional_requirements(workspace_id, id) on delete cascade
);

create table public.traditional_requirement_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requirement_id uuid not null,
  quantity numeric(12,3) not null check (quantity > 0),
  delivered_at timestamptz not null,
  recipient text not null,
  acceptance_status text not null default 'pending' check (acceptance_status in ('pending', 'accepted', 'rejected')),
  accepted_at timestamptz,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, requirement_id) references public.traditional_requirements(workspace_id, id) on delete cascade
);

create table public.seating_tables (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ceremony_id uuid not null,
  name text not null,
  table_number integer,
  capacity integer not null check (capacity > 0),
  position_x numeric(10,2),
  position_y numeric(10,2),
  is_locked boolean not null default false,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id)
);
create unique index seating_tables_name_uidx on public.seating_tables(ceremony_id, lower(name)) where deleted_at is null;
create unique index seating_tables_number_uidx on public.seating_tables(ceremony_id, table_number) where table_number is not null and deleted_at is null;

create table public.seating_seats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  table_id uuid not null,
  seat_number integer not null check (seat_number > 0),
  label text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, table_id) references public.seating_tables(workspace_id, id) on delete cascade
);
create unique index seating_seats_number_uidx on public.seating_seats(table_id, seat_number) where deleted_at is null;

create table public.seating_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ceremony_id uuid not null,
  table_id uuid not null,
  seat_id uuid,
  guest_id uuid not null,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id),
  foreign key (workspace_id, table_id) references public.seating_tables(workspace_id, id),
  foreign key (workspace_id, seat_id) references public.seating_seats(workspace_id, id),
  foreign key (workspace_id, guest_id) references public.guests(workspace_id, id)
);
create unique index seating_assignments_guest_uidx on public.seating_assignments(ceremony_id, guest_id) where deleted_at is null;
create unique index seating_assignments_seat_uidx on public.seating_assignments(seat_id) where seat_id is not null and deleted_at is null;

create or replace function public.validate_seating_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  table_ceremony uuid;
  ceremony_type public.ceremony_kind;
begin
  select ceremony_id into table_ceremony from public.seating_tables where id = new.table_id;
  if table_ceremony <> new.ceremony_id then
    raise exception 'Seating table must belong to the assignment ceremony';
  end if;
  if new.seat_id is not null and not exists (
    select 1 from public.seating_seats where id = new.seat_id and table_id = new.table_id
  ) then
    raise exception 'Seat must belong to the assignment table';
  end if;
  select kind into ceremony_type from public.ceremonies where id = new.ceremony_id;
  if ceremony_type not in ('traditional', 'white') then
    raise exception 'Seating is only available for Traditional and White ceremonies';
  end if;
  return new;
end;
$$;
create trigger seating_assignments_validate before insert or update on public.seating_assignments
for each row execute function public.validate_seating_scope();

create or replace function public.validate_seating_table_ceremony()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ceremonies
    where id = new.ceremony_id and kind in ('traditional', 'white')
  ) then
    raise exception 'Seating is only available for Traditional and White ceremonies';
  end if;
  return new;
end;
$$;
create trigger seating_tables_validate before insert or update on public.seating_tables
for each row execute function public.validate_seating_table_ceremony();

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ceremony_id uuid not null,
  ceremony_segment_id uuid,
  venue_id uuid,
  vendor_id uuid,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  responsible_person text,
  contact_information text,
  details text,
  notes text,
  status text not null default 'planned' check (status in ('planned', 'confirmed', 'completed', 'cancelled')),
  position integer not null default 0 check (position >= 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id),
  foreign key (ceremony_id, ceremony_segment_id) references public.ceremony_segments(ceremony_id, id),
  foreign key (workspace_id, venue_id) references public.venues(workspace_id, id),
  foreign key (workspace_id, vendor_id) references public.vendors(workspace_id, id),
  check (ends_at is null or ends_at >= starts_at)
);

create table public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ceremony_id uuid,
  title text not null,
  entry_type text not null check (entry_type in ('custom', 'task', 'ceremony_segment', 'vendor_appointment', 'payment', 'honeymoon')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  source_table text,
  source_id uuid,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id),
  check (ends_at is null or ends_at >= starts_at),
  check ((source_table is null) = (source_id is null))
);

create table public.packing_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ceremony_id uuid,
  name text not null,
  list_type text not null check (list_type in ('ceremony', 'wedding_weekend', 'honeymoon', 'custom')),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id)
);

create table public.packing_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  packing_list_id uuid not null,
  category text not null,
  name text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  responsible_person text,
  packed boolean not null default false,
  packed_at timestamptz,
  notes text,
  position integer not null default 0 check (position >= 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, packing_list_id) references public.packing_lists(workspace_id, id) on delete cascade,
  check (packed or packed_at is null)
);

create table public.packing_item_ceremonies (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  packing_item_id uuid not null,
  ceremony_id uuid not null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (packing_item_id, ceremony_id),
  foreign key (workspace_id, packing_item_id) references public.packing_items(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id) on delete cascade
);

create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  guest_id uuid,
  ceremony_id uuid,
  giver_name text,
  description text not null,
  gift_type text not null check (gift_type in ('cash', 'physical', 'service', 'other')),
  cash_amount_minor bigint check (cash_amount_minor is null or cash_amount_minor >= 0),
  currency public.currency_code,
  exchange_rate numeric(20,10) check (exchange_rate is null or exchange_rate > 0),
  rate_source text,
  rate_retrieved_at timestamptz,
  ngn_minor bigint check (ngn_minor is null or ngn_minor >= 0),
  received_on date not null,
  thank_you_status text not null default 'pending' check (thank_you_status in ('pending', 'written', 'sent', 'not_required')),
  thank_you_sent_on date,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, guest_id) references public.guests(workspace_id, id),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id),
  check (gift_type = 'cash' or cash_amount_minor is null),
  check (
    (cash_amount_minor is null and currency is null and exchange_rate is null and rate_source is null and rate_retrieved_at is null and ngn_minor is null)
    or
    (cash_amount_minor is not null and currency is not null and exchange_rate is not null and rate_source is not null and rate_retrieved_at is not null and ngn_minor is not null)
  )
);

create table public.honeymoon_trips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  destinations text[] not null default '{}',
  start_date date,
  end_date date,
  budget_minor bigint check (budget_minor is null or budget_minor >= 0),
  currency public.currency_code not null default 'NGN',
  status text not null default 'planning' check (status in ('planning', 'booked', 'in_progress', 'completed', 'cancelled')),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.honeymoon_bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trip_id uuid not null,
  booking_type text not null check (booking_type in ('flight', 'accommodation', 'transport', 'activity', 'insurance', 'other')),
  provider text,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  booking_reference text,
  contact_details text,
  status text not null default 'planned' check (status in ('planned', 'reserved', 'confirmed', 'completed', 'cancelled')),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency public.currency_code,
  exchange_rate numeric(20,10) check (exchange_rate is null or exchange_rate > 0),
  rate_source text,
  rate_retrieved_at timestamptz,
  ngn_minor bigint check (ngn_minor is null or ngn_minor >= 0),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, trip_id) references public.honeymoon_trips(workspace_id, id) on delete cascade,
  check (ends_at is null or starts_at is null or ends_at >= starts_at),
  check (
    (amount_minor is null and currency is null and exchange_rate is null and rate_source is null and rate_retrieved_at is null and ngn_minor is null)
    or
    (amount_minor is not null and currency is not null and exchange_rate is not null and rate_source is not null and rate_retrieved_at is not null and ngn_minor is not null)
  )
);

create table public.honeymoon_expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trip_id uuid not null,
  booking_id uuid,
  description text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency public.currency_code not null,
  transaction_date date not null,
  exchange_rate numeric(20,10) not null check (exchange_rate > 0),
  rate_source text not null,
  rate_retrieved_at timestamptz not null,
  ngn_minor bigint not null check (ngn_minor >= 0),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, trip_id) references public.honeymoon_trips(workspace_id, id) on delete cascade,
  foreign key (workspace_id, booking_id) references public.honeymoon_bookings(workspace_id, id)
);

create table public.honeymoon_itinerary_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trip_id uuid not null,
  booking_id uuid,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  details text,
  position integer not null default 0 check (position >= 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, trip_id) references public.honeymoon_trips(workspace_id, id) on delete cascade,
  foreign key (workspace_id, booking_id) references public.honeymoon_bookings(workspace_id, id),
  check (ends_at is null or ends_at >= starts_at)
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ceremony_id uuid,
  vendor_id uuid,
  bucket_id text not null,
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  category text not null,
  related_table text,
  related_id uuid,
  description text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  unique (bucket_id, storage_path),
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id),
  foreign key (workspace_id, vendor_id) references public.vendors(workspace_id, id),
  check ((related_table is null) = (related_id is null))
);

create table public.file_ceremonies (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_id uuid not null,
  ceremony_id uuid not null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (file_id, ceremony_id),
  foreign key (workspace_id, file_id) references public.files(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ceremony_id) references public.ceremonies(workspace_id, id) on delete cascade
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id),
  notification_type text not null,
  channel text not null check (channel in ('in_app', 'email')),
  title text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'scheduled', 'sent', 'read', 'failed', 'cancelled')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  source_table text,
  source_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  failure_reason text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, recipient_id) references public.workspace_members(workspace_id, profile_id),
  check ((source_table is null) = (source_id is null))
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  email_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  default_lead_minutes integer check (default_lead_minutes is null or default_lead_minutes >= 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, profile_id) references public.workspace_members(workspace_id, profile_id) on delete cascade
);
create unique index notification_preferences_type_uidx
  on public.notification_preferences(workspace_id, profile_id, notification_type) where deleted_at is null;

create table public.email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  notification_id uuid,
  provider text not null default 'resend',
  provider_message_id text,
  recipient_email text not null,
  subject text not null,
  template_key text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  error_message text,
  provider_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_payload) = 'object'),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, notification_id) references public.notifications(workspace_id, id)
);
create unique index email_delivery_provider_id_uidx
  on public.email_delivery_logs(provider, provider_message_id) where provider_message_id is not null;

-- Operational indexes for workspace lists, relationships, deadlines, and reporting.
create index import_rows_batch_status_idx on public.import_rows(import_batch_id, status) where deleted_at is null;
create index invitations_ceremony_rsvp_idx on public.guest_invitations(ceremony_id, rsvp_status) where deleted_at is null;
create index rsvp_submissions_invitation_idx on public.rsvp_submissions(invitation_id, submitted_at desc) where deleted_at is null;
create index budget_allocations_budget_idx on public.budget_allocations(budget_id) where deleted_at is null;
create index expenses_workspace_date_idx on public.expenses(workspace_id, transaction_date desc) where deleted_at is null;
create index expenses_vendor_idx on public.expenses(vendor_id) where vendor_id is not null and deleted_at is null;
create index payment_schedules_due_idx on public.payment_schedules(workspace_id, due_date) where deleted_at is null and status not in ('paid', 'waived');
create index expense_payments_expense_idx on public.expense_payments(expense_id, paid_on) where deleted_at is null;
create index contributions_workspace_date_idx on public.contributions(workspace_id, received_on desc) where deleted_at is null;
create index vendor_appointments_start_idx on public.vendor_appointments(workspace_id, starts_at) where deleted_at is null;
create index venues_workspace_status_idx on public.venues(workspace_id, selection_status) where deleted_at is null;
create index food_plans_ceremony_idx on public.food_drink_plans(ceremony_id) where deleted_at is null;
create index attire_movements_item_date_idx on public.attire_inventory_movements(attire_item_id, occurred_at) where deleted_at is null;
create index attire_orders_status_idx on public.attire_orders(workspace_id, status, payment_status) where deleted_at is null;
create index attire_payments_order_idx on public.attire_payments(attire_order_id, paid_on) where deleted_at is null;
create index attire_fittings_date_idx on public.attire_fittings(workspace_id, scheduled_at) where deleted_at is null;
create index traditional_requirements_status_idx on public.traditional_requirements(workspace_id, status, due_date) where deleted_at is null;
create index traditional_payments_requirement_idx on public.traditional_requirement_payments(requirement_id, paid_on) where deleted_at is null;
create index seating_assignments_table_idx on public.seating_assignments(table_id) where deleted_at is null;
create index itinerary_ceremony_start_idx on public.itinerary_items(ceremony_id, starts_at) where deleted_at is null;
create index calendar_workspace_start_idx on public.calendar_entries(workspace_id, starts_at) where deleted_at is null;
create index packing_items_list_idx on public.packing_items(packing_list_id, packed) where deleted_at is null;
create index gifts_workspace_received_idx on public.gifts(workspace_id, received_on desc) where deleted_at is null;
create index honeymoon_bookings_trip_idx on public.honeymoon_bookings(trip_id, starts_at) where deleted_at is null;
create index files_workspace_category_idx on public.files(workspace_id, category) where deleted_at is null;
create index files_related_idx on public.files(workspace_id, related_table, related_id) where deleted_at is null;
create index notifications_recipient_status_idx on public.notifications(recipient_id, status, scheduled_for) where deleted_at is null;
create index email_delivery_status_idx on public.email_delivery_logs(workspace_id, status, created_at) where deleted_at is null;

-- Apply timestamps and workspace-member RLS consistently to every new private table.
do $$
declare
  table_name text;
  domain_tables constant text[] := array[
    'import_batches', 'guests', 'guest_tags', 'guest_accommodations', 'guest_invitations',
    'rsvp_submissions', 'import_rows', 'exchange_rates', 'budgets', 'budget_allocations',
    'vendors', 'vendor_contacts', 'vendor_quotes', 'vendor_appointments', 'expenses',
    'payment_schedules', 'expense_payments', 'contributions', 'contribution_allocations',
    'venues', 'food_drink_plans', 'menu_sections', 'menu_items', 'wedding_party_members',
    'attire_groups', 'attire_looks', 'attire_items', 'attire_inventory_movements',
    'attire_orders', 'attire_order_items', 'attire_payments', 'attire_fittings',
    'attire_distributions', 'traditional_requirements', 'traditional_requirement_payments',
    'traditional_requirement_deliveries', 'seating_tables', 'seating_seats',
    'seating_assignments', 'itinerary_items', 'calendar_entries', 'packing_lists',
    'packing_items', 'gifts', 'honeymoon_trips', 'honeymoon_bookings',
    'honeymoon_expenses', 'honeymoon_itinerary_items', 'files', 'notifications',
    'notification_preferences', 'email_delivery_logs'
  ];
  junction_tables constant text[] := array[
    'guest_tag_assignments', 'vendor_ceremonies', 'expense_ceremonies',
    'venue_ceremonies', 'wedding_party_ceremonies', 'wedding_party_tasks',
    'packing_item_ceremonies', 'file_ceremonies'
  ];
begin
  foreach table_name in array domain_tables loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))',
      table_name || '_workspace_all', table_name
    );
  end loop;

  foreach table_name in array junction_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))',
      table_name || '_workspace_all', table_name
    );
  end loop;
end;
$$;
