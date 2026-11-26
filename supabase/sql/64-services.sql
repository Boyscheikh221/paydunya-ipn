-- =====================================================================
-- 64 — Services sur devis (Analyse de données, Google Ads)
--   • table services : une page par service (www.licenceoff.com/services/<adresse>), texte, certificat,
--     questionnaire (liste de questions) ; modifiable dans l'admin, onglet Services.
--   • table service_requests : les demandes de devis envoyées par le questionnaire.
--   • un produit caché « Prestation — … » par service, pour faire le devis (onglet Devis) puis la commande et la facture.
-- Pas de prix affiché : le client remplit le questionnaire, Cheikh envoie le devis par email.
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================

create table if not exists public.services (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,                  -- adresse : /services/<slug>
  title           text not null,
  short           text,                                  -- résumé (carte de la page Services, Google)
  content         text,                                  -- texte de la page (petit Markdown, comme les pages)
  icon            text not null default 'chart',         -- chart | megaphone | code | shield
  image_url       text,
  cert_title      text,                                  -- ex. Certificat professionnel Google Ads
  cert_issuer     text,                                  -- ex. Google, sur Coursera
  cert_image_url  text,                                  -- photo du certificat
  cert_url        text,                                  -- lien de vérification (Coursera…)
  questions       jsonb not null default '[]',           -- [{label, type: text|long|one|many, options:[], required}]
  product_id      uuid references public.products(id) on delete set null, -- produit caché utilisé dans les devis
  published       boolean not null default false,
  sort            int not null default 0,
  seo_title       text,
  seo_description text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.services enable row level security;

create table if not exists public.service_requests (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique not null,                    -- ex. SV-2611-7KQ3P (donné au client)
  service_id    uuid references public.services(id) on delete set null,
  service_title text not null,
  name          text not null,
  company       text,
  email         text not null,
  phone         text,
  deadline      text,
  answers       jsonb not null default '[]',             -- [{q, a}] : réponses au questionnaire
  message       text,
  status        text not null default 'new' check (status in ('new','talking','quoted','won','lost')),
  quote_id      uuid references public.quotes(id) on delete set null,
  admin_note    text,
  ip            text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists service_requests_time_idx on public.service_requests (created_at desc);
create index if not exists service_requests_status_idx on public.service_requests (status);
alter table public.service_requests enable row level security;

revoke all on table public.services, public.service_requests from anon, authenticated;
grant select, insert, update, delete on public.services, public.service_requests to service_role;

-- devis : lien vers la demande d'origine
alter table public.quotes add column if not exists request_id uuid references public.service_requests(id) on delete set null;

-- produits cachés (brouillons, jamais visibles dans la boutique) pour les lignes de devis
insert into public.products (name, slug, price_fcfa, delivery_type, active, description)
select 'Prestation — Analyse de données', 'prestation-analyse-de-donnees', 0, 'manual', false,
       'Produit interne pour les devis du service Analyse de données (ne pas publier).'
where not exists (select 1 from public.products where slug = 'prestation-analyse-de-donnees');
insert into public.products (name, slug, price_fcfa, delivery_type, active, description)
select 'Prestation — Campagnes Google Ads', 'prestation-google-ads', 0, 'manual', false,
       'Produit interne pour les devis du service Google Ads (ne pas publier).'
where not exists (select 1 from public.products where slug = 'prestation-google-ads');

-- ---------- Service 1 : Analyse de données ----------
insert into public.services (slug, title, short, icon, sort, published, cert_title, cert_issuer, product_id, seo_title, seo_description, content, questions)
select 'analyse-de-donnees', 'Analyse de données',
  'Transformez vos fichiers Excel et vos chiffres de ventes en tableaux de bord clairs, pour décider plus vite.',
  'chart', 1, true,
  'Certificat de Data Analyst', 'Formation universitaire',
  (select id from public.products where slug = 'prestation-analyse-de-donnees'),
  'Analyse de données et tableaux de bord à Dakar — licenceoff.com',
  'Tableaux de bord, nettoyage de fichiers Excel, analyse des ventes et des clients pour les entreprises au Sénégal. Devis gratuit par email.',
$c$Vos ventes, vos stocks et vos clients sont dans des fichiers Excel, un logiciel de caisse ou un cahier ? Je les rassemble, je les nettoie et je les transforme en **tableaux de bord simples** qui répondent à vos vraies questions.

## Ce que je peux faire pour vous
- **Tableau de bord de suivi** : chiffre d'affaires, ventes par produit, par mois, par vendeur, mis à jour facilement.
- **Nettoyage et organisation de vos fichiers** : doublons, erreurs de saisie, fichiers éparpillés réunis en un seul.
- **Analyse de vos clients** : qui achète, quoi, à quelle fréquence, quels clients vous perdez.
- **Rapport ponctuel** : une étude claire sur une question précise (rentabilité d'un produit, saison haute, etc.).

## Comment ça se passe
1. Vous remplissez le questionnaire ci-dessous (2 minutes).
2. Je vous envoie un devis gratuit par email, adapté à votre besoin.
3. Après votre accord, je réalise le travail et je vous explique les résultats.

Vos données restent confidentielles : elles ne servent qu'à votre projet.$c$,
$q$[
 {"label":"Que voulez-vous faire ?","type":"many","required":true,"options":["Un tableau de bord de suivi","Nettoyer et organiser mes fichiers","Analyser mes clients","Un rapport sur une question précise","Autre"]},
 {"label":"Où sont vos données aujourd'hui ?","type":"many","required":true,"options":["Excel","Google Sheets","Logiciel de caisse ou de gestion","Base de données","Sur papier","Je ne sais pas"]},
 {"label":"Quelle quantité de données, environ ?","type":"one","required":false,"options":["Moins de 1 000 lignes","De 1 000 à 50 000 lignes","Plus de 50 000 lignes","Je ne sais pas"]},
 {"label":"Votre secteur d'activité","type":"text","required":false,"options":[]},
 {"label":"Budget prévu pour cette prestation","type":"one","required":false,"options":["Moins de 50 000 FCFA","50 000 à 150 000 FCFA","150 000 à 500 000 FCFA","Plus de 500 000 FCFA","Je ne sais pas encore"]}
]$q$::jsonb
where not exists (select 1 from public.services where slug = 'analyse-de-donnees');

-- ---------- Service 2 : Google Ads ----------
insert into public.services (slug, title, short, icon, sort, published, cert_title, cert_issuer, product_id, seo_title, seo_description, content, questions)
select 'google-ads', 'Campagnes Google Ads',
  'Des clients qui vous trouvent sur Google au moment où ils vous cherchent. Création et suivi de vos campagnes, aussi sur Facebook et Instagram.',
  'megaphone', 2, true,
  'Certificat professionnel Google Ads', 'Google, sur Coursera',
  (select id from public.products where slug = 'prestation-google-ads'),
  'Gestion de campagnes Google Ads au Sénégal — licenceoff.com',
  'Création et gestion de vos publicités Google Ads (et Facebook / Instagram) pour plus d''appels, de messages et de ventes. Certifié Google Ads. Devis gratuit.',
$c$Vous voulez plus d'appels, plus de messages WhatsApp ou plus de ventes ? Je crée et je gère vos **publicités Google Ads**, pour que votre entreprise apparaisse quand vos futurs clients cherchent ce que vous vendez. Je peux aussi gérer vos publicités **Facebook et Instagram**.

## Ce que je fais
- **Analyse de départ** : votre activité, vos concurrents, les mots que tapent vos clients.
- **Création des campagnes** : annonces, mots-clés, zone visée (Dakar, tout le Sénégal…), budget maîtrisé.
- **Suivi des résultats** : appels, messages, visites, ventes. Je mesure ce que rapporte chaque franc dépensé.
- **Optimisation chaque semaine** et un compte rendu clair, sans jargon.

## Comment ça se passe
1. Vous remplissez le questionnaire ci-dessous (2 minutes).
2. Je vous envoie un devis gratuit par email.
3. Après votre accord, je lance vos campagnes et je vous tiens informé des résultats.

Le budget publicitaire (payé à Google ou à Meta) est séparé de ma prestation : je vous conseille le bon montant pour commencer.$c$,
$q$[
 {"label":"Sur quelles plateformes ?","type":"many","required":true,"options":["Google (recherche, YouTube, Maps)","Facebook et Instagram","Je ne sais pas, conseillez-moi"]},
 {"label":"Votre objectif principal","type":"one","required":true,"options":["Plus d'appels ou de messages WhatsApp","Plus de ventes sur mon site","Plus de visites dans ma boutique","Faire connaître ma marque","Autre"]},
 {"label":"Avez-vous un site internet ?","type":"one","required":true,"options":["Oui","Non","Seulement une page Facebook ou Instagram"]},
 {"label":"Avez-vous déjà fait de la publicité en ligne ?","type":"one","required":false,"options":["Non, jamais","Oui, moi-même","Oui, avec une agence ou un prestataire"]},
 {"label":"Zone visée","type":"text","required":false,"options":[]},
 {"label":"Budget publicitaire par mois (payé à Google ou Meta)","type":"one","required":false,"options":["Moins de 50 000 FCFA","50 000 à 150 000 FCFA","150 000 à 500 000 FCFA","Plus de 500 000 FCFA","Je ne sais pas encore"]}
]$q$::jsonb
where not exists (select 1 from public.services where slug = 'google-ads');

-- les produits cachés ne doivent jamais apparaître dans la boutique
update public.products set active = false where slug in ('prestation-analyse-de-donnees', 'prestation-google-ads') and active;

select slug, title, published, (product_id is not null) as produit_devis from public.services order by sort;
