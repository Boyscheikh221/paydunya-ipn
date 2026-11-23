// Cloudflare Email Worker "licenceoff-messages"
// Email Routing : contact@, commandes@, support@licenceoff.com → ce Worker.
// Il transmet l'email brut à la fonction Supabase "boutique" (?inbound=1),
// qui l'enregistre dans l'admin (onglet Messages) et prévient l'admin par email.
export default {
  async email(message) {
    const raw = await new Response(message.raw).arrayBuffer();
    const r = await fetch("https://vnzpxfoeiixiqxkhdnik.supabase.co/functions/v1/boutique?inbound=1", {
      method: "POST",
      headers: { "content-type": "message/rfc822", "x-envelope-from": message.from, "x-envelope-to": message.to },
      body: raw,
    });
    // en cas d'échec, l'expéditeur reçoit un message d'erreur au lieu de perdre son email en silence
    if (!r.ok && r.status >= 500) message.setReject("Message non distribue, merci de reessayer plus tard ou d'ecrire sur WhatsApp.");
  },
};
