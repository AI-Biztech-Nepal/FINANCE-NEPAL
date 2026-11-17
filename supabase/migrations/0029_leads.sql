-- Leads: the people who came to the shop and are kept on the All In One Abroad account's Leads page, the way Auto Stock
-- Manager keeps its CRM leads. A lead is made from the Record Sale form's "Lead" block - saving a sale writes the buyer in
-- as Converted - and is then followed on the Leads page. One row per person, with a status, where they came from, what
-- they want, the day to follow up, and a history of every contact (call, WhatsApp, visit, note, sale) as a small list.
-- Owner-scoped like every other finance table. Safe to run more than once.
begin;

create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id),
  -- The customer record the lead became when a sale was recorded for them (the Record Sale form's "Lead" block).
  customer_id   uuid references public.customers(id) on delete set null,
  name          text not null,
  phone         text,
  address       text,
  source        text not null default 'walk_in' check (source in ('walk_in', 'website', 'facebook', 'tiktok', 'referral', 'other')),
  source_note   text,
  interested_in text,
  status        text not null default 'new' check (status in ('new', 'contacted', 'interested', 'converted', 'lost')),
  follow_up_on  date,
  -- [{ "kind": "call" | "whatsapp" | "visit" | "note" | "sale", "note": "...", "at": "<timestamp>" }], oldest first.
  history       jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- `create table if not exists` leaves a table that is already there as it is, so a database that ran the first version of
-- this file (before customer_id was added) gets the column here.
alter table public.leads
  add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists leads_owner_status_idx on public.leads (owner_id, status);

alter table public.leads enable row level security;
drop policy if exists leads_owner on public.leads;
create policy leads_owner on public.leads for all
  using (owner_id = public.finance_current_owner())
  with check (owner_id = public.finance_current_owner());

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
  for each row execute function public.finance_touch_updated_at();
drop trigger if exists leads_stamp_owner on public.leads;
create trigger leads_stamp_owner before insert on public.leads
  for each row execute function public.finance_stamp_owner();

commit;

-- Makes the API see the new column straight away instead of after its cache refreshes.
notify pgrst, 'reload schema';
