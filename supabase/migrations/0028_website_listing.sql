-- Items listed on a company's own website (All In One Abroad -> allinoneabroad.com).
-- Stock and Inventory gets a "Show on website" switch, a photo, a category and a short description per item; the
-- site asks website_products() for what is switched on and keeps its own shop in step with it.
-- Safe to run more than once.
begin;

alter table public.products
  add column if not exists show_on_website boolean not null default false,
  add column if not exists website_category text check (website_category in ('luggage', 'kitchen', 'appliances')),
  add column if not exists image_url text,
  add column if not exists description text,
  add column if not exists original_price numeric check (original_price is null or original_price >= 0);

-- The item photos: a public bucket, one folder per account, the same shape as business-assets (0011).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists product_photos_insert_own on storage.objects;
create policy product_photos_insert_own on storage.objects
  for insert with check (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists product_photos_select_public on storage.objects;
create policy product_photos_select_public on storage.objects
  for select using (bucket_id = 'product-photos');

drop policy if exists product_photos_delete_own on storage.objects;
create policy product_photos_delete_own on storage.objects
  for delete using (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- What the website may read: only the public fields of one company's switched-on items - never the cost price,
-- SKU, barcode or anything from the books. An item with no photo, no category or no selling price is left out
-- (the site cannot show it). Runs as the function's owner, so the site needs no login, only the company's id.
create or replace function public.website_products(p_owner uuid)
returns table (
  id uuid,
  name text,
  category text,
  price numeric,
  original_price numeric,
  stock integer,
  image text,
  description text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.website_category,
    p.price,
    p.original_price,
    greatest(floor(p.stock_level), 0)::integer,
    p.image_url,
    left(coalesce(p.description, ''), 255)
  from public.products p
  where p.owner_id = p_owner
    and p.is_active
    and p.show_on_website
    and p.website_category is not null
    and coalesce(p.image_url, '') <> ''
    and p.price > 0
  order by p.created_at, p.id
$$;

revoke all on function public.website_products(uuid) from public;
grant execute on function public.website_products(uuid) to anon, authenticated;

commit;
