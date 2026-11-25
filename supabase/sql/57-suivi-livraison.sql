-- =====================================================================
-- 57 — Suivi de livraison des produits physiques (25/11/2026)
--   Parcours type Jumia / Amazon : Payée → Expédition en cours → Livrée, un email au client à chaque étape.
--   orders.ship_paid_mail_at : email « commande payée, livraison sous 48 h ouvrées » envoyé (une seule fois)
--   orders.ship_started_at   : Cheikh a cliqué « Expédition en cours » (+ ship_note : livreur, numéro…)
--   orders.ship_done_at      : Cheikh a cliqué « Livrée » (email de confirmation + demande d'avis)
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================
alter table public.orders add column if not exists ship_paid_mail_at timestamptz;
alter table public.orders add column if not exists ship_started_at timestamptz;
alter table public.orders add column if not exists ship_note text;
alter table public.orders add column if not exists ship_done_at timestamptz;

select count(*) filter (where ship_started_at is not null) as en_expedition, count(*) as commandes from public.orders;
