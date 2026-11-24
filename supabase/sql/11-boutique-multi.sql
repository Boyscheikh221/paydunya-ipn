-- ============================================================
-- licenceoff v3 : vraie boutique multi-produits
-- Catégories, fiches produit (photo, description), panier à
-- plusieurs articles, livraison selon le type de produit.
-- À lancer APRÈS 6-boutique.sql. Peut être relancé sans danger.
-- ============================================================

-- ---------- Catégories ----------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  sort       int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
revoke all on table public.categories from anon, authenticated;
grant all on table public.categories to service_role;

-- ---------- Produits : fiche complète + mode de livraison ----------
alter table public.products add column if not exists category_id uuid references public.categories(id) on delete set null;
alter table public.products add column if not exists description text;
alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists compare_price_fcfa int;        -- ancien prix barré (promo)
alter table public.products add column if not exists featured boolean not null default false;
alter table public.products add column if not exists sort int not null default 0;
-- key      = clé de licence prise dans le stock
-- key_file = clé du stock + logiciel à télécharger (lien à usage unique)
-- file     = logiciel à télécharger seulement
-- stock    = identifiants / codes pris dans le stock (ex : abonnement, compte)
-- manual   = traité à la main par l'admin (ex : service informatique)
alter table public.products add column if not exists delivery_type text not null default 'key';
do $$ begin
  alter table public.products add constraint products_delivery_type_check
    check (delivery_type in ('key','key_file','file','stock','manual'));
exception when duplicate_object then null; end $$;
update public.products set delivery_type = 'key_file'
 where delivery_type = 'key' and installer_path is not null and installer_path <> '';

-- Livraison automatique : interrupteur par produit + interrupteur général (table settings)
alter table public.products add column if not exists auto_deliver boolean not null default true;
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
revoke all on table public.settings from anon, authenticated;
grant all on table public.settings to service_role;
insert into public.settings (key, value) values ('auto_delivery', 'true'::jsonb) on conflict (key) do nothing;

-- ---------- Lignes de commande (panier) ----------
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  product_name text not null,
  delivery_type text not null,
  unit_price   int  not null,
  quantity     int  not null check (quantity between 1 and 20),
  status       text not null default 'pending'
               check (status in ('pending','waiting_stock','to_process','delivered','cancelled')),
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items (order_id);
alter table public.order_items enable row level security;
revoke all on table public.order_items from anon, authenticated;
grant all on table public.order_items to service_role;

-- ---------- Commandes : plusieurs articles ----------
alter table public.orders alter column product_id drop not null;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','paid','processing','delivered','cancelled'));
-- paid = payée, en attente de stock ; processing = payée, un service est à traiter à la main

-- ---------- Stock : une ligne de commande peut recevoir plusieurs clés ----------
alter table public.license_keys add column if not exists order_item_id uuid references public.order_items(id);
create index if not exists keys_item_idx on public.license_keys (order_item_id);

-- ---------- Liens de téléchargement par article ----------
alter table public.downloads add column if not exists order_item_id uuid references public.order_items(id) on delete set null;

-- ---------- Images des produits : espace PUBLIC (photos seulement) ----------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- ============================================================
-- Livraison automatique d'une commande à plusieurs articles
-- Appelée par PayDunya (paiement confirmé), par l'admin
-- ("Valider le paiement") et quand du stock arrive.
-- p_tokens : jetons aléatoires préparés par la fonction (1 par lien).
-- ============================================================
drop function if exists public.deliver_order_v3(uuid, text[], int);
create or replace function public.deliver_order_v3(p_order_id uuid, p_tokens text[], p_days int default 7, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it record;
  needed int;
  got int;
  ti int := 1;
  waiting int := 0;
  manual int := 0;
  p public.products;
  global_auto boolean;
begin
  select coalesce((select (value)::text::boolean from public.settings where key = 'auto_delivery'), true) into global_auto;
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  if o.status = 'delivered' then return jsonb_build_object('ok', true, 'reason', 'already_delivered'); end if;

  update public.orders set paid_at = coalesce(paid_at, now()) where id = o.id;

  for it in select * from public.order_items where order_id = o.id
      and (status in ('pending','waiting_stock') or (p_force and status = 'to_process' and delivery_type <> 'manual'))
      order by created_at loop
    select * into p from public.products where id = it.product_id;

    -- service à faire à la main, ou livraison automatique désactivée : l'admin s'en occupe
    if it.delivery_type = 'manual' or (not p_force and not (global_auto and coalesce(p.auto_deliver, true))) then
      update public.order_items set status = 'to_process' where id = it.id;
      manual := manual + 1;
      continue;
    end if;

    -- clés / identifiants : 1 par unité achetée, jamais réutilisés
    if it.delivery_type in ('key','key_file','stock') then
      select count(*) into got from public.license_keys where order_item_id = it.id;
      needed := it.quantity - got;
      if needed > 0 then
        with picked as (
          select id from public.license_keys
           where product_id = it.product_id and status = 'available'
           order by added_at, id
           for update skip locked
           limit needed
        )
        update public.license_keys k
           set status = 'sent', order_item_id = it.id, order_id = null, sent_at = now()
          from picked where k.id = picked.id;
        select count(*) into got from public.license_keys where order_item_id = it.id;
      end if;
      if got < it.quantity then
        update public.order_items set status = 'waiting_stock' where id = it.id;
        waiting := waiting + 1;
        continue;
      end if;
    end if;

    -- logiciel : un lien à usage unique
    if it.delivery_type in ('key_file','file') and coalesce(p.installer_path, '') <> ''
       and not exists (select 1 from public.downloads where order_item_id = it.id) then
      if ti > coalesce(array_length(p_tokens, 1), 0) then
        return jsonb_build_object('ok', false, 'reason', 'tokens_missing');
      end if;
      insert into public.downloads (token, email, note, status, max_downloads, expires_at, activated_at, order_id, order_item_id, product_id)
      values (p_tokens[ti], o.email, o.ref, 'active', 1, now() + make_interval(days => greatest(1, least(p_days, 90))), now(), o.id, it.id, it.product_id);
      ti := ti + 1;
    end if;

    update public.order_items set status = 'delivered', delivered_at = now() where id = it.id;
  end loop;

  -- état global de la commande
  select count(*) filter (where status = 'waiting_stock'),
         count(*) filter (where status = 'to_process')
    into waiting, manual
    from public.order_items where order_id = o.id;

  update public.orders set
    status = case when waiting > 0 then 'paid' when manual > 0 then 'processing' else 'delivered' end,
    delivered_at = case when waiting = 0 and manual = 0 then now() else null end
  where id = o.id;

  return jsonb_build_object('ok', waiting = 0, 'reason',
    case when waiting > 0 then 'out_of_stock' when manual > 0 then 'to_process' else 'delivered' end);
end;
$$;

-- Marquer un article "service" comme fait (admin)
create or replace function public.complete_order_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare oid uuid; left_ int;
begin
  update public.order_items set status = 'delivered', delivered_at = now()
   where id = p_item_id and status = 'to_process' returning order_id into oid;
  if oid is null then return jsonb_build_object('ok', false, 'reason', 'not_to_process'); end if;
  select count(*) into left_ from public.order_items where order_id = oid and status not in ('delivered','cancelled');
  if left_ = 0 then update public.orders set status = 'delivered', delivered_at = now() where id = oid; end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Nouveau lien à usage unique pour un article (les anciens liens non utilisés sont désactivés)
create or replace function public.new_item_link(p_item_id uuid, p_token text, p_days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare it public.order_items; o public.orders; p public.products;
begin
  select * into it from public.order_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if it.status <> 'delivered' then return jsonb_build_object('ok', false, 'reason', 'not_delivered'); end if;
  select * into p from public.products where id = it.product_id;
  if coalesce(p.installer_path, '') = '' then return jsonb_build_object('ok', false, 'reason', 'no_installer'); end if;
  select * into o from public.orders where id = it.order_id;
  update public.downloads set status = 'revoked'
   where order_item_id = it.id and status <> 'revoked' and download_count < max_downloads;
  insert into public.downloads (token, email, note, status, max_downloads, expires_at, activated_at, order_id, order_item_id, product_id)
  values (p_token, o.email, o.ref, 'active', 1, now() + make_interval(days => greatest(1, least(p_days, 90))), now(), o.id, it.id, it.product_id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.deliver_order_v3(uuid, text[], int, boolean) from public, anon, authenticated;
revoke all on function public.complete_order_item(uuid)            from public, anon, authenticated;
revoke all on function public.new_item_link(uuid, text, int)       from public, anon, authenticated;
grant execute on function public.deliver_order_v3(uuid, text[], int, boolean) to service_role;
grant execute on function public.complete_order_item(uuid)            to service_role;
grant execute on function public.new_item_link(uuid, text, int)       to service_role;

-- Catégories de départ (modifiables dans l'admin)
insert into public.categories (slug, name, sort) values
  ('licences-windows', 'Licences Windows', 1),
  ('microsoft-office', 'Microsoft Office', 2),
  ('logiciels', 'Logiciels', 4),
  ('services-informatiques', 'Services informatiques', 5)
on conflict (slug) do nothing;
update public.products set category_id = (select id from public.categories where slug = 'microsoft-office')
 where slug = 'office-2024' and category_id is null;

-- ============================================================
-- Blog
-- ============================================================
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  title        text not null,
  excerpt      text,                        -- résumé affiché dans la liste
  content      text not null default '',    -- texte de l'article (paragraphes, ## titres, - listes, [lien](url))
  cover_url    text,                        -- image de couverture (espace public product-images)
  published    boolean not null default false,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists posts_pub_idx on public.posts (published, published_at desc);
alter table public.posts enable row level security;
revoke all on table public.posts from anon, authenticated;
grant all on table public.posts to service_role;

-- ============================================================
-- FAQ (questions fréquentes, modifiables dans l'admin)
-- ============================================================
create table if not exists public.faqs (
  id         uuid primary key default gen_random_uuid(),
  question   text not null,
  answer     text not null,
  sort       int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.faqs enable row level security;
revoke all on table public.faqs from anon, authenticated;
grant all on table public.faqs to service_role;
insert into public.faqs (question, answer, sort)
select * from (values
  ('Comment vais-je recevoir ma licence ?', 'Dès que votre paiement est confirmé, votre clé (et le lien de téléchargement si besoin) s''affiche sur votre page de commande. Gardez bien ce lien.', 1),
  ('Quels moyens de paiement acceptez-vous ?', 'Wave, Orange Money, Free Money et carte bancaire, via la plateforme sécurisée PayDunya.', 2),
  ('Le lien de téléchargement ne marche plus, que faire ?', 'Chaque lien ne fonctionne qu''une seule fois pour protéger votre achat. Écrivez-nous sur WhatsApp avec votre numéro de commande : nous vous en envoyons un nouveau.', 3),
  ('Les licences sont-elles authentiques ?', 'Oui. Chaque clé est attribuée à un seul client et n''est jamais revendue.', 4),
  ('Pouvez-vous m''aider à installer ou activer ?', 'Oui, notre support WhatsApp vous accompagne pour l''installation et l''activation.', 5)
) v(q, a, s)
where not exists (select 1 from public.faqs);
