-- =====================================================================
-- 58 — Produits « d'exception » : clé et/ou logiciel envoyés à la main (25/11/2026)
--   products.manual_key  : la clé n'est jamais envoyée automatiquement. Après paiement, l'article attend
--                          et Cheikh clique « 🔑 Envoyer la clé maintenant » (clé prise dans le stock du produit).
--                          Le client ne voit pas de bouton « J'ai fini l'installation ».
--   products.manual_link : pas de lien de téléchargement automatique. Cheikh colle le lien dans la commande
--                          (« 📎 Envoyer le lien du logiciel ») : email au client + bouton sur sa page.
--   order_items.manual_link_url / manual_link_sent_at : le lien envoyé à la main.
--   deliver_order_v3 : identique à la version 49, avec ces deux réglages.
--   MS Project 2024 : clé envoyée à la main (choix de Cheikh).
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================
alter table public.products add column if not exists manual_key boolean not null default false;
alter table public.products add column if not exists manual_link boolean not null default false;
alter table public.order_items add column if not exists manual_link_url text;
alter table public.order_items add column if not exists manual_link_sent_at timestamptz;

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
  rk public.license_keys;
  used int;
  n int;
  installing int := 0;
  two_step boolean;
  short boolean;
  comp record;
  src record;
begin
  select coalesce((select (value)::text::boolean from public.settings where key = 'auto_delivery'), true) into global_auto;
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  if o.status = 'delivered' then return jsonb_build_object('ok', true, 'reason', 'already_delivered'); end if;

  update public.orders set paid_at = coalesce(paid_at, now()) where id = o.id;

  for it in select * from public.order_items where order_id = o.id
      and (status in ('pending','waiting_stock')
           or (p_force and status = 'to_process' and delivery_type not in ('manual','physical'))
           or (status = 'awaiting_install' and claim_requested_at is not null))
      order by created_at loop
    select * into p from public.products where id = it.product_id;

    -- produit physique : on retire la quantité du stock une seule fois (à la sortie de « pending »),
    -- puis l'admin expédie à la main
    if it.delivery_type = 'physical' then
      if it.status = 'pending' then
        update public.products set stock_qty = greatest(0, stock_qty - it.quantity)
         where id = it.product_id and stock_qty is not null;
      end if;
      update public.order_items set status = 'to_process' where id = it.id;
      manual := manual + 1;
      continue;
    end if;

    -- service à faire à la main, ou livraison automatique désactivée : l'admin s'en occupe
    if it.delivery_type = 'manual' or (not p_force and not (global_auto and coalesce(p.auto_deliver, true))) then
      update public.order_items set status = 'to_process' where id = it.id;
      manual := manual + 1;
      continue;
    end if;

    -- livraison en 2 temps : d'abord le logiciel (lien à usage unique), la clé seulement
    -- quand le client a cliqué « J'ai fini l'installation » (claim_requested_at)
    -- logiciel seul dont le lien est envoyé à la main : l'article attend l'admin (« 📎 Envoyer le lien »)
    if it.delivery_type = 'file' and coalesce(p.manual_link, false) then
      update public.order_items set status = 'to_process' where id = it.id;
      manual := manual + 1;
      continue;
    end if;

    -- clé envoyée à la main (produit « d'exception », ex. MS Project) : même chemin que le 2 temps,
    -- mais c'est l'admin qui libère la clé (« Envoyer la clé maintenant »), jamais le client
    two_step := (coalesce(p.two_step, false) or coalesce(p.manual_key, false)) and it.delivery_type in ('key','key_file');
    if two_step and it.claim_requested_at is null then
      -- logiciel(s) : celui du produit, ou ceux des produits du pack
      for src in select x.id from public.products x
                  where coalesce(x.installer_path, '') <> '' and x.delivery_type in ('key_file','file')
                    and (x.id = it.product_id or x.id in (select component_id from public.product_bundle_items where bundle_id = it.product_id))
                    and not coalesce(x.manual_link, false) -- lien envoyé à la main par l'admin
                    and not exists (select 1 from public.downloads d where d.order_item_id = it.id and d.product_id = x.id) loop
        if ti > coalesce(array_length(p_tokens, 1), 0) then
          return jsonb_build_object('ok', false, 'reason', 'tokens_missing');
        end if;
        insert into public.downloads (token, email, note, status, max_downloads, expires_at, activated_at, order_id, order_item_id, product_id)
        values (p_tokens[ti], o.email, o.ref, 'active', 1, now() + make_interval(days => greatest(1, least(p_days, 90))), now(), o.id, it.id, src.id);
        ti := ti + 1;
      end loop;
      update public.order_items set status = 'awaiting_install' where id = it.id;
      continue;
    end if;

    -- clés / identifiants : 1 par unité achetée.
    -- D'abord les clés à usage unique (jamais réutilisées), puis, s'il en manque,
    -- une clé « réutilisable » du stock : elle reste disponible, on en garde une copie pour la commande.
    -- clés / identifiants : 1 par unité achetée (take_keys : usage unique d'abord, puis multi-postes, puis sans limite).
    -- Pack : 1 clé (× quantité du composant) prise dans le stock de CHAQUE produit du pack.
    if it.delivery_type in ('key','key_file','stock') then
      short := false;
      if exists (select 1 from public.product_bundle_items where bundle_id = it.product_id) then
        for comp in select component_id, qty from public.product_bundle_items where bundle_id = it.product_id loop
          if public.take_keys(it.id, comp.component_id, it.quantity * comp.qty) < it.quantity * comp.qty then short := true; end if;
        end loop;
      else
        short := public.take_keys(it.id, it.product_id, it.quantity) < it.quantity;
      end if;
      if short then
        update public.order_items set status = 'waiting_stock' where id = it.id;
        waiting := waiting + 1;
        continue;
      end if;
    end if;

    -- logiciel : un lien à usage unique
    for src in select x.id from public.products x
                where coalesce(x.installer_path, '') <> '' and x.delivery_type in ('key_file','file')
                  and ((x.id = it.product_id and it.delivery_type in ('key_file','file'))
                       or x.id in (select component_id from public.product_bundle_items where bundle_id = it.product_id))
                  and not coalesce(x.manual_link, false) -- lien envoyé à la main par l'admin
                  and not exists (select 1 from public.downloads d where d.order_item_id = it.id and d.product_id = x.id) loop
      if ti > coalesce(array_length(p_tokens, 1), 0) then
        return jsonb_build_object('ok', false, 'reason', 'tokens_missing');
      end if;
      insert into public.downloads (token, email, note, status, max_downloads, expires_at, activated_at, order_id, order_item_id, product_id)
      values (p_tokens[ti], o.email, o.ref, 'active', 1, now() + make_interval(days => greatest(1, least(p_days, 90))), now(), o.id, it.id, src.id);
      ti := ti + 1;
    end loop;

    update public.order_items set status = 'delivered', delivered_at = now() where id = it.id;
  end loop;

  -- état global de la commande
  select count(*) filter (where status = 'waiting_stock'),
         count(*) filter (where status = 'to_process'),
         count(*) filter (where status = 'awaiting_install')
    into waiting, manual, installing
    from public.order_items where order_id = o.id;

  update public.orders set
    status = case when waiting > 0 then 'paid' when manual > 0 then 'processing' when installing > 0 then 'installing' else 'delivered' end,
    delivered_at = case when waiting = 0 and manual = 0 and installing = 0 then now() else null end
  where id = o.id;

  return jsonb_build_object('ok', waiting = 0, 'reason',
    case when waiting > 0 then 'out_of_stock' when manual > 0 then 'to_process' when installing > 0 then 'awaiting_install' else 'delivered' end);
end;
$$;

revoke all on function public.deliver_order_v3(uuid, text[], int, boolean) from public, anon, authenticated;
grant execute on function public.deliver_order_v3(uuid, text[], int, boolean) to service_role;


update public.products set manual_key = true where name ilike 'Microsoft Project 2024%';
select name, delivery_type, manual_key, manual_link from public.products where manual_key or manual_link;
