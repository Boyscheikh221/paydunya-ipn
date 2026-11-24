-- ============================================================
-- 23 : Messages des clients (boîte de réception dans l'admin)
-- Les emails reçus sur contact@ / commandes@ / support@licenceoff.com
-- passent par Cloudflare Email Routing → Worker → fonction boutique.
-- À coller dans Supabase > SQL Editor > Run (une seule fois).
-- ============================================================
create table if not exists public.inbox_messages (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  direction       text not null check (direction in ('in', 'out')),        -- in = reçu du client, out = votre réponse
  status          text not null default 'new' check (status in ('new', 'read', 'replied', 'archived')),
  customer_email  text not null,                                          -- l'adresse du client (sert à regrouper la conversation)
  customer_name   text,
  customer_id     uuid references public.customers(id) on delete set null,
  to_email        text,
  subject         text,
  body_text       text,
  attachments     jsonb,                                                  -- noms et tailles seulement (les fichiers ne sont pas gardés)
  message_id      text,
  in_reply_to     text,
  order_ref       text,
  auto_reply      boolean not null default false
);
create index if not exists inbox_email_idx on public.inbox_messages (customer_email, created_at);
create index if not exists inbox_created_idx on public.inbox_messages (created_at desc);
create unique index if not exists inbox_msgid_idx on public.inbox_messages (message_id) where message_id is not null and direction = 'in';

alter table public.inbox_messages enable row level security;
revoke all on table public.inbox_messages from anon, authenticated;
grant all on table public.inbox_messages to service_role;
