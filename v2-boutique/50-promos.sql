-- 50 — Promos programmées (onglet « 🏷️ Promos » de l'admin)
--   Une promo baisse le prix de certains produits entre deux dates : en % , d'un montant, ou à un prix fixe.
--   Le prix normal du produit ne change pas : la boutique calcule le prix promo à la volée et affiche
--   l'ancien prix barré. Jamais sous le prix de gros (parrainage) ni sous 100 FCFA.
--   Plusieurs promos sur un même produit : le prix le plus bas gagne.
create table if not exists public.promotions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  kind         text not null default 'percent' check (kind in ('percent', 'amount', 'fixed')),
  value        int  not null check (value > 0),
  scope        text not null default 'products' check (scope in ('all', 'categories', 'products')),
  category_ids uuid[] not null default '{}',
  product_ids  uuid[] not null default '{}',
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (kind <> 'percent' or value <= 90),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists promotions_active on public.promotions (active, starts_at, ends_at);
alter table public.promotions enable row level security;
revoke all on table public.promotions from anon, authenticated;
grant all on table public.promotions to service_role;

-- prix catalogue d'un article au moment de la commande (pour savoir qu'il était en promo)
alter table public.order_items add column if not exists promo_name text;
