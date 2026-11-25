-- 58 — Nouveau produit en brouillon : Microsoft Project 2024 Professionnel (25/11/2026)
--   Produit digital, catégorie Office 2024, livraison comme Office 2024 (clé + logiciel, en 2 temps),
--   CACHÉ (brouillon), prix à 0 : Cheikh remplit le prix, le lien du logiciel et les clés dans l'admin.
--   Peut être relancé sans risque (n'insère pas deux fois).
insert into public.products (slug, name, category_id, delivery_type, two_step, auto_deliver, active, price_fcfa, description, seo_description)
select 'microsoft-project-2024-professionnel',
       $q$Microsoft Project 2024 Professionnel — Licence 1 PC$q$,
       (select id from public.categories where slug = 'office-2024'),
       coalesce((select delivery_type from public.products where slug = 'office-2024'), 'key_file'),
       coalesce((select two_step from public.products where slug = 'office-2024'), true),
       coalesce((select auto_deliver from public.products where slug = 'office-2024'), true),
       false, 0,
$q$Le logiciel de Microsoft pour planifier et suivre vos projets, à achat unique : vous payez une fois, sans abonnement.

Ce qu'il permet :
• Planifier les tâches, les délais et les étapes clés d'un projet
• Diagramme de Gantt, chemin critique et calendrier
• Gérer les ressources (personnes, matériel) et leur charge de travail
• Suivre l'avancement et les coûts, comparer avec le planning prévu
• Rapports prêts à l'emploi et export vers Excel

Pour qui ? Chefs de projet, bureaux d'études, BTP, ingénieurs, entreprises et étudiants en gestion de projet.

Caractéristiques :
• Licence pour 1 PC
• Compatible Windows 10 et Windows 11 (non compatible Mac)
• Version 64 bits, en français
• Pas d'abonnement : la licence n'expire pas
• Fonctionne avec Office 2024 / Microsoft 365 déjà installé

Livraison :
1. Après le paiement, vous recevez par email le lien de téléchargement et le guide d'installation.
2. Une fois l'installation terminée, cliquez sur « J'ai fini l'installation » : votre clé d'activation vous est envoyée.

Paiement : Wave ou Orange Money.
Assistance : besoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp ou à contact@licenceoff.com, on vous accompagne.$q$,
$q$Microsoft Project 2024 Professionnel pour PC Windows : planning, Gantt, ressources et suivi de projet. Licence à vie, livraison par email, paiement Wave ou Orange Money.$q$
where not exists (select 1 from public.products where slug = 'microsoft-project-2024-professionnel');

select concat_ws(' ~ ', name, slug, price_fcfa, delivery_type, two_step, active, category_id is not null) from public.products where slug = 'microsoft-project-2024-professionnel';
