-- ============================================================
-- 66 : AVG Ultimate 2025 — Licence 1 appareil, 1 an (27/11/2026)
-- Crée la sous-catégorie « Antivirus et sécurité » (dans Logiciels),
-- le produit en BROUILLON (non visible) et son email « clé d'activation ».
-- Prix : 5 000 FCFA (donné par Cheikh le 27/11/2026).
-- Livraison : clé seule (le logiciel se télécharge sur le site officiel AVG, lien dans l'email).
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- ============================================================

insert into public.categories (slug, name, sort, parent_id, description)
select 'antivirus-securite', 'Antivirus et sécurité', 1, (select id from public.categories where slug = 'logiciels'),
  'Antivirus et logiciels de sécurité avec licence officielle : protection contre les virus, les ransomwares et le piratage, livrés par email.'
on conflict (slug) do nothing;

insert into public.products (slug, name, category_id, delivery_type, two_step, active, price_fcfa, description, seo_description, sort, stock_qty)
select 'avg-ultimate-2025-1-appareil-1-an', $q$AVG Ultimate 2025 — Licence 1 appareil, 1 an$q$,
  (select id from public.categories where slug = 'antivirus-securite'), 'key', false, false, 5000,
$q$Protégez et accélérez votre ordinateur ou votre téléphone avec AVG Ultimate 2025 : antivirus, nettoyage, VPN et anti-pistage réunis dans un seul abonnement, pour 1 appareil pendant 1 an.

Ce qui est inclus :
• AVG Internet Security : protection en temps réel contre les virus, les ransomwares, le phishing et les sites frauduleux, avec un pare-feu avancé et une protection de la webcam.
• AVG TuneUp : nettoie les fichiers inutiles, met en veille les applications gourmandes et accélère le démarrage pour redonner de la vitesse à votre appareil.
• AVG Secure VPN : chiffre votre connexion pour naviguer en toute confidentialité, surtout sur les Wi-Fi publics (hôtel, café, aéroport).
• AVG AntiTrack : bloque les pisteurs publicitaires et limite le suivi de votre activité en ligne.

Pour qui ? Particuliers, étudiants, indépendants : tous ceux qui veulent un appareil protégé et rapide, sans se compliquer la vie.

Caractéristiques :
• Licence pour 1 appareil : PC, Mac, smartphone ou tablette, au choix
• Durée : 1 an (12 mois à compter de l'activation)
• Windows 11, 10, 8/8.1 et 7 (32 et 64 bits)
• macOS 10.13 (High Sierra) ou plus récent
• Android 8.0 ou plus récent, iOS 14.0 ou plus récent
• En français
• Connexion Internet nécessaire pour le téléchargement, l'activation et les mises à jour

Livraison :
1. Après le paiement, vous recevez par email votre code d'activation officiel AVG Ultimate, le lien de téléchargement sur le site officiel AVG et le guide d'installation pas à pas.
2. Installez AVG, saisissez votre code : vos 12 mois de protection démarrent.

Paiement : Wave ou Orange Money.
Assistance : besoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp ou à contact@licenceoff.com, on vous accompagne.$q$,
$q$AVG Ultimate 2025 pour 1 appareil, 1 an : antivirus, TuneUp, VPN et AntiTrack. Code officiel livré par email, paiement Wave ou Orange Money.$q$,
  10, null
on conflict (slug) do nothing;

insert into public.email_templates (name, subject, body, kind)
select 'AVG Ultimate — clé d''activation', $q$Votre code d'activation AVG Ultimate — commande {commande}$q$,
$q$Bonjour {prenom},

Merci pour votre commande **{commande}**. Voici votre code d'activation AVG Ultimate 2025 (1 appareil, 1 an) :

{cles}

**1. Téléchargez AVG Ultimate** sur le site officiel : [www.avg.com/fr-fr/ultimate](https://www.avg.com/fr-fr/ultimate)
Installez-le sur l'appareil que vous voulez protéger (PC, Mac, téléphone ou tablette).

**2. Activez votre abonnement :**
1. Ouvrez AVG sur votre appareil.
2. Cliquez sur **Menu ☰**, puis sur **Saisir un code d'activation**.
3. Collez le code ci-dessus et validez.
4. Vos 12 mois de protection démarrent dès l'activation.

Gardez cet email précieusement : il contient votre code. Un souci pendant l'installation ou l'activation ? [Écrivez-nous sur WhatsApp]({whatsapp}), on vous accompagne. Votre commande : [{commande}]({lien_commande})

Cordialement,
L'équipe licenceoff.com$q$, 'key'
where not exists (select 1 from public.email_templates where name = 'AVG Ultimate — clé d''activation');

update public.products set email_template_id = coalesce(email_template_id, (select id from public.email_templates where name = 'AVG Ultimate — clé d''activation'))
 where slug = 'avg-ultimate-2025-1-appareil-1-an';

select p.slug, p.name, p.price_fcfa, p.active, c.name as categorie, (select name from public.email_templates t where t.id = p.email_template_id) as email
  from public.products p left join public.categories c on c.id = p.category_id where p.slug = 'avg-ultimate-2025-1-appareil-1-an';
