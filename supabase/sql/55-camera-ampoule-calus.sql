-- 55 — Nouveau produit en brouillon : Caméra ampoule Wi-Fi 360° CALUS E27 (V380 Pro) (25/11/2026)
--   Produit physique, catégorie Caméras de surveillance, CACHÉ (brouillon), prix à remplir par Cheikh.
--   Peut être relancé sans risque (n'insère pas deux fois).
insert into public.products (name, slug, price_fcfa, delivery_type, active, category_id, description, seo_description)
select 'Caméra de surveillance Ampoule Wi-Fi 360° — CALUS E27 (V380 Pro)',
       'camera-surveillance-ampoule-wifi-360-calus-e27-v380-pro',
       0, 'physical', false,
       (select id from public.categories where slug = 'cameras-surveillance'),
$d$Sécurisez votre maison, votre boutique ou votre bureau en deux minutes, sans percer de mur ni tirer de câbles. Cette caméra se visse simplement sur une douille d'ampoule standard (E27) et se connecte à votre Wi-Fi pour vous permettre de tout suivre en direct depuis votre téléphone, où que vous soyez.

Ce qu'elle fait au quotidien :
• Installation immédiate : Vissez-la comme une ampoule ordinaire, téléchargez l'application gratuite V380 Pro (Android & iOS), scannez le code et la caméra est prête.
• Zéro angle mort (Vision 360°) : Depuis l'application, faites pivoter l'objectif à distance (355° à l'horizontale et 90° à la verticale) pour inspecter chaque recoin de la pièce.
• Vision nocturne claire (Infrarouge + Couleur) : Équipée de LED blanches et infrarouges, elle filme aussi bien de jour comme en pleine obscurité, avec possibilité d'allumer la lumière à distance depuis votre smartphone.
• Micro et haut-parleur intégrés : Écoutez ce qui se passe sur place et parlez directement à travers la caméra (pratique pour interpeller un visiteur, parler à vos enfants ou dissuader un intrus).
• Alertes de mouvement sur téléphone : Dès qu'un mouvement suspect est détecté, vous recevez une notification instantanée sur votre mobile.
• Enregistrement continu sans abonnement : Insérez une carte mémoire MicroSD (jusqu'à 128 Go, non incluse) pour enregistrer les vidéos en boucle et les revoir à tout moment.

Caractéristiques techniques :
• Marque / Modèle : CALUS — V380 / V380 Pro E27 LED
• Culot : Standard E27 (alimentation secteur 220V)
• Résolution vidéo : Full HD 1080p
• Connectivité : Wi-Fi 2,4 GHz (non compatible avec le Wi-Fi 5 GHz seul)
• Rotation motorisée : 355° horizontal / 90° vertical
• Stockage : Emplacement carte MicroSD jusqu'à 128 Go (ou stockage Cloud en option)
• Usage : Intérieur (ou extérieur uniquement sous abri protégé de la pluie)

Contenu de la boîte :
• 1× Caméra ampoule Wi-Fi CALUS E27
• 1× Douille de fixation E27 (selon arrivage)
• 1× Manuel d'installation$d$,
'Caméra ampoule Wi-Fi 360° CALUS E27 (V380 Pro) : Full HD 1080p, vision nocturne, micro et haut-parleur, alertes sur téléphone. Se visse comme une ampoule.'
where not exists (select 1 from public.products where slug = 'camera-surveillance-ampoule-wifi-360-calus-e27-v380-pro');

select concat_ws(' ~ ', name, slug, price_fcfa, delivery_type, active, category_id is not null) from public.products where slug = 'camera-surveillance-ampoule-wifi-360-calus-e27-v380-pro';
