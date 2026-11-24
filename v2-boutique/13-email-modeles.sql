-- licenceoff : modèles d'email (un par produit, sinon le modèle par défaut)
-- Relançable sans danger.
alter table public.orders add column if not exists emailed_at timestamptz;

create table if not exists public.email_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  subject    text not null,
  body       text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists email_templates_one_default on public.email_templates (is_default) where is_default;
alter table public.email_templates enable row level security;
revoke all on table public.email_templates from anon, authenticated;
grant all on table public.email_templates to service_role;

alter table public.products add column if not exists email_template_id uuid references public.email_templates(id) on delete set null;

-- Modèles de départ (modifiables dans l'admin, onglet Emails)
insert into public.email_templates (name, subject, body, is_default)
select 'Modèle général', 'Votre commande {commande} est prête — licenceoff',
'Bonjour {prenom},

Merci pour votre commande **{commande}** ({total}). Elle est prête !

{produits}

{cles}

{bouton}

Gardez cet email : votre page de commande regroupe vos clés et vos téléchargements.

Besoin d''aide pour installer ou activer ? [Écrivez-nous sur WhatsApp]({whatsapp}).', true
where not exists (select 1 from public.email_templates);

insert into public.email_templates (name, subject, body)
select 'Microsoft Office', 'Votre Microsoft Office est prêt — commande {commande}',
'Bonjour {prenom},

Suite à votre commande **{commande}**, voici votre Microsoft Office.

{cles}

**Téléchargement** : cliquez sur le bouton ci-dessous, puis sur « Télécharger le logiciel ». Le lien ne fonctionne qu''une seule fois : lancez-le depuis l''ordinateur où vous installez Office.

{bouton}

**Instructions d''installation :**

- Une fois le fichier téléchargé, ouvrez-le et suivez les étapes d''installation.
- Ouvrez Word, puis saisissez votre clé d''activation quand elle est demandée.
- Un souci ? Revenez vers nous sur [WhatsApp]({whatsapp}), on vous aide.'
where not exists (select 1 from public.email_templates where name = 'Microsoft Office');

update public.products set email_template_id = (select id from public.email_templates where name = 'Microsoft Office')
 where slug = 'office-2024' and email_template_id is null;
