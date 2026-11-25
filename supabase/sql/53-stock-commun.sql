-- =====================================================================
-- 53 — Stock de clés commun (25/11/2026)
--   products.key_source_id : ce produit prend ses clés dans le stock d'un autre produit.
--   Exemple : Windows 10 Professionnel prend ses clés dans le stock de Windows 11 Professionnel
--   (mêmes clés pour les deux). Le lien de téléchargement, le prix et les emails restent ceux du produit vendu.
--   Une clé prise passe au nom du produit vendu (le client voit « Windows 10 Professionnel »).
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================
alter table public.products add column if not exists key_source_id uuid references public.products(id) on delete set null;
alter table public.products drop constraint if exists products_key_source_not_self;
alter table public.products add constraint products_key_source_not_self check (key_source_id is null or key_source_id <> id);

-- Prend des clés du stock d'un produit (ou de son stock source) pour un article de commande, jusqu'à p_qty au total.
-- Ordre : usage unique, puis multi-postes, puis réutilisables sans limite. Renvoie le nombre de clés de ce produit sur l'article.
create or replace function public.take_keys(p_item uuid, p_product uuid, p_qty int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  got int;
  needed int;
  rk public.license_keys;
  used int;
  n int;
  src uuid;
begin
  -- stock commun : les clés viennent du produit source (un seul niveau)
  select coalesce(key_source_id, id) into src from public.products where id = p_product;
  src := coalesce(src, p_product);
  select count(*) into got from public.license_keys where order_item_id = p_item and product_id = p_product;
  needed := p_qty - got;
  if needed > 0 then
    with picked as (
      select id from public.license_keys
       where product_id = src and status = 'available' and not reusable
       order by added_at, id
       for update skip locked
       limit needed
    )
    update public.license_keys k
       set status = 'sent', order_item_id = p_item, order_id = null, sent_at = now(), product_id = p_product
      from picked where k.id = picked.id;
    select count(*) into got from public.license_keys where order_item_id = p_item and product_id = p_product;
  end if;
  while got < p_qty loop
    select * into rk from public.license_keys
     where product_id = src and status = 'available' and reusable and source_key_id is null
     order by (max_uses is null), added_at, id limit 1
     for update skip locked;
    exit when not found;
    if rk.max_uses is null then
      n := p_qty - got; used := 0;
    else
      select count(*) into used from public.license_keys where source_key_id = rk.id;
      n := greatest(0, least(p_qty - got, rk.max_uses - used));
    end if;
    if n > 0 then
      insert into public.license_keys (product_id, key_value, status, reusable, source_key_id, order_item_id, sent_at, note)
      select p_product, rk.key_value, 'sent', true, rk.id, p_item, now(), rk.note
        from generate_series(1, n);
      got := got + n;
    end if;
    if rk.max_uses is not null and used + n >= rk.max_uses then
      update public.license_keys set status = 'sent', sent_at = now() where id = rk.id;  -- épuisée
    else
      update public.license_keys set sent_at = now() where id = rk.id;
    end if;
  end loop;
  return got;
end;
$$;
revoke all on function public.take_keys(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.take_keys(uuid, uuid, int) to service_role;

-- Windows 10 Professionnel prend ses clés dans le stock de Windows 11 Professionnel (choix de Cheikh, 25/11/2026)
update public.products set key_source_id = (select id from public.products where slug = 'microsoft-windows-11-professionnel-licence-1-pc')
 where slug = 'microsoft-windows-10-professionnel-licence-1-pc' and key_source_id is null;

select p.name, s.name as prend_ses_cles_dans from public.products p join public.products s on s.id = p.key_source_id;
