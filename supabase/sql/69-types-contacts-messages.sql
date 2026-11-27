-- =====================================================================
-- 69 — Boîte de réception : type de chaque expéditeur (27/11/2026)
--   Dans l'admin > Messages, chaque conversation reçoit une étiquette automatique :
--     Client        = l'adresse a déjà commandé ou a un compte sur le site (avec le nombre d'achats)
--     Ancien client = l'adresse fait partie des clients « Avant le site » (SQL 65)
--     Partenaire    = un parrain / revendeur, ou une adresse d'un domaine partenaire (Facebook, Google, fournisseurs…)
--     Visiteur      = tout le reste
--   Vous pouvez aussi choisir le type à la main : ce choix est gardé ici et passe avant l'automatique.
--   Aucun email n'est envoyé par ce fichier.
--   Pour annuler tous les choix faits à la main : delete from public.inbox_contacts;
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================
create table if not exists public.inbox_contacts (
  email       text primary key,                     -- en minuscules
  kind        text not null check (kind in ('client','ancien','partenaire','visiteur')),
  name        text,
  updated_at  timestamptz not null default now()
);
alter table public.inbox_contacts enable row level security;
revoke all on public.inbox_contacts from anon, authenticated;
grant all on public.inbox_contacts to service_role;

-- Domaines partenaires de départ (modifiables dans l'admin > Messages > « Domaines partenaires »)
insert into public.settings (key, value) values
  ('inbox_partner_domains', '["facebookmail.com","facebook.com","meta.com","instagram.com","google.com","cloudflare.com","supabase.com","resend.com"]'::jsonb)
on conflict (key) do nothing;
