-- licenceoff : email automatique de livraison (Resend)
-- Date d'envoi de l'email au client (évite les doublons). Relançable sans danger.
alter table public.orders add column if not exists emailed_at timestamptz;
