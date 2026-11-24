-- ============================================================
-- 27 : Origine des ventes (Facebook Ads, Google Ads, WhatsApp, Google, direct…)
-- À coller dans Supabase > SQL Editor > Run (une seule fois, relançable).
-- ============================================================
alter table public.orders add column if not exists channel text;      -- google_ads, facebook_ads, facebook, google, whatsapp, direct, autre, wa_manuel, fb_manuel, tel_manuel, autre_manuel
alter table public.orders add column if not exists campaign text;     -- utm_campaign (nom de la campagne de pub)
alter table public.orders add column if not exists utm_source text;
alter table public.orders add column if not exists utm_medium text;
create index if not exists orders_channel_idx on public.orders (channel);

-- anciennes commandes : ventes manuelles = WhatsApp, commandes du site = inconnu (direct)
update public.orders set channel = 'wa_manuel' where channel is null and source = 'admin';
update public.orders set channel = 'direct' where channel is null;
-- anciennes ventes manuelles sans n° de transaction : on en génère un
update public.orders set payment_ref = 'TX-' || substr(ref, 4) where source = 'admin' and coalesce(payment_ref, '') = '';

select channel, count(*) from public.orders group by channel;
