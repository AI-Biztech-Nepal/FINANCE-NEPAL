-- Marketing for the All In One Abroad account: Offers (a prize wheel on the website) and Visits (who visits it).
-- The website is not signed in, so it can only call the few functions below; the tables themselves stay private to the
-- company (owner-scoped like every other finance table). Safe to run more than once.
begin;

-- ---------------------------------------------------------------------
-- OFFERS: the prizes on the wheel, and who has spun.
-- ---------------------------------------------------------------------
create table if not exists public.offer_prizes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id),
  name       text not null,
  -- How likely it is against the others: a prize of weight 2 comes up twice as often as one of weight 1.
  weight     numeric not null default 1 check (weight >= 0),
  stock      integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One spin per mobile number (digits only); the unique key also stops two spins arriving at once.
create table if not exists public.offer_spins (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id),
  name       text not null,
  phone      text not null,
  prize      text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, phone)
);

-- ---------------------------------------------------------------------
-- VISITS: one row per page opened on the website.
-- ---------------------------------------------------------------------
create table if not exists public.site_visits (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null references auth.users(id),
  visitor    text not null,
  path       text not null,
  referrer   text,
  device     text not null default 'desktop' check (device in ('mobile', 'tablet', 'desktop')),
  created_at timestamptz not null default now()
);
create index if not exists site_visits_owner_time_idx on public.site_visits (owner_id, created_at desc);

-- ---------------------------------------------------------------------
-- Row level security: the company reads and manages its own rows. Nothing here is open to the public.
-- ---------------------------------------------------------------------
alter table public.offer_prizes enable row level security;
drop policy if exists offer_prizes_owner on public.offer_prizes;
create policy offer_prizes_owner on public.offer_prizes for all
  using (owner_id = public.finance_current_owner())
  with check (owner_id = public.finance_current_owner());

alter table public.offer_spins enable row level security;
drop policy if exists offer_spins_owner_read on public.offer_spins;
create policy offer_spins_owner_read on public.offer_spins for select using (owner_id = public.finance_current_owner());
drop policy if exists offer_spins_owner_delete on public.offer_spins;
create policy offer_spins_owner_delete on public.offer_spins for delete using (owner_id = public.finance_current_owner());

alter table public.site_visits enable row level security;
drop policy if exists site_visits_owner_read on public.site_visits;
create policy site_visits_owner_read on public.site_visits for select using (owner_id = public.finance_current_owner());

drop trigger if exists offer_prizes_touch on public.offer_prizes;
create trigger offer_prizes_touch before update on public.offer_prizes
  for each row execute function public.finance_touch_updated_at();
drop trigger if exists offer_prizes_stamp_owner on public.offer_prizes;
create trigger offer_prizes_stamp_owner before insert on public.offer_prizes
  for each row execute function public.finance_stamp_owner();

-- ---------------------------------------------------------------------
-- What the website may call (no sign-in). Each runs as the function's owner and does one narrow thing.
-- ---------------------------------------------------------------------

-- The prizes to draw on the wheel: names only (never stock or chances), the ones that can still be won.
create or replace function public.offer_prizes_public(p_owner uuid)
returns table (name text)
language sql stable security definer set search_path = public as $$
  select name from public.offer_prizes
  where owner_id = p_owner and stock > 0 and weight > 0
  order by created_at, id
$$;

-- One spin: checks the name and number, refuses a number that has spun already, picks a prize by weight among those in
-- stock, takes one off its stock and records the spin - all in one step, so two people cannot win the last prize.
create or replace function public.spin_wheel(p_owner uuid, p_name text, p_phone text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name  text := left(btrim(coalesce(p_name, '')), 80);
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_total numeric;
  v_pick  numeric;
  v_acc   numeric := 0;
  v_prize record;
begin
  if length(v_name) < 2 or length(v_phone) < 7 or length(v_phone) > 15 then
    return jsonb_build_object('ok', false, 'message', 'Enter your name and mobile number.');
  end if;
  if not exists (select 1 from public.profiles where id = p_owner) then
    return jsonb_build_object('ok', false, 'message', 'This offer is not available.');
  end if;
  if exists (select 1 from public.offer_spins where owner_id = p_owner and phone = v_phone) then
    return jsonb_build_object('ok', false, 'message', 'This number has already spun the wheel.');
  end if;

  -- Lock the prizes in stock so concurrent spins queue up instead of both taking the last one.
  select coalesce(sum(weight), 0) into v_total
    from (select weight from public.offer_prizes where owner_id = p_owner and stock > 0 and weight > 0 for update) t;
  if v_total <= 0 then
    return jsonb_build_object('ok', false, 'message', 'All the prizes have been won. Thank you!');
  end if;

  v_pick := random() * v_total;
  for v_prize in
    select id, name, weight from public.offer_prizes
    where owner_id = p_owner and stock > 0 and weight > 0 order by created_at, id
  loop
    v_acc := v_acc + v_prize.weight;
    if v_pick < v_acc then
      update public.offer_prizes set stock = stock - 1 where id = v_prize.id;
      insert into public.offer_spins (owner_id, name, phone, prize) values (p_owner, v_name, v_phone, v_prize.name);
      return jsonb_build_object('ok', true, 'prize', v_prize.name);
    end if;
  end loop;
  return jsonb_build_object('ok', false, 'message', 'Please try again.');
exception when unique_violation then
  return jsonb_build_object('ok', false, 'message', 'This number has already spun the wheel.');
end $$;

-- One page view from the website. Only for a company that exists; every text is cut to a sensible length.
create or replace function public.record_visit(p_owner uuid, p_visitor text, p_path text, p_referrer text, p_device text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = p_owner) then
    return;
  end if;
  insert into public.site_visits (owner_id, visitor, path, referrer, device)
  values (
    p_owner,
    left(coalesce(nullif(btrim(p_visitor), ''), 'unknown'), 64),
    left(coalesce(nullif(btrim(p_path), ''), '/'), 200),
    nullif(left(btrim(coalesce(p_referrer, '')), 120), ''),
    case when p_device in ('mobile', 'tablet') then p_device else 'desktop' end
  );
end $$;

revoke all on function public.offer_prizes_public(uuid) from public;
revoke all on function public.spin_wheel(uuid, text, text) from public;
revoke all on function public.record_visit(uuid, text, text, text, text) from public;
grant execute on function public.offer_prizes_public(uuid) to anon, authenticated;
grant execute on function public.spin_wheel(uuid, text, text) to anon, authenticated;
grant execute on function public.record_visit(uuid, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- What the Visits tab reads: the company's own totals for a period, worked out here in one call. Runs as the signed-in
-- user, so row level security keeps it to the company's own visits.
-- ---------------------------------------------------------------------
create or replace function public.visits_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable set search_path = public as $$
  with v as (
    select * from public.site_visits
    where owner_id = public.finance_current_owner() and created_at >= p_from and created_at < p_to
  )
  select jsonb_build_object(
    'visits', (select count(*) from v),
    'visitors', (select count(distinct visitor) from v),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('name', path, 'count', n) order by n desc)
      from (select path, count(*) n from v group by path order by n desc limit 8) t), '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(jsonb_build_object('name', r, 'count', n) order by n desc)
      from (select coalesce(referrer, 'Direct') r, count(*) n from v group by 1 order by n desc limit 8) t), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('name', device, 'count', n) order by n desc)
      from (select device, count(*) n from v group by device) t), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('name', d::text, 'count', n) order by d)
      from (select (created_at at time zone 'Asia/Kathmandu')::date d, count(*) n from v group by 1) t), '[]'::jsonb)
  )
$$;
revoke all on function public.visits_summary(timestamptz, timestamptz) from public;
grant execute on function public.visits_summary(timestamptz, timestamptz) to authenticated;

commit;

notify pgrst, 'reload schema';
