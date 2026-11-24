-- 42 — Page « Paiements » de l'admin.
--   * settings.payment_mode : mode de paiement actif du site. « whatsapp » (par défaut) = la commande est enregistrée,
--     puis le client finalise le paiement sur WhatsApp ; plus tard « wave », « paytech », « orange_money » ou « paydunya ».
--   * payment_providers : clés API des intégrateurs, CHIFFRÉES par la fonction admin (AES-GCM) avant d'arriver ici.
--     Personne ne peut les lire depuis le site (RLS sans règle) ; l'admin ne voit que « clé enregistrée ✓ ».
create table if not exists public.payment_providers (
  provider   text primary key check (provider in ('wave', 'paytech', 'orange_money', 'paydunya')),
  live       boolean not null default false,           -- false = mode test / sandbox
  secrets    jsonb not null default '{}'::jsonb,      -- { nom_du_champ: "v1:iv:texte_chiffré" }
  updated_at timestamptz not null default now()
);
alter table public.payment_providers enable row level security;
revoke all on public.payment_providers from anon, authenticated;

insert into public.settings (key, value) values ('payment_mode', '"whatsapp"'::jsonb) on conflict (key) do nothing;

select 'paiements prêts' as resultat;
