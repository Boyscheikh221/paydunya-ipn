-- 39 — Clé verrouillée jusqu'au paiement (clients Facebook / WhatsApp qui paient après).
--   L'envoi manuel crée la commande « en attente de paiement » avec key_locked = true et envoie un email
--   « votre clé vous attend » (sans la clé). La clé n'est attribuée et envoyée que quand l'admin clique
--   « Débloquer la clé » (= paiement validé). Tant que la commande est en attente, aucune clé n'est visible.
alter table public.orders add column if not exists key_locked boolean not null default false;
select 'key_locked ajoutée' as resultat;
