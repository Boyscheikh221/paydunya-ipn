-- =====================================================================
-- 19 — Fiche produit : référence (SKU), poids, titre/description Google, avis clients (22/11/2026)
--   * Brouillon / publié = colonne existante products.active (brouillon = caché du site).
--   * Avis : seuls les acheteurs peuvent noter (depuis leur page de commande, 1 avis par article).
--     Chaque avis attend la validation de l'admin avant d'être affiché.
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================

alter table public.products add column if not exists sku text;
alter table public.products add column if not exists weight_g int;
alter table public.products add column if not exists seo_title text;
alter table public.products add column if not exists seo_description text;
alter table public.products drop constraint if exists products_weight_check;
alter table public.products add constraint products_weight_check check (weight_g is null or weight_g >= 0);
create unique index if not exists products_sku_uniq on public.products (lower(sku)) where sku is not null and sku <> '';

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  order_item_id uuid unique references public.order_items(id) on delete set null,
  name text not null,
  rating int not null check (rating between 1 and 5),
  comment text,
  status text not null default 'pending' check (status in ('pending','approved','hidden')),
  reply text,
  created_at timestamptz not null default now()
);
create index if not exists product_reviews_product on public.product_reviews (product_id, status, created_at desc);
alter table public.product_reviews enable row level security;
revoke all on public.product_reviews from anon, authenticated;

-- ---------- Livraison des produits physiques (Dakar : domicile ou bus ; hors Dakar : WhatsApp) ----------
alter table public.orders add column if not exists shipping_method text;
alter table public.orders add column if not exists shipping_fee_fcfa int not null default 0;
alter table public.orders add column if not exists shipping_address text;
alter table public.orders add column if not exists shipping_zone text;
alter table public.orders add column if not exists shipping_lat double precision;
alter table public.orders add column if not exists shipping_lng double precision;
alter table public.orders drop constraint if exists orders_shipping_method_check;
alter table public.orders add constraint orders_shipping_method_check check (shipping_method is null or shipping_method in ('home','bus'));

insert into public.settings (key, value) values ('shipping_home_fcfa', '1500'::jsonb), ('shipping_bus_fcfa', '1000'::jsonb)
  on conflict (key) do nothing;
