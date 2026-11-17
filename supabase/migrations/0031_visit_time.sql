-- Visits: how long each visitor stayed, and where. Builds on 0030_marketing.sql. Safe to run more than once.
--
-- Until now the website sent one row per page opened. It now also tells us how many seconds the person was really on that
-- page (tab in view and not idle - counted by website/visit-tracker.js), by calling record_visit again for the same page
-- view as time goes by. A "visit" on the Visits tab is one visitor's run of pages with less than 30 minutes between them
-- (visits_list below).
begin;

alter table public.site_visits
  add column if not exists view_id uuid,
  add column if not exists seconds integer not null default 0 check (seconds >= 0);

-- A page view is named by a random id made in the visitor's browser. Whoever knows it can add time to that one row and
-- nothing else, which is why it is a uuid and not the table's own counting id.
create unique index if not exists site_visits_view_idx on public.site_visits (owner_id, view_id) where view_id is not null;
create index if not exists site_visits_visitor_idx on public.site_visits (owner_id, visitor, created_at);

-- ---------------------------------------------------------------------
-- record_visit: the same five arguments as before, plus the page view's id and the seconds spent so far.
-- Old website code (five arguments, no id) still works and records a page with no time, as it did.
-- The first call for an id adds the row; every later call raises its seconds, never lowers them, and never to more than
-- the time that has really passed since the row was added (+5 s), so a number cannot be made up.
-- ---------------------------------------------------------------------
drop function if exists public.record_visit(uuid, text, text, text, text);

create or replace function public.record_visit(
  p_owner uuid, p_visitor text, p_path text, p_referrer text, p_device text,
  p_view uuid default null, p_seconds integer default 0
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_seconds integer := least(greatest(coalesce(p_seconds, 0), 0), 14400);
begin
  if not exists (select 1 from public.profiles where id = p_owner) then
    return;
  end if;
  insert into public.site_visits as sv (owner_id, visitor, path, referrer, device, view_id, seconds)
  values (
    p_owner,
    left(coalesce(nullif(btrim(p_visitor), ''), 'unknown'), 64),
    left(coalesce(nullif(btrim(p_path), ''), '/'), 200),
    nullif(left(btrim(coalesce(p_referrer, '')), 120), ''),
    case when p_device in ('mobile', 'tablet') then p_device else 'desktop' end,
    p_view,
    case when p_view is null then 0 else least(v_seconds, 120) end
  )
  on conflict (owner_id, view_id) where view_id is not null do update
    set seconds = greatest(sv.seconds, least(v_seconds, extract(epoch from now() - sv.created_at)::integer + 5));
end $$;

revoke all on function public.record_visit(uuid, text, text, text, text, uuid, integer) from public;
grant execute on function public.record_visit(uuid, text, text, text, text, uuid, integer) to anon, authenticated;

-- ---------------------------------------------------------------------
-- visits_list: the visits for a period, newest first. Runs as the signed-in user, so row level security keeps it to the
-- company's own visits. Per visit: who (the visitor's id), when it began, how many seconds in all, the device, where they
-- came from, and each page in the order opened with the seconds spent on it.
-- 'sessions' and 'avg_seconds' cover the whole period; 'visits' is cut to the newest p_limit (at most 500).
-- avg_seconds leaves out visits with no time recorded (pages opened before the website began sending it).
-- ---------------------------------------------------------------------
create or replace function public.visits_list(p_from timestamptz, p_to timestamptz, p_limit integer default 100)
returns jsonb
language sql stable set search_path = public as $$
  with v as (
    select id, visitor, path, referrer, device, created_at, seconds,
           lag(created_at + seconds * interval '1 second') over (partition by visitor order by created_at, id) as prev_end
      from public.site_visits
     where owner_id = public.finance_current_owner() and created_at >= p_from and created_at < p_to
  ),
  s as (
    select *,
           sum(case when prev_end is null or created_at - prev_end > interval '30 minutes' then 1 else 0 end)
             over (partition by visitor order by created_at, id) as n
      from v
  ),
  g as (
    select visitor, n,
           min(created_at) as started_at,
           sum(seconds)::integer as seconds,
           (array_agg(device order by created_at, id))[1] as device,
           (array_agg(referrer order by created_at, id))[1] as referrer,
           jsonb_agg(jsonb_build_object('path', path, 'at', created_at, 'seconds', seconds) order by created_at, id) as pages
      from s
     group by visitor, n
  )
  select jsonb_build_object(
    'sessions', (select count(*) from g),
    'avg_seconds', coalesce((select round(avg(seconds)) from g where seconds > 0), 0),
    'visits', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.started_at desc)
        from (select visitor, started_at, seconds, device, referrer, pages
                from g order by started_at desc
               limit greatest(1, least(coalesce(p_limit, 100), 500))) t
    ), '[]'::jsonb)
  )
$$;
revoke all on function public.visits_list(timestamptz, timestamptz, integer) from public;
grant execute on function public.visits_list(timestamptz, timestamptz, integer) to authenticated;

commit;

notify pgrst, 'reload schema';
