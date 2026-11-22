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

// Livre une commande : clés / identifiants du stock + liens à usage unique + services à traiter
async function deliver(orderId: string, force = false) {
  const tokens = Array.from({ length: 30 }, () => newToken());
  const { data, error } = await db.rpc("deliver_order_v3", { p_order_id: orderId, p_tokens: tokens, p_days: LINK_DAYS, p_force: force });
  if (error) throw new Error(error.message);
  // Plus tard : envoi automatique de l'email au client (Resend) ici.
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
        const { data: keys } = await db.from("license_keys").select("product_id, status")
          .in("product_id", stockProds.map((p) => p.id)).limit(20000);
        const stock = stockProds.map((p) => ({
          id: p.id, name: p.name, active: p.active, threshold: p.low_stock_threshold,
          available: (keys ?? []).filter((k) => k.product_id === p.id && k.status === "available").length,
          sent: (keys ?? []).filter((k) => k.product_id === p.id && k.status === "sent").length,
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
        const result = body.deliver === true ? await deliver(o.id) : null;
        return json({ order: o, result });
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
        return json({ ok: true });
      }

      case "item_new_link": {
        const { data, error } = await db.rpc("new_item_link", { p_item_id: body.id, p_token: newToken(), p_days: LINK_DAYS });
        if (error) return json({ error: error.message }, 500);
        if (!data.ok) return json({ error: data.reason }, 400);
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
        const { data, error } = await db.from("license_keys")
          .upsert(unique.map((k) => ({ product_id: p.id, key_value: k })), { onConflict: "product_id,key_value", ignoreDuplicates: true })
          .select("id");
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
