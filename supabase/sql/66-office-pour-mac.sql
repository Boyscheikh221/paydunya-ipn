-- ============================================================
-- 66 : « Office pour Mac » avec choix de la version selon le macOS du client
-- À coller dans Supabase > SQL Editor > Run (une seule fois ; relancer ne crée pas de doublon).
--
-- • Sous-catégorie « Office pour Mac » (dans Microsoft Office).
-- • Produit « Microsoft Office pour Mac » (office-pour-mac) : la fiche du parcours en 3 étapes
--   (1. le client choisit son macOS, 2. il voit les versions d'Office compatibles et leur prix,
--   3. paiement en ligne si le site l'accepte, sinon WhatsApp avec un message déjà écrit).
--   Ce produit ne se met pas au panier : son prix affiché vient des versions.
-- • Produit « Office Standard 2024 pour Mac » (office-standard-2024-mac) : PRIX PROVISOIRE 25 000 FCFA,
--   à corriger dans l'admin (Produits). Livraison « manuelle » pour l'instant (vous livrez vous-même) ;
--   passez-le en « Clé » quand vous aurez des clés en stock.
--   Il n'apparaît pas dans les listes de produits : il se choisit seulement dans le parcours.
-- • Microsoft 365 (produit déjà en ligne) est aussi proposé dans le parcours, avec son prix actuel.
-- ============================================================
insert into public.categories (slug, name, sort, active, parent_id, description)
select 'office-mac', 'Office pour Mac', 5, true, (select id from public.categories where slug = 'microsoft-office'),
  'Microsoft Office pour Mac : choisissez votre version de macOS, nous vous montrons les versions d''Office compatibles.'
where not exists (select 1 from public.categories where slug = 'office-mac');

insert into public.products (slug, name, price_fcfa, delivery_type, active, category_id, sort, description, seo_title, seo_description)
select 'office-pour-mac', 'Microsoft Office pour Mac', 0, 'manual', true,
  (select id from public.categories where slug = 'office-mac'), 15,
$d$Word, Excel, PowerPoint et Outlook sur votre Mac, avec une licence authentique.

Comment ça marche :
• Étape 1 : vous nous indiquez votre version de macOS (nous vous montrons où la trouver, cela prend 10 secondes).
• Étape 2 : nous vous montrons seulement les versions d'Office qui fonctionnent sur votre Mac, avec leur prix.
• Étape 3 : vous choisissez, et nous finalisons votre commande.

Pourquoi choisir selon votre macOS ?
Microsoft fait fonctionner Office pour Mac sur les trois versions les plus récentes de macOS (aujourd'hui macOS Tahoe 26, Sequoia 15 et Sonoma 14). Sur un Mac plus ancien, certaines versions ne s'installent pas ou ne reçoivent plus de mises à jour : nous vous évitons un mauvais achat.

Livraison : par email, avec le guide d'installation pour Mac.
Paiement : Wave ou Orange Money.
Assistance : besoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp ou à contact@licenceoff.com, on vous accompagne.$d$,
'Microsoft Office pour Mac — licence authentique | licenceoff.com',
'Office pour Mac : choisissez votre version de macOS et voyez les versions d''Office compatibles (Office 2024, Microsoft 365) avec leur prix. Paiement Wave ou Orange Money.'
where not exists (select 1 from public.products where slug = 'office-pour-mac');

insert into public.products (slug, name, price_fcfa, delivery_type, active, category_id, sort, description, seo_description)
select 'office-standard-2024-mac', 'Office Standard 2024 pour Mac', 25000, 'manual', true,
  (select id from public.categories where slug = 'office-mac'), 16,
$d$La suite Office 2024 pour Mac, à vie, sans abonnement.

Ce qui est inclus : Word, Excel, PowerPoint, Outlook et OneNote.

Caractéristiques :
• Licence pour 1 Mac, à vie (pas d'abonnement)
• Compatible macOS Tahoe 26, Sequoia 15 et Sonoma 14
• En français, Mac Intel et Apple Silicon (M1, M2, M3, M4…)

Livraison : par email, avec le guide d'installation pour Mac.
Assistance : on vous aide à installer et activer, sur WhatsApp ou à contact@licenceoff.com.$d$,
'Office Standard 2024 pour Mac : Word, Excel, PowerPoint, Outlook, licence à vie pour 1 Mac. Paiement Wave ou Orange Money.'
where not exists (select 1 from public.products where slug = 'office-standard-2024-mac');

select concat_ws(' ~ ', slug, name, price_fcfa, delivery_type, active) from public.products
 where slug in ('office-pour-mac', 'office-standard-2024-mac', 'microsoft-365-abonnement-1-an-5-appareils-pc-et-mac');
