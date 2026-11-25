-- =====================================================================
-- 52 — Bouton WhatsApp flottant réglable page par page (25/11/2026)
--   Articles du blog : caché par défaut (case à cocher dans 📝 Blog pour l'afficher sur un article).
--   Pages libres : affiché par défaut (case à décocher dans 📄 Pages & blog).
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================
alter table public.posts add column if not exists show_whatsapp boolean not null default false;
alter table public.pages add column if not exists show_whatsapp boolean not null default true;
