-- =====================================================================
-- 21 — Comptes clients (22/11/2026)
--   Connexion par email (lien magique, sans mot de passe). La commande sans compte reste possible :
--   les commandes sont rattachées au compte par l'adresse email.
--   Favoris, centres d'intérêt (catégories), historique de visites et de recherches
--   (enregistré seulement si le visiteur a accepté les cookies).
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text,
  phone         text,
  interests     text[] not null default '{}',   -- slugs de catégories
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.customer_sessions (
  token_hash  text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  kind        text not null check (kind in ('login','session')),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.customer_favorites (
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (customer_id, product_id)
);

-- visites de fiches produit et recherches (seulement avec l'accord cookies)
create table if not exists public.customer_events (
  id          bigint generated always as identity primary key,
  customer_id uuid references public.customers(id) on delete cascade,
  visitor     text,
  kind        text not null check (kind in ('view','search')),
  product_id  uuid references public.products(id) on delete cascade,
  query       text,
  created_at  timestamptz not null default now()
);
create index if not exists customer_events_cust on public.customer_events (customer_id, created_at desc);
create index if not exists customer_events_visitor on public.customer_events (visitor, created_at desc);

alter table public.customers enable row level security;
alter table public.customer_sessions enable row level security;
alter table public.customer_favorites enable row level security;
alter table public.customer_events enable row level security;
revoke all on public.customers, public.customer_sessions, public.customer_favorites, public.customer_events from anon, authenticated;
grant all on public.customers, public.customer_sessions, public.customer_favorites, public.customer_events to service_role;
