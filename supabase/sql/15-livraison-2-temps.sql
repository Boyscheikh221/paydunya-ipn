-- ============================================================
-- 15 — Livraison en 2 temps (22/11/2026)
-- 1) paiement → le client reçoit le lien de téléchargement + un bouton
--    à usage unique « J'ai fini l'installation » (email d'installation) ;
-- 2) clic → la clé part (tout de suite si la livraison auto est active,
--    sinon une demande « à traiter » apparaît dans l'admin).
-- Réglage par produit (products.two_step). Relançable sans danger.
-- ============================================================
alter table public.products add column if not exists two_step boolean not null default false;
alter table public.order_items add column if not exists claim_requested_at timestamptz;
alter table public.order_items add column if not exists install_emailed_at timestamptz;

alter table public.order_items drop constraint if exists order_items_status_check;
alter table public.order_items add constraint order_items_status_check
  check (status in ('pending','waiting_stock','awaiting_install','to_process','delivered','cancelled'));
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','paid','processing','installing','delivered','cancelled'));
-- installing = payée, le client installe le logiciel avant de demander sa clé

-- Deux sortes de modèles : 'key' (email de la clé) et 'install' (email d'installation, étape 1)
alter table public.email_templates add column if not exists kind text not null default 'key';
alter table public.email_templates drop constraint if exists email_templates_kind_check;
alter table public.email_templates add constraint email_templates_kind_check check (kind in ('key','install'));
drop index if exists public.email_templates_one_default;
create unique index if not exists email_templates_one_default_kind on public.email_templates (kind) where is_default;
alter table public.products add column if not exists install_template_id uuid references public.email_templates(id) on delete set null;

insert into public.email_templates (name, subject, body, is_default, kind)
select 'Installation — modèle général', 'Commande {commande} : installez votre logiciel — licenceoff',
'Bonjour {prenom},

Merci pour votre commande **{commande}** ({total}). Votre paiement est bien reçu.

**Étape 1 : téléchargez et installez le logiciel.** Le lien ne fonctionne qu''une seule fois : lancez-le depuis l''ordinateur où vous installez.

{bouton}

**Étape 2 : recevez votre clé de licence.** Une fois l''installation terminée, cliquez sur ce bouton. Il ne fonctionne qu''une fois.

{bouton_installation}

Un souci pendant l''installation ? [Écrivez-nous sur WhatsApp]({whatsapp}).', true, 'install'
where not exists (select 1 from public.email_templates where kind = 'install' and is_default);

insert into public.email_templates (name, subject, body, kind)
select 'Microsoft Office — installation', 'Installez votre Microsoft Office — commande {commande}',
'Bonjour {prenom},

Suite à votre commande **{commande}**, voici votre Microsoft Office.

**Étape 1 : téléchargement et installation.** Cliquez sur le bouton ci-dessous, puis sur « Télécharger le logiciel ». Le lien ne fonctionne qu''une seule fois : lancez-le depuis l''ordinateur où vous installez Office.

{bouton}

- Une fois le fichier téléchargé, ouvrez-le et suivez les étapes d''installation.
- Attendez la fin de l''installation (cela peut prendre quelques minutes).

**Étape 2 : votre clé d''activation.** Quand Office est installé, cliquez ici pour recevoir votre clé. Ce bouton ne fonctionne qu''une fois.

{bouton_installation}

Un souci ? Revenez vers nous sur [WhatsApp]({whatsapp}), on vous aide.', 'install'
where not exists (select 1 from public.email_templates where name = 'Microsoft Office — installation');

-- l'email Office « clé » (seulement s'il n'a jamais été modifié) devient l'étape 2
update public.email_templates set name = 'Microsoft Office — clé',
  subject = 'Votre clé Microsoft Office — commande {commande}',
  body = 'Bonjour {prenom},

Merci d''avoir installé Microsoft Office. Voici votre clé d''activation :

{cles}

- Ouvrez Word, puis saisissez cette clé quand elle est demandée.
- Gardez cet email précieusement.

Un souci pour activer ? Revenez vers nous sur [WhatsApp]({whatsapp}), on vous aide.',
  updated_at = now()
 where name = 'Microsoft Office' and updated_at = created_at;

update public.products set install_template_id = (select id from public.email_templates where name = 'Microsoft Office — installation')
 where slug = 'office-2024' and install_template_id is null;
-- les produits « clé + logiciel » passent en 2 temps (modifiable dans la fiche produit)
update public.products set two_step = true where delivery_type = 'key_file' and not two_step
  and not exists (select 1 from public.settings where key = 'two_step_init');
insert into public.settings (key, value) select 'two_step_init', 'true'::jsonb where not exists (select 1 from public.settings where key = 'two_step_init');

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
  installing int := 0;
  two_step boolean;
begin
  select coalesce((select (value)::text::boolean from public.settings where key = 'auto_delivery'), true) into global_auto;
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  if o.status = 'delivered' then return jsonb_build_object('ok', true, 'reason', 'already_delivered'); end if;

  update public.orders set paid_at = coalesce(paid_at, now()) where id = o.id;

  for it in select * from public.order_items where order_id = o.id
      and (status in ('pending','waiting_stock')
           or (p_force and status = 'to_process' and delivery_type <> 'manual')
           or (status = 'awaiting_install' and claim_requested_at is not null))
      order by created_at loop
    select * into p from public.products where id = it.product_id;

    -- service à faire à la main, ou livraison automatique désactivée : l'admin s'en occupe
    if it.delivery_type = 'manual' or (not p_force and not (global_auto and coalesce(p.auto_deliver, true))) then
      update public.order_items set status = 'to_process' where id = it.id;
      manual := manual + 1;
      continue;
    end if;

    -- livraison en 2 temps : d'abord le logiciel (lien à usage unique), la clé seulement
    -- quand le client a cliqué « J'ai fini l'installation » (claim_requested_at)
    two_step := coalesce(p.two_step, false) and it.delivery_type in ('key','key_file');
    if two_step and it.claim_requested_at is null then
      if it.delivery_type = 'key_file' and coalesce(p.installer_path, '') <> ''
         and not exists (select 1 from public.downloads where order_item_id = it.id) then
        if ti > coalesce(array_length(p_tokens, 1), 0) then
          return jsonb_build_object('ok', false, 'reason', 'tokens_missing');
        end if;
        insert into public.downloads (token, email, note, status, max_downloads, expires_at, activated_at, order_id, order_item_id, product_id)
        values (p_tokens[ti], o.email, o.ref, 'active', 1, now() + make_interval(days => greatest(1, least(p_days, 90))), now(), o.id, it.id, it.product_id);
        ti := ti + 1;
      end if;
      update public.order_items set status = 'awaiting_install' where id = it.id;
      continue;
    end if;

    -- clés / identifiants : 1 par unité achetée.
    -- D'abord les clés à usage unique (jamais réutilisées), puis, s'il en manque,
    -- une clé « réutilisable » du stock : elle reste disponible, on en garde une copie pour la commande.
    if it.delivery_type in ('key','key_file','stock') then
      select count(*) into got from public.license_keys where order_item_id = it.id;
      needed := it.quantity - got;
      if needed > 0 then
        with picked as (
          select id from public.license_keys
           where product_id = it.product_id and status = 'available' and not reusable
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
        select * into rk from public.license_keys
         where product_id = it.product_id and status = 'available' and reusable
         order by added_at, id limit 1;
        if found then
          insert into public.license_keys (product_id, key_value, status, reusable, source_key_id, order_item_id, sent_at)
          select it.product_id, rk.key_value, 'sent', true, rk.id, it.id, now()
            from generate_series(1, it.quantity - got);
          update public.license_keys set sent_at = now() where id = rk.id;
          got := it.quantity;
        end if;
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
