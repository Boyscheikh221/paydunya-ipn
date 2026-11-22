// ============================================================
// Fonction "admin" : back-office de la boutique licenceoff.
// Tableau de bord, commandes, stock, catégories, produits,
// blog, fichiers, liens de téléchargement, visites.
// Protégée par mot de passe (secret ADMIN_PASSWORD).
// Remplace le code de la fonction "admin" existante.
// IMPORTANT : "Verify JWT" reste désactivé pour cette fonction.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-password, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const DAY = 86400000;
const LINK_DAYS = 7;
const STOCK_TYPES = ["key", "key_file", "stock"];
const DELIVERY_TYPES = ["key", "key_file", "file", "stock", "manual"];

function newToken(n = 18): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function newRef(): string {
  const abc = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  const d = new Date();
  const dm = String(d.getUTCDate()).padStart(2, "0") + String(d.getUTCMonth() + 1).padStart(2, "0");
  return "LO-" + dm + "-" + Array.from(b, (x) => abc[x % abc.length]).join("");
}
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const safeFileName = (s: string) => str(s, 150).normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");

// ================= Email automatique de livraison (Resend) =================
// Secrets : RESEND_API_KEY (obligatoire pour envoyer), RESEND_FROM (facultatif,
// ex. « licenceoff <commandes@licenceoff.com> »), SITE_URL, WHATSAPP_NUMBER (facultatif).
// Sans RESEND_API_KEY, rien n'est envoyé et la boutique marche normalement.
// Modèles : table email_templates (un modèle par produit, sinon le modèle par défaut).
// Variables utilisables dans un modèle :
//   {prenom} {nom} {commande} {total} {produits} {cles} {bouton} {lien_commande} {whatsapp}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fcfaTxt = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/ | /g, " ") + " FCFA";
const EM = { B: "#1E4FB8", N: "#0F2A6B", O: "#F5A21B", C: "#FBF7EE" };

type Tpl = { id: string | null; subject: string; body: string };
const BUILTIN_TPL: Tpl = {
  id: null,
  subject: "Votre commande {commande} est prête — licenceoff",
  body: "Bonjour {prenom},\n\nMerci pour votre commande **{commande}** ({total}). Elle est prête !\n\n{produits}\n\n{cles}\n\n{bouton}\n\nGardez cet email : votre page de commande regroupe vos clés et vos téléchargements.\n\nBesoin d'aide pour installer ou activer ? [Écrivez-nous sur WhatsApp]({whatsapp}).",
};

// deno-lint-ignore no-explicit-any
type Item = any;
// deno-lint-ignore no-explicit-any
type Ctx = { o: any; items: Item[]; link: string; wa: string };

function keysHtml(items: Item[]) {
  return items.map((i) => {
    const ks = (i.license_keys ?? []) as { key_value: string }[];
    if (!ks.length) return "";
    const label = i.delivery_type === "stock" ? "Vos identifiants" : ks.length > 1 ? "Vos clés d'activation" : "Votre clé d'activation";
    return `<div style="margin:10px 0"><div style="font-size:13px;color:#5b6b86">${label} — ${esc(i.product_name)} :</div>` +
      ks.map((k) => `<div style="font-family:Consolas,Menlo,monospace;font-weight:700;font-size:15px;background:#eff5ff;border:2px dashed ${EM.B};border-radius:8px;padding:10px 12px;margin:6px 0;word-break:break-all;color:${EM.N}">${esc(k.key_value)}</div>`).join("") + "</div>";
  }).join("");
}
function keysText(items: Item[]) {
  return items.filter((i) => (i.license_keys ?? []).length).map((i) => i.product_name + " :\n" + i.license_keys.map((k: { key_value: string }) => "  " + k.key_value).join("\n")).join("\n");
}
const productsHtml = (items: Item[]) => "<ul style=\"margin:6px 0;padding-left:20px\">" + items.map((i) => `<li><b>${i.quantity > 1 ? i.quantity + " × " : ""}${esc(i.product_name)}</b>${["key_file", "file"].includes(i.delivery_type) ? " — logiciel à télécharger depuis votre page de commande (lien à usage unique)" : ""}${i.status === "to_process" ? " — notre équipe vous contacte sur WhatsApp" : ""}</li>`).join("") + "</ul>";
const productsText = (items: Item[]) => items.map((i) => "- " + (i.quantity > 1 ? i.quantity + " x " : "") + i.product_name).join("\n");
const buttonHtml = (link: string) => `<p style="text-align:center;margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">Voir ma commande et télécharger</a></p>`;

function vars(c: Ctx) {
  const parts = String(c.o.customer_name ?? "").trim().split(/\s+/);
  return { prenom: parts[0] || "", nom: String(c.o.customer_name ?? ""), commande: String(c.o.ref), total: fcfaTxt(c.o.amount_fcfa), lien_commande: c.link, whatsapp: "https://wa.me/" + c.wa };
}
// Texte simple → HTML : paragraphes, **gras**, listes « - », [lien](url), et les blocs {produits} {cles} {bouton}
function renderBody(body: string, c: Ctx) {
  const v = vars(c) as Record<string, string>;
  let b = String(body ?? "");
  const hasKeys = c.items.some((i) => (i.license_keys ?? []).length);
  if (hasKeys && !b.includes("{cles}")) b += "\n\n{cles}";
  if (!b.includes("{bouton}") && !b.includes("{lien_commande}")) b += "\n\n{bouton}";
  const sub = (s: string) => s.replace(/\{(prenom|nom|commande|total|lien_commande|whatsapp)\}/g, (_, k) => v[k]);
  // HTML
  const blocks = b.replace(/\r/g, "").split(/\n{2,}/).map((para) => {
    const t = para.trim();
    if (t === "{produits}") return productsHtml(c.items);
    if (t === "{cles}") return keysHtml(c.items);
    if (t === "{bouton}") return buttonHtml(c.link);
    const inline = (s: string) => esc(sub(s))
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" style="color:${EM.B};font-weight:700">$1</a>`);
    const lines = t.split("\n");
    if (lines.every((l) => /^\s*-\s+/.test(l))) return "<ul style=\"margin:6px 0;padding-left:20px\">" + lines.map((l) => "<li>" + inline(l.replace(/^\s*-\s+/, "")) + "</li>").join("") + "</ul>";
    return `<p style="margin:0 0 12px;line-height:1.6">${lines.map(inline).join("<br>")}</p>`;
  }).join("");
  const html = blocks.replace(/\{produits\}/g, productsHtml(c.items)).replace(/\{cles\}/g, keysHtml(c.items)).replace(/\{bouton\}/g, buttonHtml(c.link));
  // Texte
  const text = sub(b).replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 : $2")
    .replace(/\{produits\}/g, productsText(c.items)).replace(/\{cles\}/g, keysText(c.items)).replace(/\{bouton\}/g, "Votre commande : " + c.link);
  return { html, text };
}
function wrapHtml(inner: string) {
  const { B, N, O, C } = EM;
  return `<!doctype html><html lang="fr"><body style="margin:0;background:${C};font-family:Nunito,Segoe UI,Arial,sans-serif;color:${N}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${B};padding:22px 24px">
  <div style="font-size:28px;font-weight:900;letter-spacing:-1px;color:#fff">licence<span style="color:${O}">off</span></div>
  <div style="color:#dbe6fb;font-size:14px">Licences &amp; solutions numériques</div></td></tr>
<tr><td style="padding:24px;font-size:15px">${inner}</td></tr>
<tr><td style="background:${N};color:#d6e0f5;padding:14px 24px;font-size:13px;text-align:center">
  Au Sénégal 🇸🇳 · Des licences authentiques · Votre satisfaction, notre priorité<br>
  <span style="color:${O};font-weight:800;font-style:italic">Vos logiciels, notre engagement !</span></td></tr>
</table></td></tr></table></body></html>`;
}
function renderEmail(tpl: Tpl, c: Ctx) {
  const { html, text } = renderBody(tpl.body, c);
  const v = vars(c) as Record<string, string>;
  const subject = String(tpl.subject || BUILTIN_TPL.subject).replace(/\{(prenom|nom|commande|total)\}/g, (_, k) => v[k]).slice(0, 200);
  return { subject, html: wrapHtml(html), text: text + "\n\nlicenceoff — Vos logiciels, notre engagement !" };
}
function siteCtx() {
  return {
    site: (Deno.env.get("SITE_URL") ?? "https://www.licenceoff.com").trim().replace(/\/$/, ""),
    wa: (Deno.env.get("WHATSAPP_NUMBER") ?? "221777860777").replace(/\D/g, ""),
  };
}
async function resendSend(to: string, mail: { subject: string; html: string; text: string }) {
  const key = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!key) return { ok: false, reason: "resend_non_configure" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: (Deno.env.get("RESEND_FROM") ?? "licenceoff <commandes@licenceoff.com>").trim(),
      to: [to], reply_to: (Deno.env.get("RESEND_REPLY_TO") ?? "").trim() || undefined,
      subject: mail.subject, html: mail.html, text: mail.text,
    }),
  }).catch(() => null);
  if (!r || !r.ok) { console.error("Resend", r ? (await r.text().catch(() => "")).slice(0, 300) : "reseau"); return { ok: false, reason: "envoi_echoue" }; }
  return { ok: true };
}

// Envoie l'email de livraison UNE fois (force = renvoi manuel depuis l'admin).
// Si la commande contient des produits avec des modèles différents : un email par modèle.
async function sendDeliveryEmail(orderId: string, force = false, templateId?: string): Promise<{ sent: boolean; count?: number; reason?: string }> {
  if (!(Deno.env.get("RESEND_API_KEY") ?? "").trim()) return { sent: false, reason: "resend_non_configure" };
  const { data: o } = await db.from("orders")
    .select("id, ref, public_token, customer_name, email, amount_fcfa, status, emailed_at, order_items(id, product_name, delivery_type, quantity, status, created_at, license_keys(key_value), products(email_template_id))")
    .eq("id", orderId).maybeSingle();
  if (!o || !o.email) return { sent: false, reason: "commande_introuvable" };
  if (!force && o.status !== "delivered") return { sent: false, reason: "pas_encore_livree" };
  if (!force && o.emailed_at) return { sent: false, reason: "deja_envoye" };
  if (!force) { // réserve l'envoi (évite les doublons si PayDunya prévient 2 fois)
    const { data: claim } = await db.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", o.id).is("emailed_at", null).select("id");
    if (!claim?.length) return { sent: false, reason: "deja_envoye" };
  }
  const items: Item[] = ((o.order_items ?? []) as Item[]).filter((i) => i.status !== "cancelled")
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const { data: tpls } = await db.from("email_templates").select("id, subject, body, is_default");
  const byId = Object.fromEntries((tpls ?? []).map((t) => [t.id, t]));
  const def: Tpl = (tpls ?? []).find((t) => t.is_default) ?? BUILTIN_TPL;
  const groups = new Map<string, { tpl: Tpl; items: Item[] }>();
  for (const i of items) {
    const t: Tpl = (templateId && byId[templateId]) || byId[i.products?.email_template_id] || def;
    const k = t.id ?? "builtin";
    if (!groups.has(k)) groups.set(k, { tpl: t, items: [] });
    groups.get(k)!.items.push(i);
  }
  const { site, wa } = siteCtx();
  const link = site + "/commande.html?o=" + encodeURIComponent(o.public_token);
  let sent = 0;
  for (const g of groups.values()) {
    const r = await resendSend(o.email, renderEmail(g.tpl, { o, items: g.items, link, wa }));
    if (r.ok) sent++;
  }
  if (!sent) {
    if (!force) await db.from("orders").update({ emailed_at: null }).eq("id", o.id);
    return { sent: false, reason: "envoi_echoue" };
  }
  if (force) await db.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", o.id);
  return { sent: true, count: sent };
}

// Vente faite par WhatsApp / en direct : crée la commande (plusieurs articles possibles)
// deno-lint-ignore no-explicit-any
async function createAdminOrder(body: any): Promise<Response | { o: any }> {
  const name = str(body.name, 100);
  const email = str(body.email, 200).toLowerCase();
  if (name.length < 2) return json({ error: "nom_invalide" }, 400);
  if (!email.includes("@")) return json({ error: "email_invalide" }, 400);
  const lines = (Array.isArray(body.items) ? body.items : []).slice(0, 20)
    .map((i: { product_id: string; qty: number }) => ({ id: str(i.product_id, 40), qty: clamp(Math.floor(Number(i.qty) || 1), 1, 20) }))
    .filter((i: { id: string }) => i.id);
  if (!lines.length) return json({ error: "panier_vide" }, 400);
  const { data: prods } = await db.from("products").select("id, name, price_fcfa, delivery_type").in("id", lines.map((l: { id: string }) => l.id));
  if (!prods?.length) return json({ error: "produit_introuvable" }, 400);
  const byId = Object.fromEntries(prods.map((p) => [p.id, p]));
  const items = lines.filter((l: { id: string }) => byId[l.id]);
  const computed = items.reduce((s: number, l: { id: string; qty: number }) => s + byId[l.id].price_fcfa * l.qty, 0);
  const amount = body.amount_fcfa !== "" && body.amount_fcfa != null && Number.isFinite(Number(body.amount_fcfa))
    ? clamp(Number(body.amount_fcfa), 0, 100_000_000) : computed;
  const { data: o, error } = await db.from("orders").insert({
    ref: newRef(), public_token: newToken(24), customer_name: name, email,
    phone: str(body.phone, 30).replace(/[^\d+]/g, "") || null, amount_fcfa: amount,
    payment_method: str(body.payment_method, 30) || null, payment_ref: str(body.payment_ref, 100) || null,
    note: str(body.note, 300) || null, source: "admin",
  }).select().single();
  if (error) return json({ error: error.message }, 500);
  const { error: e2 } = await db.from("order_items").insert(items.map((l: { id: string; qty: number }) => ({
    order_id: o.id, product_id: l.id, product_name: byId[l.id].name, delivery_type: byId[l.id].delivery_type,
    unit_price: byId[l.id].price_fcfa, quantity: l.qty,
  })));
  if (e2) { await db.from("orders").delete().eq("id", o.id); return json({ error: e2.message }, 500); }
  return { o };
}

// Livre une commande : clés / identifiants du stock + liens à usage unique + services à traiter
async function deliver(orderId: string, force = false) {
  const tokens = Array.from({ length: 30 }, () => newToken());
  const { data, error } = await db.rpc("deliver_order_v3", { p_order_id: orderId, p_tokens: tokens, p_days: LINK_DAYS, p_force: force });
  if (error) throw new Error(error.message);
  // commande entièrement livrée → email automatique au client (une seule fois)
  if (data?.reason === "delivered") await sendDeliveryEmail(orderId).catch((e) => console.error("email", e));
  return data as { ok: boolean; reason: string };
}

// Livre les commandes payées qui attendaient du stock pour ce produit (les plus anciennes d'abord)
async function deliverWaiting(productId: string) {
  const { data } = await db.from("order_items").select("order_id, orders!inner(paid_at, status)")
    .eq("product_id", productId).eq("status", "waiting_stock").limit(200);
  // deno-lint-ignore no-explicit-any
  const ids = [...new Set((data ?? []).sort((a: any, b: any) => String(a.orders.paid_at).localeCompare(String(b.orders.paid_at))).map((r) => r.order_id))];
  let n = 0;
  for (const id of ids) {
    const r = await deliver(id);
    if (r.reason === "out_of_stock") break;
    n++;
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const expected = (Deno.env.get("ADMIN_PASSWORD") ?? "").trim();
  const given = (req.headers.get("x-admin-password") ?? "").trim();
  if (!expected || !safeEqual(given, expected)) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "unauthorized" }, 401);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: "bad_json" }, 400); }

  try {
    switch (body.action) {
      // ================= Tableau de bord =================
      case "dashboard": {
        const { data: prods } = await db.from("products").select("id, name, active, delivery_type, low_stock_threshold").order("name");
        const stockProds = (prods ?? []).filter((p) => STOCK_TYPES.includes(p.delivery_type));
        const { data: keys } = await db.from("license_keys").select("product_id, status, reusable")
          .in("product_id", stockProds.map((p) => p.id)).limit(20000);
        const stock = stockProds.map((p) => ({
          id: p.id, name: p.name, active: p.active, threshold: p.low_stock_threshold,
          available: (keys ?? []).filter((k) => k.product_id === p.id && k.status === "available").length,
          sent: (keys ?? []).filter((k) => k.product_id === p.id && k.status === "sent").length,
          reusable: (keys ?? []).some((k) => k.product_id === p.id && k.status === "available" && k.reusable),
        }));
        const since = new Date(Date.now() - 31 * DAY).toISOString();
        const { data: recent } = await db.from("orders")
          .select("ref, customer_name, status, amount_fcfa, created_at, paid_at, delivered_at").gte("created_at", since)
          .order("created_at", { ascending: false }).limit(5000);
        const { data: top } = await db.from("order_items").select("product_name, quantity, unit_price, status, orders!inner(paid_at)")
          .gte("orders.paid_at", since).limit(5000);
        const { data: visits } = await db.rpc("visit_stats");
        return json({ stock, orders: recent ?? [], items: top ?? [], visits: visits ?? null });
      }

      // ================= Commandes =================
      case "orders_list": {
        let q = db.from("orders")
          .select("*, order_items(id, product_id, product_name, delivery_type, unit_price, quantity, status, created_at, license_keys(key_value), downloads(token, status, download_count, max_downloads, expires_at, created_at))")
          .order("created_at", { ascending: false }).limit(300);
        if (body.status) q = q.eq("status", str(body.status, 20));
        const s = str(body.q, 80).replace(/[,()*]/g, " ").trim();
        if (s) q = q.or(`ref.ilike.*${s}*,customer_name.ilike.*${s}*,email.ilike.*${s}*,phone.ilike.*${s}*`);
        const { data, error } = await q;
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }

      case "order_create": { // vente faite par WhatsApp / en direct (plusieurs articles possibles)
        const c = await createAdminOrder(body);
        if (c instanceof Response) return c;
        const result = body.deliver === true ? await deliver(c.o.id) : null;
        return json({ order: c.o, result });
      }

      case "manual_send": { // vente WhatsApp : clé(s) du stock + email au modèle du produit, enregistrée comme commande
        const c = await createAdminOrder({ ...body, name: str(body.name, 100) || "Client WhatsApp", items: [{ product_id: body.product_id, qty: body.qty }] });
        if (c instanceof Response) return c;
        await db.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", c.o.id); // l'email part juste après
        const result = await deliver(c.o.id, true);
        const { data: its } = await db.from("order_items").select("product_name, status, license_keys(key_value)").eq("order_id", c.o.id);
        const keys = (its ?? []).flatMap((i: any) => (i.license_keys ?? []).map((k: any) => k.key_value));
        if (result?.reason === "out_of_stock" || body.send_email === false) {
          await db.from("orders").update({ emailed_at: null }).eq("id", c.o.id);
          return json({ order: c.o, result, keys, email: null });
        }
        const email = await sendDeliveryEmail(c.o.id, true);
        return json({ order: c.o, result, keys, email });
      }

      case "template_send": { // envoyer un modèle seul à une adresse (sans clé ni commande)
        const to = str(body.to, 200).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(to)) return json({ error: "email_invalide" }, 400);
        const { data: prod } = body.product_id ? await db.from("products").select("name, price_fcfa, email_template_id").eq("id", str(body.product_id, 40)).maybeSingle() : { data: null };
        const { data: t } = prod?.email_template_id ? await db.from("email_templates").select("id, subject, body").eq("id", prod.email_template_id).maybeSingle()
          : await db.from("email_templates").select("id, subject, body").eq("is_default", true).maybeSingle();
        const tpl: Tpl = t ?? BUILTIN_TPL; // le modèle du produit, sinon le modèle par défaut
        const { site, wa } = siteCtx();
        const pname = prod?.name ?? str(body.product_name, 120);
        const mail = renderEmail(tpl, {
          o: { ref: str(body.ref, 40) || "—", customer_name: str(body.name, 100) || "", amount_fcfa: Number(body.amount_fcfa) || prod?.price_fcfa || 0 },
          items: pname ? [{ product_name: pname, delivery_type: "manual", quantity: 1, status: "delivered", license_keys: [] }] : [],
          link: site, wa,
        });
        const r = await resendSend(to, mail);
        if (!r.ok) return json({ error: r.reason }, 400);
        return json({ ok: true });
      }

      case "order_validate": { // "J'ai reçu le paiement" → livraison automatique
        if (body.payment_ref) {
          await db.from("orders").update({ payment_ref: str(body.payment_ref, 100) }).eq("id", body.id).eq("status", "pending");
        }
        return json({ result: await deliver(body.id) });
      }

      case "order_deliver_now": { // livraison automatique désactivée : l'admin livre lui-même (clés du stock + liens)
        return json({ result: await deliver(body.id, true) });
      }

      case "order_cancel": {
        const { data, error } = await db.from("orders").update({ status: "cancelled" })
          .eq("id", body.id).eq("status", "pending").select("id");
        if (error) return json({ error: error.message }, 500);
        if (!data?.length) return json({ error: "commande_deja_payee" }, 400);
        await db.from("order_items").update({ status: "cancelled" }).eq("order_id", body.id);
        return json({ ok: true });
      }

      case "item_complete": { // service traité à la main → livré
        const { data, error } = await db.rpc("complete_order_item", { p_item_id: body.id });
        if (error) return json({ error: error.message }, 500);
        if (!data.ok) return json({ error: data.reason }, 400);
        const { data: it } = await db.from("order_items").select("order_id").eq("id", body.id).maybeSingle();
        const email = it ? await sendDeliveryEmail(it.order_id).catch(() => null) : null;
        return json({ ok: true, email });
      }

      case "item_new_link": {
        const { data, error } = await db.rpc("new_item_link", { p_item_id: body.id, p_token: newToken(), p_days: LINK_DAYS });
        if (error) return json({ error: error.message }, 500);
        if (!data.ok) return json({ error: data.reason }, 400);
        return json({ ok: true });
      }

      case "order_email": { // (re)envoyer l'email de livraison au client
        const r = await sendDeliveryEmail(body.id, true);
        if (!r.sent) return json({ error: r.reason }, 400);
        return json({ ok: true });
      }

      case "order_note": {
        const { error } = await db.from("orders").update({ note: str(body.note, 300) || null }).eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Stock (clés, identifiants) =================
      case "keys_list": {
        let q = db.from("license_keys").select("*, order_items(product_name, orders(ref, customer_name))")
          .order("added_at", { ascending: false }).limit(500);
        if (body.product_id) q = q.eq("product_id", body.product_id);
        if (body.status) q = q.eq("status", str(body.status, 20));
        const { data, error } = await q;
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }

      case "keys_import": {
        const { data: p } = await db.from("products").select("id, delivery_type").eq("id", body.product_id).maybeSingle();
        if (!p) return json({ error: "produit_introuvable" }, 400);
        if (!STOCK_TYPES.includes(p.delivery_type)) return json({ error: "produit_sans_stock" }, 400);
        const lines = String(body.text ?? "").split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length >= 3 && l.length <= 500);
        const unique = [...new Set(lines)];
        if (!unique.length) return json({ error: "aucune_cle" }, 400);
        if (unique.length > 2000) return json({ error: "max_2000_par_import" }, 400);
        // doublons : déjà dans le stock de ce produit (les copies envoyées des clés réutilisables ne comptent pas)
        const { data: have } = await db.from("license_keys").select("key_value").eq("product_id", p.id).is("source_key_id", null).limit(50000);
        const known = new Set((have ?? []).map((k) => k.key_value));
        const fresh = unique.filter((k) => !known.has(k));
        const { data, error } = fresh.length
          ? await db.from("license_keys").insert(fresh.map((k) => ({ product_id: p.id, key_value: k, reusable: body.reusable === true }))).select("id")
          : { data: [], error: null };
        if (error) return json({ error: error.message }, 500);
        const added = data?.length ?? 0;
        const delivered = await deliverWaiting(p.id);
        return json({ added, duplicates: unique.length - added, delivered });
      }

      case "key_set_status": {
        const status = body.status === "disabled" ? "disabled" : "available";
        const { data, error } = await db.from("license_keys").update({ status })
          .eq("id", body.id).neq("status", "sent").select("product_id");
        if (error) return json({ error: error.message }, 500);
        if (!data?.length) return json({ error: "cle_deja_envoyee" }, 400);
        const delivered = status === "available" ? await deliverWaiting(data[0].product_id) : 0;
        return json({ ok: true, delivered });
      }

      case "key_set_reusable": { // usage unique <-> réutilisable (clé encore en stock)
        const { data, error } = await db.from("license_keys").update({ reusable: body.reusable === true })
          .eq("id", body.id).neq("status", "sent").select("product_id");
        if (error) return json({ error: error.message }, 500);
        if (!data?.length) return json({ error: "cle_deja_envoyee" }, 400);
        const delivered = body.reusable === true ? await deliverWaiting(data[0].product_id) : 0;
        return json({ ok: true, delivered });
      }

      case "key_delete": {
        const { data, error } = await db.from("license_keys").delete().eq("id", body.id).neq("status", "sent").select("id");
        if (error) return json({ error: error.message }, 500);
        if (!data?.length) return json({ error: "cle_deja_envoyee" }, 400);
        return json({ ok: true });
      }

      // ================= Catégories =================
      case "categories_list": {
        const { data, error } = await db.from("categories").select("*").order("sort").order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "category_save": {
        const row = {
          name: str(body.name, 80), slug: slugify(str(body.slug, 80) || str(body.name, 80)),
          sort: clamp(Number(body.sort) || 0, 0, 1000), active: body.active !== false,
        };
        if (!row.name || !row.slug) return json({ error: "nom_obligatoire" }, 400);
        const r = body.id ? await db.from("categories").update(row).eq("id", body.id).select().single()
          : await db.from("categories").insert(row).select().single();
        if (r.error) return json({ error: r.error.message.includes("duplicate") ? "code_deja_utilise" : r.error.message }, 400);
        return json({ row: r.data });
      }
      case "category_delete": { // les produits restent, sans catégorie
        const { error } = await db.from("categories").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Produits =================
      case "products_list": {
        const { data, error } = await db.from("products").select("*").order("sort").order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "product_save": {
        const dtype = DELIVERY_TYPES.includes(body.delivery_type) ? body.delivery_type : "key";
        const row = {
          slug: slugify(str(body.slug, 80) || str(body.name, 120)),
          name: str(body.name, 120),
          description: str(body.description, 5000) || null,
          image_url: str(body.image_url, 500) || null,
          category_id: str(body.category_id, 40) || null,
          price_fcfa: clamp(Number(body.price_fcfa) || 0, 0, 100_000_000),
          compare_price_fcfa: Number(body.compare_price_fcfa) > 0 ? clamp(Number(body.compare_price_fcfa), 0, 100_000_000) : null,
          delivery_type: dtype,
          installer_path: ["key_file", "file"].includes(dtype) ? (str(body.installer_path, 200) || null) : null,
          active: body.active !== false,
          featured: body.featured === true,
          auto_deliver: body.auto_deliver !== false,
          sort: clamp(Number(body.sort) || 0, 0, 10000),
          low_stock_threshold: clamp(Number(body.low_stock_threshold) || 0, 0, 10000),
          email_template_id: str(body.email_template_id, 40) || null,
        };
        if (!row.slug || !row.name) return json({ error: "nom_obligatoire" }, 400);
        if (["key_file", "file"].includes(dtype) && !row.installer_path) return json({ error: "fichier_obligatoire" }, 400);
        const r = body.id ? await db.from("products").update(row).eq("id", body.id).select().single()
          : await db.from("products").insert(row).select().single();
        if (r.error) return json({ error: r.error.message.includes("duplicate") ? "code_deja_utilise" : r.error.message }, 400);
        return json({ row: r.data });
      }

      // ================= Réglages =================
      case "settings_get": {
        const { data } = await db.from("settings").select("key, value");
        return json({ settings: Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) });
      }
      case "settings_set": {
        const allowed = ["auto_delivery"];
        const key = str(body.key, 40);
        if (!allowed.includes(key)) return json({ error: "reglage_inconnu" }, 400);
        const { error } = await db.from("settings").upsert({ key, value: body.value === true, updated_at: new Date().toISOString() });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Modèles d'email =================
      case "templates_list": {
        const { data, error } = await db.from("email_templates").select("*").order("is_default", { ascending: false }).order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "template_save": {
        const row = { name: str(body.name, 100), subject: str(body.subject, 200), body: str(body.body, 20000), updated_at: new Date().toISOString() };
        if (!row.name || !row.subject || !row.body) return json({ error: "modele_incomplet" }, 400);
        const r = body.id ? await db.from("email_templates").update(row).eq("id", body.id).select().single()
          : await db.from("email_templates").insert(row).select().single();
        if (r.error) return json({ error: r.error.message }, 500);
        if (body.is_default === true) {
          await db.from("email_templates").update({ is_default: false }).neq("id", r.data.id).eq("is_default", true);
          await db.from("email_templates").update({ is_default: true }).eq("id", r.data.id);
        }
        return json({ row: r.data });
      }
      case "template_delete": { // les produits qui l'utilisaient reprennent le modèle par défaut
        const { data: t } = await db.from("email_templates").select("is_default").eq("id", body.id).maybeSingle();
        if (t?.is_default) return json({ error: "modele_par_defaut" }, 400);
        const { error } = await db.from("email_templates").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      case "template_preview":
      case "template_test": { // aperçu avec une commande d'exemple, ou envoi de cet aperçu à une adresse
        const tpl = { id: null, subject: str(body.subject, 200), body: str(body.body, 20000) };
        const { site, wa } = siteCtx();
        const sample = {
          o: { ref: "LO-2211-EXEMPLE", customer_name: "Moussa Diop", amount_fcfa: 25000 },
          items: [
            { product_name: str(body.product_name, 120) || "Windows 11 Professionnel", delivery_type: "key", quantity: 1, status: "delivered", license_keys: [{ key_value: "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" }] },
            { product_name: "Office 2024 Professionnel Plus", delivery_type: "key_file", quantity: 1, status: "delivered", license_keys: [{ key_value: "YYYYY-YYYYY-YYYYY-YYYYY-YYYYY" }] },
          ],
          link: site + "/commande.html?o=exemple", wa,
        };
        const mail = renderEmail(tpl, sample);
        if (body.action === "template_preview") return json(mail);
        const to = str(body.to, 200).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(to)) return json({ error: "email_invalide" }, 400);
        const r = await resendSend(to, { ...mail, subject: "[TEST] " + mail.subject });
        if (!r.ok) return json({ error: r.reason }, 400);
        return json({ ok: true });
      }

      // ================= FAQ =================
      case "faqs_list": {
        const { data, error } = await db.from("faqs").select("*").order("sort").order("created_at");
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "faq_save": {
        const row = { question: str(body.question, 300), answer: str(body.answer, 5000), sort: clamp(Number(body.sort) || 0, 0, 1000), active: body.active !== false };
        if (!row.question || !row.answer) return json({ error: "question_et_reponse_obligatoires" }, 400);
        const r = body.id ? await db.from("faqs").update(row).eq("id", body.id).select().single()
          : await db.from("faqs").insert(row).select().single();
        if (r.error) return json({ error: r.error.message }, 500);
        return json({ row: r.data });
      }
      case "faq_delete": {
        const { error } = await db.from("faqs").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Blog =================
      case "posts_list": {
        const { data, error } = await db.from("posts").select("*").order("created_at", { ascending: false }).limit(300);
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "post_save": {
        const published = body.published === true;
        const row: Record<string, unknown> = {
          title: str(body.title, 200), slug: slugify(str(body.slug, 120) || str(body.title, 120)),
          excerpt: str(body.excerpt, 400) || null, content: str(body.content, 50000),
          cover_url: str(body.cover_url, 500) || null, published, updated_at: new Date().toISOString(),
        };
        if (!row.title || !row.slug) return json({ error: "titre_obligatoire" }, 400);
        if (published) {
          const { data: old } = body.id ? await db.from("posts").select("published_at").eq("id", body.id).maybeSingle() : { data: null };
          row.published_at = old?.published_at ?? new Date().toISOString();
        }
        const r = body.id ? await db.from("posts").update(row).eq("id", body.id).select().single()
          : await db.from("posts").insert(row).select().single();
        if (r.error) return json({ error: r.error.message.includes("duplicate") ? "code_deja_utilise" : r.error.message }, 400);
        return json({ row: r.data });
      }
      case "post_delete": {
        const { error } = await db.from("posts").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Fichiers =================
      case "files_list": { // logiciels (espace privé)
        const { data, error } = await db.storage.from("installers").list("", { limit: 300, sortBy: { column: "name", order: "asc" } });
        if (error) return json({ error: error.message }, 500);
        return json({ rows: (data ?? []).filter((f) => f.id).map((f) => ({ name: f.name, size: f.metadata?.size ?? null })) });
      }
      case "upload_url": { // logiciel → espace privé "installers"
        const name = safeFileName(body.filename);
        if (!name || !/\.[A-Za-z0-9]{2,5}$/.test(name)) return json({ error: "nom_de_fichier_invalide" }, 400);
        const { data, error } = await db.storage.from("installers").createSignedUploadUrl(name, { upsert: true });
        if (error) return json({ error: error.message }, 500);
        return json({ url: data.signedUrl, path: data.path ?? name });
      }
      case "image_upload_url": { // photo produit / blog → espace public "product-images"
        const base = safeFileName(body.filename);
        if (!/\.(jpe?g|png|webp|gif|avif)$/i.test(base)) return json({ error: "image_invalide" }, 400);
        const name = Date.now().toString(36) + "-" + base;
        const { data, error } = await db.storage.from("product-images").createSignedUploadUrl(name);
        if (error) return json({ error: error.message }, 500);
        return json({ url: data.signedUrl, public_url: `${SUPABASE_URL}/storage/v1/object/public/product-images/${encodeURIComponent(name)}` });
      }

      // ================= Liens de téléchargement =================
      case "list": {
        const { data, error } = await db.from("downloads").select("*, products(name), orders(ref)")
          .order("created_at", { ascending: false }).limit(300);
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "set_status": {
        const status = String(body.status);
        if (!["pending", "active", "revoked"].includes(status)) return json({ error: "statut_invalide" }, 400);
        const patch: Record<string, unknown> = { status };
        if (status === "active") patch.activated_at = new Date().toISOString();
        const { error } = await db.from("downloads").update(patch).eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      case "extend": {
        const days = clamp(Number(body.days) || 7, 1, 90);
        const { data: row } = await db.from("downloads").select("expires_at").eq("id", body.id).maybeSingle();
        if (!row) return json({ error: "introuvable" }, 404);
        const base = Math.max(Date.now(), new Date(row.expires_at).getTime());
        const { error } = await db.from("downloads").update({ expires_at: new Date(base + days * DAY).toISOString() }).eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      default:
        return json({ error: "action_inconnue" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
