-- ============================================================
-- 22 : Journal (logs), notifications admin, rapport du lundi
-- À coller dans Supabase > SQL Editor > Run (une seule fois).
-- ============================================================

-- ---------- Journal des événements et erreurs ----------
-- Aucune clé, aucun mot de passe : les fonctions masquent les champs sensibles avant d'écrire ici.
create table if not exists public.app_logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  level       text not null default 'info' check (level in ('info', 'warn', 'error')),
  source      text not null,             -- paiement, email, livraison, connexion, boutique, admin, rapport, telechargement
  message     text not null,             -- phrase en clair
  detail      jsonb,                     -- détail technique (repliable dans l'admin)
  order_ref   text,
  seen        boolean not null default false
);
create index if not exists app_logs_created_idx on public.app_logs (created_at desc);
create index if not exists app_logs_unseen_idx on public.app_logs (level) where not seen;

alter table public.app_logs enable row level security;
revoke all on table public.app_logs from anon, authenticated;
grant all on table public.app_logs to service_role;

-- ---------- Réglages ----------
insert into public.settings (key, value) values ('weekly_report', 'true'::jsonb) on conflict (key) do nothing;
-- Jeton interne (aléatoire) qui permet à la tâche planifiée de demander le rapport. Ce n'est pas une clé d'API.
insert into public.settings (key, value)
  values ('cron_secret', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
  on conflict (key) do nothing;

-- ---------- Tâches planifiées (gratuit sur Supabase) ----------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Rapport chaque lundi à 8 h (heure de Dakar = UTC)
select cron.unschedule(jobid) from cron.job where jobname = 'licenceoff_rapport_lundi';
select cron.schedule('licenceoff_rapport_lundi', '0 8 * * 1', $job$
  select net.http_post(
    url     := 'https://vnzpxfoeiixiqxkhdnik.supabase.co/functions/v1/admin',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object('action', 'weekly_report', 'cron', (select value #>> '{}' from public.settings where key = 'cron_secret'))
  );
$job$);

-- Ménage : on garde 90 jours de journal
select cron.unschedule(jobid) from cron.job where jobname = 'licenceoff_menage_journal';
select cron.schedule('licenceoff_menage_journal', '30 3 * * *',
  $job$ delete from public.app_logs where created_at < now() - interval '90 days' $job$);

-- Vérification : doit afficher les 2 tâches
select jobname, schedule from cron.job where jobname like 'licenceoff_%';
