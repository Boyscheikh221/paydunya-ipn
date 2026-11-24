# licenceoff v3 — boutique multi-produits

**État au 22/11/2026 : tout est EN LIGNE** sur www.licenceoff.com (base Supabase, 4 fonctions, site Cloudflare).
Le code est aussi sur GitHub : Boyscheikh221/paydunya-ipn, branche `claude/project-thread-s0si18`.

## Contenu
| Fichier | Rôle |
|---|---|
| 6-boutique.sql | Tables de base : produits, commandes, stock de clés, visites |
| 11-boutique-multi.sql | v3 : catégories, panier à plusieurs articles, blog, FAQ, réglage livraison auto |
| 7-fonction-boutique.ts | Fonction « boutique » (publique) : catalogue, panier, suivi, blog, FAQ, visites |
| 8-fonction-download.ts | Fonction « download » : lien de téléchargement à usage unique |
| 9-fonction-admin.ts | Fonction « admin » : tableau de bord complet |
| 10-fonction-paydunya.ts | Fonction « paydunya » : paiement en ligne + livraison automatique |
| 12-email.sql, 13-email-modeles.sql | Email automatique et modèles d'email par produit |
| 14-cles-reutilisables.sql | Clés / sérialiseurs réutilisables |
| 15-livraison-2-temps.sql | Livraison en 2 temps (installer, puis recevoir la clé) |
| site/ | Les pages du site : accueil/boutique, produit, panier, commande, blog, article, FAQ, admin, dl |

## Pour remettre à jour (si un fichier change)
1. SQL : Supabase > SQL Editor > New query > coller le fichier > Run (relançable sans danger).
2. Fonction : Supabase > Edge Functions > la fonction > Code > tout remplacer > Deploy updates. « Verify JWT » reste désactivé.
3. Site : Cloudflare > Workers & Pages > licenceoff > Create deployment > envoyer TOUS les fichiers du dossier `site` (l'envoi remplace tout le site).
   Si shop.js ou shop.css change : augmenter le numéro `?v=4` dans toutes les pages (sinon les navigateurs gardent l'ancienne version jusqu'à 4 h).

## Adresses du site (SEO)
- Accueil `/` > Boutique `/boutique` > Catégorie `/categorie/licences-windows` > Produit `/produit/windows-11-pro`. Blog `/blog` > Article `/blog/mon-article`. FAQ `/faq`.
- Ces adresses sont créées par le fichier `site/_redirects`. Les anciennes adresses (produit.html?p=…) marchent toujours et sont remplacées par les nouvelles.
- Fil d'Ariane en haut des pages boutique, catégorie, produit, blog, article, FAQ. Page 404 utile (404.html).
- robots.txt (cache admin, panier, commande, dl) et sitemap.xml. Le plan du site toujours à jour : https://vnzpxfoeiixiqxkhdnik.supabase.co/functions/v1/boutique?sitemap=1
- L'adresse d'un produit = son « code » (slug) dans l'admin : choisissez des mots courts (ex. windows-11-pro). Le changer casse les anciens liens.

## Reste à faire par vous
- PayDunya : Supabase > Edge Functions > Secrets, créer PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY, PAYDUNYA_TOKEN (compte PayDunya > Intégrer notre API), PAYDUNYA_MODE = test, SITE_URL = https://www.licenceoff.com. Jamais dans le chat.
- Vos numéros Wave / Orange Money : `MANUAL_PAY` dans site/shop.js (aujourd'hui 77 786 07 77 partout, à confirmer).
- Les vrais prix : onglet Produits de l'admin (Office 2024 est à 15 000 FCFA, à confirmer).

## Au quotidien (admin : www.licenceoff.com/admin)
- Nouveau produit : onglet Produits. Choisir la catégorie, la photo, la description, le prix et le mode de livraison :
  clé seule, clé + logiciel, logiciel seul, identifiants du stock, ou service fait à la main.
  Pour un logiciel : choisir le fichier > « Envoyer le fichier » (50 Mo max sur l'offre gratuite).
- Ajouter des clés : onglet Stock > une clé par ligne. Chaque clé part une seule fois.
  Sérialiseur réutilisable : cochez « Réutilisable » avant d'ajouter. Il repart à chaque commande et n'est jamais épuisé (les clés à usage unique du même produit partent d'abord). Bouton « Rendre réutilisable / Passer en usage unique » sur chaque clé en stock.
- Vente WhatsApp : onglet « 📤 Envoi manuel ». Choisir le produit et l'email : la clé part avec le modèle d'email de ce produit, et la vente est enregistrée dans Commandes. Ou « Envoyer seulement l'email d'un produit » (sans clé).
- Livraison en 2 temps (fiche produit, case « Livraison en 2 temps ») : après le paiement, le client reçoit l'email d'installation (lien de téléchargement + bouton à usage unique « J'ai fini l'installation »). Au clic, la clé part avec l'email de la clé (tout de suite si la livraison auto est active, sinon la commande passe « À traiter » et vous cliquez « Livrer maintenant »). Dans Commandes, « 🔑 Envoyer la clé maintenant » n'attend pas le clic du client. Office 2024 est réglé ainsi.
- Modèles d'email : onglet Emails (un modèle par produit, choisi dans la fiche produit ; sinon le modèle par défaut).
- Livraison automatique : interrupteur général dans l'admin, et un interrupteur par produit. Désactivée, la commande payée attend « Livrer maintenant ».
- Paiement manuel reçu : Commandes > « Valider le paiement ».
- Service à faire à la main : Commandes > « Marquer fait » une fois terminé.
- Le client doit réinstaller : Commandes > « Nouveau lien » (l'ancien lien non utilisé est désactivé).
- Plus de stock : la commande attend, puis part toute seule dès que vous ajoutez des clés.
- Blog et FAQ : onglets Blog et FAQ.
- Visites : tableau de bord.

## Plus tard
- PayDunya : passer PAYDUNYA_MODE à live quand les tests sont bons.
- Email automatique (Resend) : prévu dans 9-fonction-admin.ts, fonction `deliver`.

## Catégories (Office, Windows…)
Admin › Produits › Catégories : chaque catégorie peut avoir une « catégorie parente » (un seul niveau).
Déjà créées : Windows (Windows 10, 11, Server), Microsoft Office (2019, 2021, 2024, Microsoft 365), Solutions PC, Logiciels.
Adresse d'une sous-catégorie : /categorie/microsoft-office/office-2024.

## Cookies
Un bandeau demande l'accord au 1er passage. Le panier marche toujours ; les statistiques de visites ne comptent le visiteur que s'il accepte.
Lien « Gérer les cookies » en bas de page. Détails sur /confidentialite.

## Parrainage (revendeurs)
1. Admin › Produits : remplir « Prix de gros » sur chaque produit ouvert aux parrains. Sans prix de gros, pas de remise ni de gain sur ce produit.
2. Admin › 🤝 Parrains : créer le parrain (nom, email, Wave). Un premier code est créé avec la remise par défaut (10 %).
3. Le parrain va sur www.licenceoff.com/parrain, tape son email et reçoit un lien de connexion (valable 30 min).
   Il crée ses liens, choisit la remise de chaque lien (jamais sous le prix de gros) et voit ses ventes et gains.
4. Gain du parrain = prix payé par le client − prix de gros.
5. Quand son solde atteint le seuil (Réglages, 10 000 FCFA par défaut), un « versement à faire » apparaît dans l'onglet Parrains
   et un email part vers l'adresse d'alerte (Réglages). Après le transfert Wave, cliquer « Marquer payé ».

## Clients (CRM)
Admin › 👥 Clients : chaque client par email, ses commandes, dates, montant dépensé, code parrain utilisé et IP. Bouton « Exporter (CSV) ».

## Créer un produit (comme sur Shopify)
Admin › 📦 Produits › « Nouveau produit » : nom, catégorie, prix, prix barré, prix de gros, référence (SKU), description, photo, statut (Publié / Brouillon).
- **Produit physique** (case orange) : indiquez la quantité disponible (vide = illimitée) et le poids. Le stock baisse tout seul à chaque commande payée.
- **Produit digital** (case décochée) : choisissez ce que reçoit le client.
  - Logiciel : envoyez le fichier (50 Mo max) ou collez un lien https:// (Google Drive, site de Microsoft…). Le client reçoit toujours un lien licenceoff à usage unique.
  - Licences : collez vos clés dans « Ajouter des licences au stock » (une par ligne). Cochez « Sérialiseur réutilisable » si la même clé peut servir à plusieurs clients.
- **Référencement Google** (facultatif) : titre (60 caractères) et description (155 caractères), avec un aperçu.
- **Brouillon** : le produit est caché du site, vous pouvez le préparer tranquillement.

## Livraison des produits physiques
Dans Dakar, le client choisit au panier : à domicile (1 500 FCFA) ou par bus (1 000 FCFA). Il donne son adresse et son quartier, et peut partager sa position GPS.
Hors de Dakar, il ne paie pas en ligne : un bouton l'envoie sur votre WhatsApp.
Dans Commandes, vous voyez le mode, les frais, l'adresse et un lien « Voir la position sur Google Maps ». Après la livraison, cliquez « 📦 Marquer livré ».
Les tarifs se changent dans ⚙️ Réglages › Livraison.

## Avis clients
Seuls les acheteurs peuvent noter un produit, depuis leur page de commande, une fois l'article livré.
Admin › ⭐ Avis : publiez, masquez ou supprimez chaque avis, et répondez publiquement si vous voulez. Les étoiles apparaissent sur la fiche produit et dans Google.

## Pages (À propos, Conditions de vente, promo…)
Admin › 📄 Pages : titre, adresse (www.licenceoff.com/page/…), image, contenu, Publiée / Brouillon, texte pour Google.
Cochez « menu du haut » et/ou « pied de page » pour l'afficher. Les visiteurs la voient sous 5 minutes.
- Nouvelle catégorie de produits : 📦 Produits › Catégories. Sa page (/categorie/…) se crée toute seule, et elle apparaît dans la boutique dès qu'elle contient un produit.
- Nouvel article : 📝 Blog.

## Comptes clients (Mon compte)
- Le client va sur **licenceoff.com/compte**, tape son email et reçoit un lien de connexion (valable 30 minutes). Pas de mot de passe. Il reste connecté 60 jours.
- Dans « Mon compte » : toutes ses commandes passées avec cet email (même celles faites sans compte), les clés et liens de téléchargement, ses favoris (bouton ♡ sur chaque fiche produit), ses centres d'intérêt, des suggestions, et son historique de visites et recherches.
- L'historique n'est enregistré que si le client a accepté les cookies. Il peut l'effacer, et supprimer son compte (ses commandes restent dans l'admin, c'est obligatoire pour la comptabilité).
- On peut toujours commander sans compte.
- Admin, onglet **Clients** : la ligne 👤 montre la date de création du compte, la dernière connexion, ses intérêts, favoris, derniers produits vus et recherches.
- Base : fichier SQL 21-comptes-clients.sql (déjà appliqué). Le plan gratuit Supabase suffit.

## À faire, Journal et rapport du lundi
- **🔔 À faire** (en haut du tableau de bord) : tout ce qui attend une action de votre part. Paiements Wave / Orange Money à vérifier, commandes à traiter, demandes de clé sans stock, stock bas, versements parrains, avis à valider, erreurs récentes. Chaque ligne a un bouton « Voir ». Le chiffre orange sur « Tableau de bord » se met à jour toutes les 2 minutes, et aussi dans le titre de l'onglet du navigateur.
- **📜 Journal** : l'historique de ce qui se passe en coulisses (paiements PayDunya, emails envoyés ou refusés, livraisons, téléchargements, connexions, mauvais mot de passe admin, erreurs). Filtrez par niveau ou origine, cherchez un n° de commande, cliquez sur une ligne pour le détail technique. Aucune clé ni mot de passe n'y est enregistré. Le journal garde 90 jours.
- **Rapport du lundi** : chaque lundi à 8 h, un email à votre « email d'alerte » (Réglages) avec ventes, visites, meilleures ventes et la liste « À faire ». Réglages > Rapport de la semaine : Activer / Désactiver, et « Recevoir maintenant » pour le tester.
- Si vous n'avez pas mis d'email d'alerte, le rapport n'est pas envoyé et le Journal le signale.
- Base : fichier SQL 22-journal-notifications.sql (déjà appliqué, tâches planifiées Supabase gratuites).

## 📥 Messages des clients
- Les emails du site ont comme adresse de réponse **contact@licenceoff.com**. Quand un client répond (ou écrit à contact@, commandes@ ou support@licenceoff.com), son message arrive dans l'admin, onglet **📥 Messages**.
- Chaque conversation est rattachée au client (son email) et à sa commande (n° LO-… trouvé dans le message, sinon sa dernière commande). Bouton WhatsApp si on a son numéro.
- Vous répondez dans la case en bas : la réponse part de contact@licenceoff.com et reste dans la conversation. « ✏️ Écrire à un client » pour un nouveau message. Depuis l'onglet Clients, le bouton ✉️ ouvre la conversation.
- Nouveau message : ligne dans « 🔔 À faire », chiffre sur l'onglet Messages, et un email d'alerte à votre email d'alerte (Réglages).
- Les pièces jointes ne sont pas gardées (le nom s'affiche) : demandez-les sur WhatsApp.
- Technique : Cloudflare Email Routing → Worker « licenceoff-messages » (fichier cloudflare-email-worker.js) → fonction boutique. SQL 23-messages-clients.sql.

## 📷 Caméras de surveillance
- La catégorie « Caméras de surveillance » existe déjà dans la boutique.
- Pour ajouter une caméra : Admin > Produits > Nouveau produit, catégorie « Caméras de surveillance », livraison « Produit physique », mettez le stock, le prix et une photo.
- Mettez la marque dans le nom (ex. « Caméra Hikvision 4 MP ») : elle est reprise automatiquement pour Facebook et Google.
- Installation sur place : créez un produit « Installation de caméra » en livraison manuelle, au prix que vous voulez.
- Tout passe par votre compte (ventes, paiements, livraison).

## 📣 Publicités Facebook / Google (catalogue et pixel)
- Flux produits (à donner à Meta Commerce Manager ou Google Merchant Center) :
  - Meta / Google : https://vnzpxfoeiixiqxkhdnik.supabase.co/functions/v1/boutique?feed=meta
  - Version tableur (CSV) : https://vnzpxfoeiixiqxkhdnik.supabase.co/functions/v1/boutique?feed=csv
- Seuls les produits **publiés avec une photo** apparaissent. Le flux se met à jour tout seul (au plus 1 h de retard).
- Pixel Meta : Admin > Réglages > « Publicités Meta », collez l'ID du pixel (des chiffres seulement, ce n'est pas un secret) puis Enregistrer.
- Le pixel ne se charge que si le visiteur a accepté les cookies. Événements envoyés : vue de page, vue produit, ajout au panier, début de paiement, achat (une seule fois par commande).
