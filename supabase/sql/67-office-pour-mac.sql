-- ============================================================
-- 67 : « Office pour Mac » — 4 versions vendues séparément + page « Vérifier la compatibilité »
-- À coller dans Supabase > SQL Editor > Run (une seule fois ; relancer ne crée pas de doublon).
--
-- • Sous-catégorie « Office pour Mac » (dans Microsoft Office).
-- • 4 produits, prix donnés par Cheikh le 27/11/2026 (modifiables dans l'admin, Produits) :
--     Office Standard 2024 pour Mac 11 500 · Office 2021 pour Mac 8 500 · Office 2019 pour Mac 5 000 · Office 2016 pour Mac 3 450 FCFA
--   Livraison « manuelle » pour l'instant (vous livrez vous-même) ; passez-les en « Clé » quand vous aurez des clés en stock.
--   Sur leur fiche, le bouton « Vérifier la compatibilité avec mon Mac » remplace le panier.
-- • Produit « Microsoft Office pour Mac » (office-pour-mac) : la page de vérification
--   (1. le client choisit son macOS, 2. il voit les versions compatibles et leur prix,
--   3. paiement en ligne si le site l'accepte, sinon WhatsApp avec un message déjà écrit).
--   Elle n'apparaît pas dans les listes : on y arrive par le bouton des fiches.
-- • Microsoft 365 (produit déjà en ligne) est aussi proposé sur la page de vérification, avec son prix actuel.
-- ============================================================
insert into public.categories (slug, name, sort, active, parent_id, description)
select 'office-mac', 'Office pour Mac', 5, true, (select id from public.categories where slug = 'microsoft-office'),
  'Microsoft Office pour Mac : choisissez votre version de macOS, nous vous montrons les versions d''Office compatibles.'
where not exists (select 1 from public.categories where slug = 'office-mac');

insert into public.products (slug, name, price_fcfa, delivery_type, active, category_id, sort, description, seo_title, seo_description)
select 'office-pour-mac', 'Microsoft Office pour Mac', 0, 'manual', true,
  (select id from public.categories where slug = 'office-mac'), 15,
$d$Quelle version d'Office pour votre Mac ? Office 2024, 2021, 2019 ou 2016 : vérifiez en 10 secondes celles qui fonctionnent sur votre Mac.

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
'Office pour Mac : choisissez votre version de macOS et voyez les versions d''Office compatibles (Office 2024, 2021, 2019, 2016, Microsoft 365) avec leur prix. Paiement Wave ou Orange Money.'
where not exists (select 1 from public.products where slug = 'office-pour-mac');

insert into public.products (slug, name, price_fcfa, delivery_type, active, category_id, sort, description, seo_description)
select 'office-standard-2024-mac', 'Office Standard 2024 pour Mac', 11500, 'manual', true,
  (select id from public.categories where slug = 'office-mac'), 16,
$d$La suite Office 2024 pour Mac, à vie, sans abonnement : la version la plus récente.

Ce qui est inclus : Word, Excel, PowerPoint, Outlook et OneNote.

Caractéristiques :
• Licence pour 1 Mac, à vie (pas d'abonnement)
• Compatible macOS Tahoe 26, Sequoia 15 et Sonoma 14, Mac Intel et Apple Silicon (M1, M2, M3, M4…)
• En français

Avant de commander : cliquez sur « Vérifier la compatibilité avec mon Mac ». Nous vous montrons les versions qui fonctionnent sur votre Mac.

Livraison : par email, avec le guide d'installation pour Mac.
Assistance : on vous aide à installer et activer, sur WhatsApp ou à contact@licenceoff.com.$d$,
'Office Standard 2024 pour Mac : Word, Excel, PowerPoint, Outlook, licence à vie pour 1 Mac. Paiement Wave ou Orange Money.'
where not exists (select 1 from public.products where slug = 'office-standard-2024-mac');

insert into public.products (slug, name, price_fcfa, delivery_type, active, category_id, sort, description, seo_description)
select 'office-2021-mac', 'Office 2021 pour Mac', 8500, 'manual', true,
  (select id from public.categories where slug = 'office-mac'), 17,
$d$La suite Office 2021 pour Mac, à vie, sans abonnement.

Ce qui est inclus : Word, Excel, PowerPoint, Outlook et OneNote.

Caractéristiques :
• Licence pour 1 Mac, à vie (pas d'abonnement)
• Microsoft ne met plus à jour Office 2021 depuis le 13 octobre 2026 : nous vérifions avec vous qu'il s'active bien sur votre Mac
• En français

Avant de commander : cliquez sur « Vérifier la compatibilité avec mon Mac ». Nous vous montrons les versions qui fonctionnent sur votre Mac.

Livraison : par email, avec le guide d'installation pour Mac.
Assistance : on vous aide à installer et activer, sur WhatsApp ou à contact@licenceoff.com.$d$,
'Office 2021 pour Mac : Word, Excel, PowerPoint, Outlook, licence à vie pour 1 Mac. Compatibilité vérifiée avec vous.'
where not exists (select 1 from public.products where slug = 'office-2021-mac');

insert into public.products (slug, name, price_fcfa, delivery_type, active, category_id, sort, description, seo_description)
select 'office-2019-mac', 'Office 2019 pour Mac', 5000, 'manual', true,
  (select id from public.categories where slug = 'office-mac'), 18,
$d$La suite Office 2019 pour Mac, à vie, sans abonnement : une solution économique, aussi pour les Mac plus anciens.

Ce qui est inclus : Word, Excel, PowerPoint, Outlook et OneNote.

Caractéristiques :
• Licence pour 1 Mac, à vie (pas d'abonnement)
• Version qui n'est plus mise à jour par Microsoft : nous vérifions avec vous qu'elle s'active bien sur votre Mac
• En français

Avant de commander : cliquez sur « Vérifier la compatibilité avec mon Mac ». Nous vous montrons les versions qui fonctionnent sur votre Mac.

Livraison : par email, avec le guide d'installation pour Mac.
Assistance : on vous aide à installer et activer, sur WhatsApp ou à contact@licenceoff.com.$d$,
'Office 2019 pour Mac : Word, Excel, PowerPoint, Outlook, licence à vie pour 1 Mac, idéal pour les Mac plus anciens.'
where not exists (select 1 from public.products where slug = 'office-2019-mac');

insert into public.products (slug, name, price_fcfa, delivery_type, active, category_id, sort, description, seo_description)
select 'office-2016-mac', 'Office 2016 pour Mac', 3450, 'manual', true,
  (select id from public.categories where slug = 'office-mac'), 19,
$d$La suite Office 2016 pour Mac, à vie, sans abonnement : pensée pour les Mac anciens (macOS Big Sur, Catalina et avant).

Ce qui est inclus : Word, Excel, PowerPoint, Outlook et OneNote.

Caractéristiques :
• Licence pour 1 Mac, à vie (pas d'abonnement)
• Pour les Mac anciens ; version qui n'est plus mise à jour par Microsoft : nous vérifions avec vous qu'elle s'active bien sur votre Mac
• En français

Avant de commander : cliquez sur « Vérifier la compatibilité avec mon Mac ». Nous vous montrons les versions qui fonctionnent sur votre Mac.

Livraison : par email, avec le guide d'installation pour Mac.
Assistance : on vous aide à installer et activer, sur WhatsApp ou à contact@licenceoff.com.$d$,
'Office 2016 pour Mac : Word, Excel, PowerPoint, Outlook, licence à vie pour les Mac anciens.'
where not exists (select 1 from public.products where slug = 'office-2016-mac');

select concat_ws(' ~ ', slug, name, price_fcfa, delivery_type, active) from public.products
 where slug in ('office-pour-mac', 'office-standard-2024-mac', 'office-2021-mac', 'office-2019-mac', 'office-2016-mac', 'microsoft-365-abonnement-1-an-5-appareils-pc-et-mac') order by sort;
