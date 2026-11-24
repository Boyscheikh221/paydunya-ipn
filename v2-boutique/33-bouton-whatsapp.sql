-- 33 : dans les modèles d'email, la ligne du numéro de téléphone (signature) devient le bouton « Assistance WhatsApp ».
--      Les modèles sans numéro reçoivent le bouton automatiquement à la fin (code des fonctions).
update public.email_templates
   set body = regexp_replace(body, '^[ \t]*\[?\+?221[0-9 .\-]{8,16}\]?(\(tel:[^)]*\))?[ \t]*$', E'\n{bouton_whatsapp}', 'gn'),
       updated_at = now()
 where body ~ '(^|\n)[ \t]*\[?\+?221[0-9 .\-]{8,16}\]?(\(tel:[^)]*\))?[ \t]*(\n|$)';

select name, kind, position('{bouton_whatsapp}' in body) > 0 as bouton, body ~ '\+?221 ?7' as numero_restant
  from public.email_templates order by name;
