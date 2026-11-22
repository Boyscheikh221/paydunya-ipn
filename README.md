# paydunya-ipn — paiement PayDunya pour licenceoff.com

Intégration PayDunya de la boutique licenceoff.

## Ce que fait `supabase/functions/paydunya`
1. `create` : le client clique « Payer » sur sa page de commande, la fonction crée une facture
   PayDunya (montant de la commande) et le renvoie vers la page de paiement PayDunya.
2. IPN (callback PayDunya) et `check` (retour du client) : la fonction **redemande à PayDunya**
   l'état réel de la facture (`checkout-invoice/confirm`), vérifie que le montant correspond,
   puis livre la commande : une clé unique du stock + un lien de téléchargement à usage unique.

Le contenu de la notification n'est jamais cru tel quel : seule la confirmation par l'API compte.

## Secrets (Supabase > Edge Functions > Secrets)
- `PAYDUNYA_MASTER_KEY`, `PAYDUNYA_PRIVATE_KEY`, `PAYDUNYA_TOKEN`
- `PAYDUNYA_MODE` : `test` (sandbox) puis `live`
- `SITE_URL` : `https://www.licenceoff.com`

Ne jamais mettre ces clés dans ce dépôt.

## Déploiement
Supabase > Edge Functions > nouvelle fonction `paydunya`, coller `index.ts`, désactiver « Verify JWT ».
Elle a besoin des tables créées par `6-boutique.sql` (commandes, stock de clés, `deliver_order`).
