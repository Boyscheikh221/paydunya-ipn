-- 34 : compteur des emails envoyés (gardé sans limite de durée, contrairement au Journal : 90 jours)
--      + consentement aux offres par email (newsletter), pour des campagnes d'emailing légales.
create table if not exists public.email_sends (
  id bigserial primary key,
  to_email text not null,
  subject text,
  created_at timestamptz not null default now()
);
create index if not exists email_sends_created_idx on public.email_sends (created_at desc);
create index if not exists email_sends_to_idx on public.email_sends (to_email);
alter table public.email_sends enable row level security;
grant select, insert on public.email_sends to service_role;
grant usage, select on sequence public.email_sends_id_seq to service_role;

-- reprise : les emails déjà envoyés qui sont encore dans le Journal
insert into public.email_sends (to_email, subject, created_at)
select lower(trim(substring(message from 'Email envoyé à (\S+) :'))), substring(message from '« (.*) »$'), created_at
  from public.app_logs
 where message like 'Email envoyé à %'
   and not exists (select 1 from public.email_sends);

create table if not exists public.marketing_contacts (
  email text primary key,
  optin boolean not null default false,
  source text,                  -- commande, compte, admin
  optin_at timestamptz,
  unsub_at timestamptz,
  token text unique not null default replace(gen_random_uuid()::text, '-', ''),  -- lien de désinscription
  updated_at timestamptz not null default now()
);
alter table public.marketing_contacts enable row level security;
grant select, insert, update on public.marketing_contacts to service_role;

select (select count(*) from public.email_sends) as emails_envoyes, (select count(*) from public.marketing_contacts where optin) as inscrits;
