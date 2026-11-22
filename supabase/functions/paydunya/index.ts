// ============================================================
// Fonction "paydunya" : paiement en ligne (Wave, Orange Money,
// carte…) via PayDunya, puis livraison AUTOMATIQUE de la commande
// (tous les articles du panier).
// Supabase > Edge Functions > nom : paydunya
// IMPORTANT : désactiver "Verify JWT" pour cette fonction.
//
// Secrets à créer (Supabase > Edge Functions > Secrets) :
//   PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY, PAYDUNYA_TOKEN
//   PAYDUNYA_MODE = test   (puis "live" quand tout marche)
//   SITE_URL      = https://www.licenceoff.com
//
// Sécurité : on ne croit JAMAIS ce que dit la notification (IPN).
// On redemande toujours à PayDunya l'état réel de la facture
// (confirm) et on vérifie le montant avant de livrer.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MODE = (Deno.env.get("PAYDUNYA_MODE") ?? "test").trim().toLowerCase();
const API = MODE === "live" ? "https://app.paydunya.com/api/v1" : "https://app.paydunya.com/sandbox-api/v1";
const SITE = (Deno.env.get("SITE_URL") ?? "https://www.licenceoff.com").trim().replace(/\/$/, "");
const FN_URL = Deno.env.get("SUPABASE_URL")! + "/functions/v1/paydunya";

function keys() {
  const k = {
    "PAYDUNYA-MASTER-KEY": (Deno.env.get("PAYDUNYA_MASTER_KEY") ?? "").trim(),
    "PAYDUNYA-PRIVATE-KEY": (Deno.env.get("PAYDUNYA_PRIVATE_KEY") ?? "").trim(),
    "PAYDUNYA-TOKEN": (Deno.env.get("PAYDUNYA_TOKEN") ?? "").trim(),
  };
  return Object.values(k).every(Boolean) ? k : null;
}

function newToken(n = 18): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ================= Email automatique de livraison (Resend) =================
// Secrets : RESEND_API_KEY (obligatoire pour envoyer), RESEND_FROM (facultatif,
// ex. « licenceoff <commandes@licenceoff.com> »), SITE_URL, WHATSAPP_NUMBER (facultatif).
// Sans RESEND_API_KEY, rien n'est envoyé et la boutique marche normalement.
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fcfaTxt = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/ | /g, " ") + " FCFA";

// deno-lint-ignore no-explicit-any
function emailHtml(o: any, items: any[], link: string, wa: string) {
  const B = "#1E4FB8", N = "#0F2A6B", O = "#F5A21B", C = "#FBF7EE";
  const rows = items.map((i) => {
    const keys = (i.license_keys ?? []).map((k: { key_value: string }) =>
      `<div style="font-family:Consolas,Menlo,monospace;font-weight:700;font-size:15px;background:#eff5ff;border:2px dashed ${B};border-radius:8px;padding:10px 12px;margin:6px 0;word-break:break-all;color:${N}">${esc(k.key_value)}</div>`).join("");
    const label = i.delivery_type === "stock" ? "Vos identifiants :" : (i.license_keys ?? []).length > 1 ? "Vos clés d'activation :" : "Votre clé d'activation :";
    const file = ["key_file", "file"].includes(i.delivery_type)
      ? `<p style="margin:8px 0 0;font-size:14px;color:#475569">📥 Le logiciel se télécharge depuis votre page de commande (bouton ci-dessous). Le lien ne marche qu'une seule fois.</p>` : "";
    const todo = i.status === "to_process" ? `<p style="margin:8px 0 0;font-size:14px;color:#475569">Notre équipe traite cet article et vous contacte sur WhatsApp.</p>` : "";
    return `<tr><td style="padding:14px 0;border-bottom:1px solid #e6e1d6">
      <div style="font-weight:800;font-size:16px;color:${N}">${i.quantity > 1 ? i.quantity + " × " : ""}${esc(i.product_name)}</div>
      ${keys ? `<div style="font-size:13px;color:#5b6b86;margin-top:6px">${label}</div>${keys}` : ""}${file}${todo}</td></tr>`;
  }).join("");
  return `<!doctype html><html lang="fr"><body style="margin:0;background:${C};font-family:Nunito,Segoe UI,Arial,sans-serif;color:${N}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${B};padding:22px 24px">
  <div style="font-size:28px;font-weight:900;letter-spacing:-1px;color:#fff">licence<span style="color:${O}">off</span></div>
  <div style="color:#dbe6fb;font-size:14px">Licences &amp; solutions numériques</div></td></tr>
<tr><td style="padding:24px">
  <h1 style="margin:0 0 8px;font-size:22px">Merci ${esc(String(o.customer_name).split(" ")[0])}, votre commande est prête !</h1>
  <p style="margin:0 0 4px;color:#5b6b86">Commande <b>${esc(o.ref)}</b> · ${fcfaTxt(o.amount_fcfa)}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  <p style="text-align:center;margin:24px 0 8px"><a href="${esc(link)}" style="display:inline-block;background:${O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">Voir ma commande et télécharger</a></p>
  <p style="font-size:13px;color:#5b6b86;text-align:center;margin:0">Gardez cet email : votre page de commande regroupe vos clés et téléchargements.</p>
  <p style="font-size:14px;margin:22px 0 0">Besoin d'aide pour installer ou activer ? <a href="https://wa.me/${esc(wa)}" style="color:${B};font-weight:700">Écrivez-nous sur WhatsApp</a>.</p>
</td></tr>
<tr><td style="background:${N};color:#d6e0f5;padding:14px 24px;font-size:13px;text-align:center">
  Au Sénégal 🇸🇳 · Des licences authentiques · Votre satisfaction, notre priorité<br>
  <span style="color:${O};font-weight:800;font-style:italic">Vos logiciels, notre engagement !</span></td></tr>
</table></td></tr></table></body></html>`;
}

// deno-lint-ignore no-explicit-any
function emailText(o: any, items: any[], link: string, wa: string) {
  const lines = [`Merci ${String(o.customer_name).split(" ")[0]}, votre commande ${o.ref} est prête !`, ""];
  for (const i of items) {
    lines.push((i.quantity > 1 ? i.quantity + " x " : "") + i.product_name);
    for (const k of i.license_keys ?? []) lines.push("  " + k.key_value);
    if (["key_file", "file"].includes(i.delivery_type)) lines.push("  Téléchargement : sur votre page de commande (lien à usage unique).");
  }
  lines.push("", "Votre page de commande : " + link, "Aide WhatsApp : https://wa.me/" + wa, "", "licenceoff — Vos logiciels, notre engagement !");
  return lines.join("\n");
}

// Envoie l'email de livraison UNE fois (force = renvoi manuel depuis l'admin)
async function sendDeliveryEmail(orderId: string, force = false): Promise<{ sent: boolean; reason?: string }> {
  const key = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!key) return { sent: false, reason: "resend_non_configure" };
  const { data: o } = await db.from("orders")
    .select("id, ref, public_token, customer_name, email, amount_fcfa, status, emailed_at, order_items(id, product_name, delivery_type, quantity, status, created_at, license_keys(key_value))")
    .eq("id", orderId).maybeSingle();
  if (!o || !o.email) return { sent: false, reason: "commande_introuvable" };
  if (!force && o.status !== "delivered") return { sent: false, reason: "pas_encore_livree" };
  if (!force && o.emailed_at) return { sent: false, reason: "deja_envoye" };
  // réserve l'envoi (évite les doublons si PayDunya prévient 2 fois)
  if (!force) {
    const { data: claim } = await db.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", o.id).is("emailed_at", null).select("id");
    if (!claim?.length) return { sent: false, reason: "deja_envoye" };
  }
  const site = (Deno.env.get("SITE_URL") ?? "https://www.licenceoff.com").trim().replace(/\/$/, "");
  const wa = (Deno.env.get("WHATSAPP_NUMBER") ?? "221777860777").replace(/\D/g, "");
  const link = site + "/commande.html?o=" + encodeURIComponent(o.public_token);
  // deno-lint-ignore no-explicit-any
  const items = ((o.order_items ?? []) as any[]).filter((i) => i.status !== "cancelled").sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: (Deno.env.get("RESEND_FROM") ?? "licenceoff <commandes@licenceoff.com>").trim(),
      to: [o.email],
      reply_to: (Deno.env.get("RESEND_REPLY_TO") ?? "").trim() || undefined,
      subject: "Votre commande " + o.ref + " est prête — licenceoff",
      html: emailHtml(o, items, link, wa),
      text: emailText(o, items, link, wa),
    }),
  }).catch(() => null);
  if (!r || !r.ok) {
    const err = r ? (await r.text().catch(() => "")).slice(0, 200) : "reseau";
    console.error("Resend", err);
    if (!force) await db.from("orders").update({ emailed_at: null }).eq("id", o.id);
    return { sent: false, reason: "envoi_echoue" };
  }
  if (force) await db.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", o.id);
  return { sent: true };
}

// Demande à PayDunya l'état réel de la facture et livre si elle est payée
async function confirmAndDeliver(invoiceToken: string) {
  const k = keys();
  if (!k || !invoiceToken || invoiceToken.length > 100) return { ok: false, reason: "invalide" };

  const { data: o } = await db.from("orders")
    .select("id, status, amount_fcfa").eq("paydunya_token", invoiceToken).maybeSingle();
  if (!o) return { ok: false, reason: "commande_introuvable" };
  if (o.status === "delivered" || o.status === "processing") return { ok: true, reason: "already_delivered" };
  if (o.status === "cancelled") return { ok: false, reason: "cancelled" };

  const r = await fetch(API + "/checkout-invoice/confirm/" + encodeURIComponent(invoiceToken), {
    headers: { ...k, "Content-Type": "application/json" },
  });
  // deno-lint-ignore no-explicit-any
  const b: any = await r.json().catch(() => ({}));
  if (b.response_code !== "00") return { ok: false, reason: "confirm_echec" };
  if (b.status !== "completed") return { ok: false, reason: "pas_encore_paye", status: b.status };
  if (Number(b.invoice?.total_amount) !== Number(o.amount_fcfa)) {
    await db.from("orders").update({ note: "ALERTE : montant PayDunya différent (" + b.invoice?.total_amount + ")" }).eq("id", o.id);
    return { ok: false, reason: "montant_different" };
  }

  await db.from("orders").update({
    payment_method: "paydunya",
    payment_ref: String(b.receipt_identifier ?? b.provider_reference ?? invoiceToken).slice(0, 100),
  }).eq("id", o.id);

  const tokens = Array.from({ length: 30 }, () => newToken());
  const { data, error } = await db.rpc("deliver_order_v3", { p_order_id: o.id, p_tokens: tokens, p_days: 7, p_force: false });
  if (error) return { ok: false, reason: "error" };
  if (data?.reason === "delivered") await sendDeliveryEmail(o.id).catch((e) => console.error("email", e));
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const ctype = req.headers.get("content-type") ?? "";

  // ---------- Notification de PayDunya (IPN) ----------
  if (!ctype.includes("application/json")) {
    let token = "";
    try {
      const f = await req.formData();
      token = String(f.get("data[invoice][token]") ?? f.get("data[token]") ?? f.get("token") ?? "");
    } catch (_) { /* ignore */ }
    const result = await confirmAndDeliver(token);
    return json(result);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: "bad_json" }, 400); }
  const pub = String(body.o ?? "").trim().slice(0, 64);
  if (!pub) return json({ error: "not_found" }, 404);

  const { data: o } = await db.from("orders")
    .select("id, ref, status, amount_fcfa, paydunya_token, customer_name, email, phone, order_items(product_name, quantity)")
    .eq("public_token", pub).maybeSingle();
  if (!o) return json({ error: "not_found" }, 404);

  switch (body.action) {
    // ---------- Le client clique "Payer" ----------
    case "create": {
      if (o.status !== "pending") return json({ error: "deja_payee" }, 400);
      const k = keys();
      if (!k) return json({ error: "paydunya_non_configure" }, 503);
      // deno-lint-ignore no-explicit-any
      const items = (o.order_items ?? []) as any[];
      const prodName = items.map((i) => (i.quantity > 1 ? i.quantity + " x " : "") + i.product_name).join(", ").slice(0, 180) || "Commande";
      const back = SITE + "/commande.html?o=" + encodeURIComponent(pub);
      const r = await fetch(API + "/checkout-invoice/create", {
        method: "POST",
        headers: { ...k, "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice: { total_amount: o.amount_fcfa, description: prodName + " — commande " + o.ref },
          store: { name: "licenceoff", website_url: SITE },
          actions: { return_url: back, cancel_url: back, callback_url: FN_URL },
          custom_data: { order_ref: o.ref },
        }),
      });
      // deno-lint-ignore no-explicit-any
      const b: any = await r.json().catch(() => ({}));
      if (b.response_code !== "00" || !b.token || !b.response_text) {
        console.error("PayDunya create", b);
        return json({ error: "paydunya_erreur" }, 502);
      }
      await db.from("orders").update({ paydunya_token: b.token, payment_method: "paydunya" }).eq("id", o.id);
      return json({ url: b.response_text });
    }

    // ---------- Retour du client sur le site : on vérifie tout de suite ----------
    case "check": {
      if (!o.paydunya_token) return json({ ok: false, reason: "pas_de_paiement" });
      return json(await confirmAndDeliver(o.paydunya_token));
    }

    default:
      return json({ error: "action_inconnue" }, 400);
  }
});
