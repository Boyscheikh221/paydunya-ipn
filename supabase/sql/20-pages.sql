-- =====================================================================
-- 20 — Pages libres créées depuis l'admin (22/11/2026)
--   À propos, Conditions de vente, page promo, page de service…
--   Adresse : www.licenceoff.com/page/<adresse>. Affichage au choix dans le menu et/ou le pied de page.
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================
create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  content text not null default '',
  image_url text,
  seo_title text,
  seo_description text,
  published boolean not null default false,
  in_menu boolean not null default false,
  in_footer boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pages_pub_idx on public.pages (published, sort);
alter table public.pages enable row level security;
revoke all on table public.pages from anon, authenticated;
grant all on table public.pages to service_role;
