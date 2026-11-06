-- Leads: people who asked about the shop's products and are being followed up (the All In One Abroad account's Leads
-- page, kept the way Auto Stock Manager keeps its CRM leads). One row per person, with a status, where they came from,
-- what they want, the day to follow up, and a history of every contact (call, WhatsApp, visit, note) as a small list.
-- Owner-scoped like every other finance table. Safe to run more than once.
begin;

create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id),
  name          text not null,
  phone         text,
  address       text,
  source        text not null default 'walk_in' check (source in ('walk_in', 'website', 'facebook', 'tiktok', 'referral', 'other')),
  source_note   text,
  interested_in text,
  status        text not null default 'new' check (status in ('new', 'contacted', 'interested', 'converted', 'lost')),
  follow_up_on  date,
  -- [{ "kind": "call" | "whatsapp" | "visit" | "note", "note": "...", "at": "<timestamp>" }], oldest first.
  history       jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
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
