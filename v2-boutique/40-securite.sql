-- ============================================================
-- 40 — Sécurité (revue du 23/11/2026). Relançable sans danger.
-- Supabase > SQL Editor > New query > coller > Run.
-- ============================================================

-- 1) Blocage des essais de mot de passe admin
create table if not exists public.admin_login_failures (
  id         bigserial primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_login_failures_time on public.admin_login_failures (created_at desc);
create index if not exists admin_login_failures_ip   on public.admin_login_failures (ip, created_at desc);
alter table public.admin_login_failures enable row level security;
revoke all on table public.admin_login_failures from anon, authenticated;
grant all on table public.admin_login_failures to service_role;
grant usage, select on sequence public.admin_login_failures_id_seq to service_role;
-- ménage : on ne garde que 2 jours
delete from public.admin_login_failures where created_at < now() - interval '2 days';

-- 2) Secret entre le Worker Cloudflare (emails reçus) et la fonction « boutique »
insert into public.settings (key, value)
values ('inbound_secret', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
on conflict (key) do nothing;

-- 3) Comptage rapide des demandes de lien de connexion (limite pour tout le site)
create index if not exists customer_sessions_kind_time on public.customer_sessions (kind, created_at desc);
create index if not exists parrain_sessions_kind_time  on public.parrain_sessions (kind, created_at desc);

-- 4) Ancienne table des liens de téléchargement : accès public fermé (au cas où)
alter table public.downloads enable row level security;
revoke all on table public.downloads from anon, authenticated;
grant all on table public.downloads to service_role;

-- 5) L'espace des logiciels reste privé
update storage.buckets set public = false where id = 'installers';

-- Vérification : tout doit afficher « true » / « false » comme indiqué
select
  (select relrowsecurity from pg_class where oid = 'public.downloads'::regclass)            as downloads_protegee_doit_etre_true,
  (select public from storage.buckets where id = 'installers')                                as installers_public_doit_etre_false,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)                as tables_non_protegees_doit_etre_0;

-- Pour copier le secret dans Cloudflare (à lancer vous-même, ne le partagez avec personne) :
-- select value #>> '{}' as secret_inbound from public.settings where key = 'inbound_secret';
