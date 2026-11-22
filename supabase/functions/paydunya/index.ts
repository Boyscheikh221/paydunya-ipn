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
