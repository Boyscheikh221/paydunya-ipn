# Email automatique de livraison (Resend)

**Ce qui est déjà en place (22/11/2026)**
- Dès qu'une commande est entièrement livrée, le client reçoit un email aux couleurs de licenceoff. Ça marche aussi bien après un paiement PayDunya qu'après « Valider le paiement », « Livrer maintenant » ou « Marquer fait » dans l'admin.
- L'email contient ses clés, et un bouton vers sa page de commande pour télécharger le logiciel. Le lien de téléchargement ne marche qu'une seule fois.
- Il part une seule fois par commande. Dans l'admin, Commandes > « ✉ Envoyer l'email » permet de le renvoyer à la main.
- Tant que la clé Resend n'est pas ajoutée, aucun email ne part et la boutique marche comme avant.

Aperçu : apercu-email.png

## Ta partie (environ 10 minutes)

### 1. Créer le compte Resend
1. Ouvre https://resend.com/signup.
2. Clique « Sign up with Google » et choisis ton compte Google habituel.
3. Préviens-moi quand tu es connecté : j'ajoute moi-même le domaine licenceoff.com dans Resend et ses enregistrements DNS dans Cloudflare.

### 2. Créer la clé API (toi seul, jamais dans le chat)
1. Dans Resend, menu **API Keys** > **Create API Key**.
2. Nom : `licenceoff-boutique`. Permission : **Sending access**. Domain : `licenceoff.com`.
3. Clique **Add**, puis **copie la clé** qui commence par `re_`. Elle ne s'affiche qu'une fois.

### 3. Coller la clé dans Supabase
1. Supabase > projet licenceoff-dl > **Edge Functions** > **Secrets**.
2. **Add new secret**. Name : `RESEND_API_KEY`. Value : colle la clé. Clique **Save**.
3. Facultatif : un secret `RESEND_FROM` = `licenceoff <commandes@licenceoff.com>` (c'est déjà la valeur utilisée par défaut).

### 4. Test
Dis-moi quand c'est fait : je fais une commande de test vers ton adresse email.

## Bon à savoir
- L'offre gratuite de Resend suffit pour démarrer (environ 3 000 emails par mois, à vérifier sur leur site).
- Resend utilise le sous-domaine `send.licenceoff.com` : ça ne gênera pas la future adresse contact@licenceoff.com chez Zoho.
- Fichiers : 12-email.sql (déjà appliqué), 9-fonction-admin.ts et 10-fonction-paydunya.ts (déjà en ligne).
