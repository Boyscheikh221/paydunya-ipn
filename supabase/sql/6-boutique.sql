-- ============================================================
-- licenceoff v2 : boutique automatique + stock de clés
-- À coller dans Supabase > SQL Editor > New query > Run
-- (à lancer APRÈS 1-setup.sql, qui est déjà en place)
-- Ne supprime rien : ajoute des tables et complète "downloads".
-- ============================================================

-- ---------- Produits ----------
create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  slug                text unique not null,            -- ex : office-2024
  name                text not null,                   -- ex : Office 2024 Professionnel Plus
  price_fcfa          int  not null default 0 check (price_fcfa >= 0),
  installer_path      text,                            -- fichier dans le bucket "installers" (vide = pas de téléchargement)
  active              boolean not null default true,   -- visible sur le site
  low_stock_threshold int  not null default 5,
  created_at          timestamptz not null default now()
);

-- ---------- Commandes ----------
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique not null,                 -- ex : LO-2611-7KQ3 (donnée au client)
  public_token   text unique not null,                 -- secret de la page de suivi du client
  customer_name  text not null,
  email          text not null,
  phone          text,
  product_id     uuid not null references public.products(id),
  amount_fcfa    int  not null default 0,
  payment_method text,                                 -- wave, orange_money, paydunya, especes…
  payment_ref    text,                                 -- n° de transaction donné par le client
  status         text not null default 'pending'
                 check (status in ('pending','paid','delivered','cancelled')),
  source         text not null default 'site' check (source in ('site','admin','paydunya')),
  note           text,
  key_id         uuid unique,                          -- une clé = une seule commande
  created_at     timestamptz not null default now(),
  paid_at        timestamptz,
  delivered_at   timestamptz
);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_status_idx  on public.orders (status);

-- ---------- Paiement PayDunya ----------
alter table public.orders add column if not exists paydunya_token text;
create unique index if not exists orders_paydunya_idx on public.orders (paydunya_token) where paydunya_token is not null;

-- ---------- Stock de clés ----------
create table if not exists public.license_keys (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  key_value  text not null,
  status     text not null default 'available'
             check (status in ('available','sent','disabled')),
  order_id   uuid unique references public.orders(id), -- une commande = une seule clé
  added_at   timestamptz not null default now(),
  sent_at    timestamptz,
  unique (product_id, key_value)                       -- pas deux fois la même clé dans le stock
);
create index if not exists keys_stock_idx on public.license_keys (product_id, status, added_at);

do $$ begin
  alter table public.orders
    add constraint orders_key_fk foreign key (key_id) references public.license_keys(id);
exception when duplicate_object then null; end $$;

-- ---------- Liens de téléchargement (table existante) ----------
alter table public.downloads add column if not exists order_id   uuid references public.orders(id) on delete set null;
alter table public.downloads add column if not exists product_id uuid references public.products(id);
alter table public.downloads alter column max_downloads set default 1;  -- usage unique par défaut
create index if not exists downloads_order_idx on public.downloads (order_id);

-- ---------- Sécurité : personne ne lit ces tables depuis l'extérieur ----------
alter table public.products     enable row level security;
alter table public.orders       enable row level security;
alter table public.license_keys enable row level security;
revoke all on table public.products, public.orders, public.license_keys from anon, authenticated;
grant all on table public.products, public.orders, public.license_keys to service_role;

-- ============================================================
-- Livraison automatique d'une commande (atomique)
-- 1 clé libre réservée pour toujours + 1 lien à usage unique.
-- Appelée par l'admin ("Valider le paiement") et plus tard par PayDunya.
-- ============================================================
create or replace function public.deliver_order(p_order_id uuid, p_token text, p_days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  p public.products;
  k_id uuid;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  if o.status = 'delivered' then return jsonb_build_object('ok', true, 'reason', 'already_delivered'); end if;

  select * into p from public.products where id = o.product_id;

  -- marque payée (même si le stock est vide : on livrera dès qu'une clé arrive)
  update public.orders set status = 'paid', paid_at = coalesce(paid_at, now()) where id = o.id;

  -- prend la plus ancienne clé libre ; SKIP LOCKED évite qu'une clé parte deux fois
  select id into k_id from public.license_keys
   where product_id = o.product_id and status = 'available'
   order by added_at, id
   for update skip locked
   limit 1;

  if k_id is null then
    return jsonb_build_object('ok', false, 'reason', 'out_of_stock');
  end if;

  update public.license_keys set status = 'sent', order_id = o.id, sent_at = now() where id = k_id;
  update public.orders set status = 'delivered', key_id = k_id, delivered_at = now() where id = o.id;

  if p.installer_path is not null and p.installer_path <> '' then
    insert into public.downloads (token, email, note, status, max_downloads, expires_at, activated_at, order_id, product_id)
    values (p_token, o.email, o.ref, 'active', 1, now() + make_interval(days => greatest(1, least(p_days, 90))), now(), o.id, o.product_id);
  end if;

  return jsonb_build_object('ok', true, 'reason', 'delivered');
end;
$$;

-- Nouveau lien à usage unique pour une commande livrée (les anciens liens non utilisés sont désactivés)
create or replace function public.new_order_link(p_order_id uuid, p_token text, p_days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare o public.orders; p public.products;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.status <> 'delivered' then return jsonb_build_object('ok', false, 'reason', 'not_delivered'); end if;
  select * into p from public.products where id = o.product_id;
  if p.installer_path is null or p.installer_path = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_installer');
  end if;

  update public.downloads set status = 'revoked'
   where order_id = o.id and status <> 'revoked' and download_count < max_downloads;

  insert into public.downloads (token, email, note, status, max_downloads, expires_at, activated_at, order_id, product_id)
  values (p_token, o.email, o.ref, 'active', 1, now() + make_interval(days => greatest(1, least(p_days, 90))), now(), o.id, o.product_id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.deliver_order(uuid, text, int)  from public, anon, authenticated;
revoke all on function public.new_order_link(uuid, text, int) from public, anon, authenticated;
grant execute on function public.deliver_order(uuid, text, int)  to service_role;
grant execute on function public.new_order_link(uuid, text, int) to service_role;

-- Produit de départ (modifiable ensuite dans le tableau de bord)
insert into public.products (slug, name, price_fcfa, installer_path)
values ('office-2024', 'Office 2024 Professionnel Plus', 15000, 'Office_2024_FR_64Bits.exe')
on conflict (slug) do nothing;

-- ============================================================
-- Statistiques de visites (sans cookie, sans service externe)
-- ============================================================
create table if not exists public.page_views (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  page       text not null,
  visitor    text,          -- identifiant anonyme aléatoire (pas de nom, pas d'IP)
  referrer   text,          -- site d'où vient le visiteur (google.com, facebook.com…)
  device     text           -- mobile / ordinateur
);
create index if not exists page_views_time_idx on public.page_views (created_at desc);
alter table public.page_views enable row level security;
revoke all on table public.page_views from anon, authenticated;
grant all on table public.page_views to service_role;
grant usage, select on sequence public.page_views_id_seq to service_role;

-- Résumé pour le tableau de bord (heure de Dakar = UTC)
create or replace function public.visit_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with v as (select * from public.page_views where created_at >= now() - interval '30 days')
  select jsonb_build_object(
    'today_views',    (select count(*) from v where created_at >= date_trunc('day', now())),
    'today_visitors', (select count(distinct visitor) from v where created_at >= date_trunc('day', now())),
    'week_visitors',  (select count(distinct visitor) from v where created_at >= now() - interval '7 days'),
    'month_visitors', (select count(distinct visitor) from v),
    'month_views',    (select count(*) from v),
    'mobile_share',   (select round(100.0 * count(*) filter (where device = 'mobile') / greatest(count(*), 1)) from v),
    'per_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'visitors', n, 'views', m) order by d)
                 from (select date_trunc('day', created_at)::date d, count(distinct visitor) n, count(*) m from v group by 1) x), '[]'::jsonb),
    'top_pages', coalesce((select jsonb_agg(jsonb_build_object('page', page, 'views', n) order by n desc)
                 from (select page, count(*) n from v group by 1 order by 2 desc limit 8) x), '[]'::jsonb),
    'top_referrers', coalesce((select jsonb_agg(jsonb_build_object('source', referrer, 'visitors', n) order by n desc)
                 from (select coalesce(nullif(referrer, ''), 'accès direct') referrer, count(distinct visitor) n from v group by 1 order by 2 desc limit 8) x), '[]'::jsonb)
  );
$$;
revoke all on function public.visit_stats() from public, anon, authenticated;
grant execute on function public.visit_stats() to service_role;
