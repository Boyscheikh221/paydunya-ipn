-- ============================================================
-- 25 : Descriptions des produits (brouillons)
-- Crée les produits en BROUILLON (non visibles), prix à 0 à remplir.
-- Office 2024 (déjà en ligne) : nom professionnel, description ajoutée seulement si vide.
-- À coller dans Supabase > SQL Editor > Run (une seule fois).
-- ============================================================

update public.products set name = $q$Microsoft Office 2024 Professionnel Plus — Licence 1 PC$q$, description = case when coalesce(description, '') = '' then $q$La dernière version d'Office à achat unique : vous payez une fois, sans abonnement.

Ce qui est inclus :
• Word, Excel, PowerPoint, Outlook
• Access et Publisher
• OneNote

Pour qui ? Étudiants, bureaux, commerçants, indépendants : tout ce qu'il faut pour vos documents, factures, tableaux et présentations.

Caractéristiques :
• Licence pour 1 PC
• Compatible Windows 10 et Windows 11 (non compatible Mac)
• Version 64 bits, en français
• Pas d'abonnement : la licence n'expire pas

Livraison :
1. Après le paiement, vous recevez par email le lien de téléchargement et le guide d'installation.
2. Une fois l'installation terminée, cliquez sur « J'ai fini l'installation » : votre clé d'activation vous est envoyée.

Paiement : Wave, Orange Money ou carte bancaire.
Assistance : besoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp ou à contact@licenceoff.com, on vous accompagne.$q$ else description end,
  seo_description = coalesce(seo_description, $q$Office 2024 Professionnel Plus pour PC Windows : Word, Excel, PowerPoint, Outlook. Licence à vie, livraison par email, paiement Wave ou Orange Money.$q$)
  where slug = 'office-2024';

insert into public.products (slug, name, category_id, delivery_type, two_step, active, price_fcfa, description, seo_description, sort, stock_qty)
  select 'office-2021-pro-plus', $q$Microsoft Office 2021 Professionnel Plus — Licence 1 PC$q$, (select id from public.categories where slug = 'office-2021'), 'key_file', true, false, 0, $q$Une version d'Office éprouvée et stable, à achat unique et sans abonnement.

Ce qui est inclus :
• Word, Excel, PowerPoint, Outlook
• Access et Publisher
• OneNote

Caractéristiques :
• Licence pour 1 PC
• Compatible Windows 10 et Windows 11 (non compatible Mac)
• En français
• Pas d'abonnement

Livraison :
1. Après le paiement, vous recevez par email le lien de téléchargement et le guide d'installation.
2. Une fois l'installation terminée, cliquez sur « J'ai fini l'installation » : votre clé d'activation vous est envoyée.

Paiement : Wave, Orange Money ou carte bancaire.
Assistance : besoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp ou à contact@licenceoff.com, on vous accompagne.$q$, $q$Office 2021 Professionnel Plus pour PC Windows : Word, Excel, PowerPoint, Outlook. Achat unique, livraison par email, Wave ou Orange Money.$q$, 20, null
  on conflict (slug) do nothing;

insert into public.products (slug, name, category_id, delivery_type, two_step, active, price_fcfa, description, seo_description, sort, stock_qty)
  select 'office-2019-pro-plus', $q$Microsoft Office 2019 Professionnel Plus — Licence 1 PC$q$, (select id from public.categories where slug = 'office-2019'), 'key_file', true, false, 0, $q$La solution la plus économique pour avoir Word, Excel et PowerPoint sur votre PC.

Ce qui est inclus :
• Word, Excel, PowerPoint, Outlook
• Access et Publisher
• OneNote

Caractéristiques :
• Licence pour 1 PC
• Compatible Windows 10 et Windows 11 (non compatible Mac)
• En français
• Pas d'abonnement

Bon à savoir : Microsoft ne publie plus de mises à jour pour Office 2019 depuis octobre 2025. Le logiciel fonctionne toujours, mais nous conseillons Office 2021 ou 2024 pour un usage professionnel.

Livraison :
1. Après le paiement, vous recevez par email le lien de téléchargement et le guide d'installation.
2. Une fois l'installation terminée, cliquez sur « J'ai fini l'installation » : votre clé d'activation vous est envoyée.

Paiement : Wave, Orange Money ou carte bancaire.
Assistance : besoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp ou à contact@licenceoff.com, on vous accompagne.$q$, $q$Office 2019 Professionnel Plus pour PC Windows : Word, Excel, PowerPoint, Outlook. Prix doux, livraison par email, Wave ou Orange Money.$q$, 30, null
  on conflict (slug) do nothing;

insert into public.products (slug, name, category_id, delivery_type, two_step, active, price_fcfa, description, seo_description, sort, stock_qty)
  select 'microsoft-365-12-mois', $q$Microsoft 365 — Abonnement 1 an, 5 appareils (PC et Mac)$q$, (select id from public.categories where slug = 'microsoft-365'), 'key_file', false, false, 0, $q$Office toujours à jour sur tous vos appareils, lié à votre propre compte Outlook.

Ce qui est inclus :
• Word, Excel, PowerPoint, Outlook, OneNote
• Stockage en ligne OneDrive
• Mises à jour et nouveautés comprises pendant toute la durée

Caractéristiques :
• Durée : 1 an
• Activé sur votre compte Outlook (Microsoft) : vous gardez vos fichiers et vos réglages
• Utilisable sur 5 appareils en même temps
• Compatible PC Windows et Mac, ainsi que tablette et téléphone

Livraison : après le paiement, vous recevez par email votre code et les étapes pour l'activer sur votre compte Outlook. Pas encore de compte ? Il se crée gratuitement en quelques minutes, on vous aide.

Paiement : Wave, Orange Money ou carte bancaire.
Assistance : on vous aide à activer, sur WhatsApp ou à contact@licenceoff.com.$q$, $q$Microsoft 365 pour 1 an sur votre compte Outlook : Word, Excel, PowerPoint toujours à jour, utilisable sur 5 appareils en même temps, PC et Mac.$q$, 40, null
  on conflict (slug) do nothing;

insert into public.products (slug, name, category_id, delivery_type, two_step, active, price_fcfa, description, seo_description, sort, stock_qty)
  select 'windows-11-pro', $q$Microsoft Windows 11 Professionnel — Licence 1 PC$q$, (select id from public.categories where slug = 'windows-11'), 'key_file', true, false, 0, $q$Activez Windows 11 Professionnel et profitez d'un PC complet, sécurisé et sans message « Activer Windows ».

Pourquoi la version Pro ?
• Chiffrement des disques BitLocker
• Bureau à distance
• Gestion avancée pour les entreprises
• Toutes les fonctions de Windows 11 Famille

Caractéristiques :
• Licence pour 1 PC
• Fonctionne aussi pour passer de Windows 11 Famille à Professionnel
• Le PC doit être compatible Windows 11 (processeur récent, TPM 2.0) : en cas de doute, demandez-nous avant d'acheter

Livraison :
1. Après le paiement, vous recevez par email le lien de téléchargement et le guide d'installation.
2. Une fois l'installation terminée, cliquez sur « J'ai fini l'installation » : votre clé d'activation vous est envoyée.

Paiement : Wave, Orange Money ou carte bancaire.
Assistance : besoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp ou à contact@licenceoff.com, on vous accompagne.$q$, $q$Clé Windows 11 Professionnel pour 1 PC : activation à vie, livraison par email avec guide d'installation, paiement Wave ou Orange Money.$q$, 10, null
  on conflict (slug) do nothing;

insert into public.products (slug, name, category_id, delivery_type, two_step, active, price_fcfa, description, seo_description, sort, stock_qty)
  select 'windows-10-pro', $q$Microsoft Windows 10 Professionnel — Licence 1 PC$q$, (select id from public.categories where slug = 'windows-10'), 'key_file', true, false, 0, $q$Activez Windows 10 Professionnel sur votre PC, idéal pour les ordinateurs qui ne peuvent pas passer à Windows 11.

Ce qui est inclus :
• Toutes les fonctions de Windows 10 Famille
• BitLocker, Bureau à distance, gestion avancée

Caractéristiques :
• Licence pour 1 PC
• Permet aussi de passer de Windows 10 Famille à Professionnel

Bon à savoir : Microsoft a arrêté les mises à jour gratuites de Windows 10 en octobre 2025. Windows 10 fonctionne toujours, mais si votre PC est compatible, nous conseillons Windows 11.

Livraison :
1. Après le paiement, vous recevez par email le lien de téléchargement et le guide d'installation.
2. Une fois l'installation terminée, cliquez sur « J'ai fini l'installation » : votre clé d'activation vous est envoyée.

Paiement : Wave, Orange Money ou carte bancaire.
Assistance : besoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp ou à contact@licenceoff.com, on vous accompagne.$q$, $q$Clé Windows 10 Professionnel pour 1 PC : activation, livraison par email avec guide d'installation, paiement Wave ou Orange Money.$q$, 20, null
  on conflict (slug) do nothing;

insert into public.products (slug, name, category_id, delivery_type, two_step, active, price_fcfa, description, seo_description, sort, stock_qty)
  select 'windows-server-2022-standard', $q$Microsoft Windows Server 2022 Standard — Licence$q$, (select id from public.categories where slug = 'windows-server'), 'key_file', true, false, 0, $q$Le système de Microsoft pour les serveurs d'entreprise : partage de fichiers, Active Directory, applications de gestion, virtualisation.

Caractéristiques :
• Édition Standard
• Pour un serveur physique ou une machine virtuelle
• Licence d'activation livrée par email

Pour les entreprises : besoin d'aide pour choisir l'édition, installer ou configurer votre serveur ? Contactez-nous avant l'achat sur WhatsApp ou à contact@licenceoff.com, nous vous conseillons gratuitement.

Livraison :
1. Après le paiement, vous recevez par email le lien de téléchargement et le guide d'installation.
2. Une fois l'installation terminée, cliquez sur « J'ai fini l'installation » : votre clé d'activation vous est envoyée.

Paiement : Wave, Orange Money ou carte bancaire.
Assistance : besoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp ou à contact@licenceoff.com, on vous accompagne.$q$, $q$Licence Windows Server 2022 Standard pour serveur d'entreprise : livraison par email, accompagnement à l'installation, paiement Wave ou OM.$q$, 30, null
  on conflict (slug) do nothing;

insert into public.products (slug, name, category_id, delivery_type, two_step, active, price_fcfa, description, seo_description, sort, stock_qty)
  select 'installation-depannage-pc', $q$Installation et dépannage informatique — Intervention technicien$q$, (select id from public.categories where slug = 'solutions-pc'), 'manual', false, false, 0, $q$Votre PC est lent, plante, ou vous voulez une installation propre ? On s'en occupe.

Ce que nous faisons :
• Installation ou réinstallation de Windows et d'Office
• Activation de vos licences
• Nettoyage et accélération du PC
• Suppression de virus et logiciels indésirables
• Sauvegarde et récupération de fichiers
• Installation de vos logiciels et imprimantes

Comment ça marche ?
1. Vous commandez et décrivez votre problème.
2. Nous vous contactons sur WhatsApp pour fixer le rendez-vous.
3. Intervention à distance, ou sur place à Dakar.

Paiement : Wave, Orange Money ou carte bancaire.$q$, $q$Installation de Windows et Office, nettoyage, lenteurs, virus, récupération de fichiers : dépannage PC à Dakar ou à distance par licenceoff.$q$, 10, null
  on conflict (slug) do nothing;

insert into public.products (slug, name, category_id, delivery_type, two_step, active, price_fcfa, description, seo_description, sort, stock_qty)
  select 'camera-surveillance-wifi', $q$Caméra de surveillance Wi-Fi — Vision nocturne et détection de mouvement$q$, (select id from public.categories where slug = 'cameras-surveillance'), 'physical', false, false, 0, $q$Surveillez votre maison, votre boutique ou votre bureau depuis votre téléphone, où que vous soyez.

Points forts :
• Vidéo en direct sur votre téléphone (application gratuite)
• Vision de nuit
• Détection de mouvement avec alerte sur le téléphone
• Enregistrement sur carte mémoire
• Micro et haut-parleur pour parler à distance

À compléter avant publication : marque, modèle, résolution (ex. 2 MP / 4 MP), intérieur ou extérieur, carte mémoire incluse ou non, garantie.

Livraison :
• Dakar : à domicile ou dépôt au bus
• Hors Dakar : contactez-nous sur WhatsApp

Installation : vous pouvez ajouter l'installation sur place à votre commande.$q$, $q$Caméra de surveillance Wi-Fi : vision de nuit, détection de mouvement, vidéo en direct sur votre téléphone. Livraison à Dakar.$q$, 10, 0
  on conflict (slug) do nothing;

insert into public.products (slug, name, category_id, delivery_type, two_step, active, price_fcfa, description, seo_description, sort, stock_qty)
  select 'installation-camera', $q$Installation de caméras de surveillance — Pose et configuration$q$, (select id from public.categories where slug = 'cameras-surveillance'), 'manual', false, false, 0, $q$Un technicien vient installer et configurer vos caméras.

Ce qui est compris :
• Conseils sur le meilleur emplacement
• Fixation de la caméra
• Connexion au Wi-Fi
• Installation de l'application sur votre téléphone et démonstration

Zone : Dakar et environs. Hors Dakar, contactez-nous sur WhatsApp pour un devis.

Bon à savoir : le prix est par caméra. Le câblage long ou le perçage spécial peuvent faire l'objet d'un devis.

Comment ça marche ?
1. Vous commandez.
2. Nous vous appelons sur WhatsApp pour fixer le rendez-vous.$q$, $q$Installation de caméras de surveillance à Dakar : pose, configuration sur votre téléphone et conseils de placement par un technicien.$q$, 20, null
  on conflict (slug) do nothing;

select slug, name, active, length(description) from public.products order by slug;
