// ============================================================
// Fonction "boutique" (PUBLIQUE) : catalogue, fiche produit,
// commande (panier à plusieurs articles), suivi de commande,
// blog, FAQ et statistiques de visites.
// Supabase > Edge Functions > nom : boutique — "Verify JWT" désactivé.
// Les clés / identifiants ne sortent ici QUE pour le client qui
// possède le lien secret de SA commande payée.
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

function newToken(n = 24): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// Référence lisible : LO-2611-7KQ3P (sans 0/O/1/I)
function newRef(): string {
  const abc = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  const d = new Date();
  const dm = String(d.getUTCDate()).padStart(2, "0") + String(d.getUTCMonth() + 1).padStart(2, "0");
  return "LO-" + dm + "-" + Array.from(b, (x) => abc[x % abc.length]).join("");
}
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const STOCK_TYPES = ["key", "key_file", "stock"];
const PRODUCT_FIELDS = "id, slug, name, description, image_url, price_fcfa, compare_price_fcfa, delivery_type, featured, sort, category_id";

// Nombre d'unités disponibles par produit (seulement pour les produits à stock)
async function stockCounts(ids: string[]) {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  const { data } = await db.from("license_keys").select("product_id").in("product_id", ids).eq("status", "available").limit(10000);
  for (const r of data ?? []) out[r.product_id] = (out[r.product_id] ?? 0) + 1;
  return out;
}
// deno-lint-ignore no-explicit-any
function publicProduct(p: any, counts: Record<string, number>, cats: Record<string, any>) {
  const needsStock = STOCK_TYPES.includes(p.delivery_type);
  const left = counts[p.id] ?? 0;
  return {
    slug: p.slug, name: p.name, description: p.description ?? "", image_url: p.image_url ?? "",
    price_fcfa: p.price_fcfa, compare_price_fcfa: p.compare_price_fcfa ?? null,
    delivery_type: p.delivery_type, featured: p.featured,
    category: cats[p.category_id]?.slug ?? null,
    in_stock: needsStock ? left > 0 : true,
    max_qty: needsStock ? Math.min(left, 20) : 20,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: "bad_json" }, 400); }

  switch (body.action) {
    // ---------- Statistiques de visites ----------
    case "hit": {
      const ua = req.headers.get("user-agent") ?? "";
      if (/bot|crawl|spider|preview|facebookexternalhit|whatsapp/i.test(ua)) return json({ ok: true });
      const page = str(body.page, 100).split("?")[0] || "/";
      let ref = "";
      try { ref = body.ref ? new URL(String(body.ref)).hostname.replace(/^www\./, "") : ""; } catch (_) { /* ignore */ }
      if (ref.endsWith("licenceoff.com") || ref.endsWith("pages.dev")) ref = "";
      await db.from("page_views").insert({
        page, visitor: str(body.v, 40) || null, referrer: ref.slice(0, 100) || null,
        device: /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "ordinateur",
      });
      return json({ ok: true });
    }

    // ---------- Catalogue complet ----------
    case "catalog": {
      const [{ data: cats }, { data: prods, error }] = await Promise.all([
        db.from("categories").select("id, slug, name, sort").eq("active", true).order("sort").order("name"),
        db.from("products").select(PRODUCT_FIELDS).eq("active", true).order("sort").order("name"),
      ]);
      if (error) return json({ error: "error" }, 500);
      const byId = Object.fromEntries((cats ?? []).map((c) => [c.id, c]));
      const counts = await stockCounts((prods ?? []).filter((p) => STOCK_TYPES.includes(p.delivery_type)).map((p) => p.id));
      return json({
        categories: (cats ?? []).map((c) => ({ slug: c.slug, name: c.name })),
        products: (prods ?? []).map((p) => publicProduct(p, counts, byId)),
      });
    }

    // ---------- Une fiche produit ----------
    case "product": {
      const { data: p } = await db.from("products").select(PRODUCT_FIELDS).eq("slug", str(body.slug, 80)).eq("active", true).maybeSingle();
      if (!p) return json({ error: "not_found" }, 404);
      const { data: cats } = await db.from("categories").select("id, slug, name");
      const byId = Object.fromEntries((cats ?? []).map((c) => [c.id, c]));
      const counts = await stockCounts(STOCK_TYPES.includes(p.delivery_type) ? [p.id] : []);
      return json({ product: { ...publicProduct(p, counts, byId), category_name: byId[p.category_id]?.name ?? null } });
    }

    // ---------- FAQ ----------
    case "faq": {
      const { data, error } = await db.from("faqs").select("question, answer").eq("active", true).order("sort").order("created_at");
      if (error) return json({ error: "error" }, 500);
      return json({ faqs: data });
    }

    // ---------- Blog ----------
    case "posts": {
      const { data, error } = await db.from("posts").select("slug, title, excerpt, cover_url, published_at")
        .eq("published", true).order("published_at", { ascending: false }).limit(Math.min(Number(body.limit) || 50, 100));
      if (error) return json({ error: "error" }, 500);
      return json({ posts: data });
    }
    case "post": {
      const { data } = await db.from("posts").select("slug, title, excerpt, content, cover_url, published_at")
        .eq("slug", str(body.slug, 120)).eq("published", true).maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      return json({ post: data });
    }

    // ---------- Nouvelle commande (panier) ----------
    case "create_order": {
      if (str(body.website, 50)) return json({ error: "spam" }, 400); // champ piège invisible
      const name = str(body.name, 100);
      const email = str(body.email, 200).toLowerCase();
      const phone = str(body.phone, 30).replace(/[^\d+]/g, "");
      if (name.length < 2) return json({ error: "nom_invalide" }, 400);
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return json({ error: "email_invalide" }, 400);
      if (phone.length < 8) return json({ error: "telephone_invalide" }, 400);

      // regroupe le panier : { slug: quantité }
      const want = new Map<string, number>();
      for (const it of Array.isArray(body.items) ? body.items.slice(0, 30) : []) {
        const slug = str(it?.slug, 80);
        const q = Math.floor(Number(it?.qty));
        if (slug && q > 0) want.set(slug, Math.min(20, (want.get(slug) ?? 0) + q));
      }
      if (!want.size) return json({ error: "panier_vide" }, 400);

      const { data: prods } = await db.from("products").select("id, slug, name, price_fcfa, delivery_type")
        .in("slug", [...want.keys()]).eq("active", true);
      if (!prods || prods.length !== want.size) return json({ error: "produit_introuvable" }, 400);
      const counts = await stockCounts(prods.filter((p) => STOCK_TYPES.includes(p.delivery_type)).map((p) => p.id));
      for (const p of prods) {
        if (STOCK_TYPES.includes(p.delivery_type) && (counts[p.id] ?? 0) < want.get(p.slug)!) {
          return json({ error: "stock_insuffisant", product: p.name, left: counts[p.id] ?? 0 }, 409);
        }
      }

      // anti-abus : 3 commandes en attente max par email ou téléphone sur 1 heure
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await db.from("orders").select("id", { count: "exact", head: true })
        .eq("status", "pending").gte("created_at", since).or(`email.eq.${email},phone.eq.${phone}`);
      if ((count ?? 0) >= 3) return json({ error: "trop_de_commandes" }, 429);

      const total = prods.reduce((s, p) => s + p.price_fcfa * want.get(p.slug)!, 0);
      if (total <= 0) return json({ error: "montant_invalide" }, 400);

      for (let i = 0; i < 4; i++) {
        const row = {
          ref: newRef(), public_token: newToken(), customer_name: name, email, phone,
          amount_fcfa: total, payment_method: "paydunya", source: "site",
        };
        const { data: o, error } = await db.from("orders").insert(row).select("id").single();
        if (error) {
          if (String(error.message).includes("duplicate")) continue;
          return json({ error: "error" }, 500);
        }
        const { error: e2 } = await db.from("order_items").insert(prods.map((p) => ({
          order_id: o.id, product_id: p.id, product_name: p.name, delivery_type: p.delivery_type,
          unit_price: p.price_fcfa, quantity: want.get(p.slug)!,
        })));
        if (e2) { await db.from("orders").delete().eq("id", o.id); return json({ error: "error" }, 500); }
        return json({ ref: row.ref, token: row.public_token });
      }
      return json({ error: "error" }, 500);
    }

    // ---------- Le client indique son n° de transaction (paiement manuel) ----------
    case "add_payment_ref": {
      const token = str(body.o, 64);
      const payRef = str(body.payment_ref, 100);
      if (!token || !payRef) return json({ error: "invalide" }, 400);
      const { error } = await db.from("orders").update({ payment_ref: payRef, payment_method: "manuel" })
        .eq("public_token", token).eq("status", "pending");
      if (error) return json({ error: "error" }, 500);
      return json({ ok: true });
    }

    // ---------- Page de suivi du client ----------
    case "status": {
      const token = str(body.o, 64);
      if (!token) return json({ error: "not_found" }, 404);
      const { data: o } = await db.from("orders")
        .select("id, ref, status, amount_fcfa, payment_method, payment_ref, paydunya_token, created_at, delivered_at, order_items(id, product_name, delivery_type, unit_price, quantity, status, created_at, products(slug, image_url, installer_path))")
        .eq("public_token", token).maybeSingle();
      if (!o) return json({ error: "not_found" }, 404);
      const paid = ["paid", "processing", "delivered"].includes(o.status);

      // deno-lint-ignore no-explicit-any
      const items = ((o.order_items ?? []) as any[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const ids = items.map((i) => i.id);
      const keysByItem: Record<string, string[]> = {};
      // deno-lint-ignore no-explicit-any
      const linkByItem: Record<string, any> = {};
      if (paid && ids.length) {
        const { data: ks } = await db.from("license_keys").select("order_item_id, key_value").in("order_item_id", ids).order("sent_at");
        for (const k of ks ?? []) (keysByItem[k.order_item_id] ??= []).push(k.key_value);
        const { data: ls } = await db.from("downloads")
          .select("order_item_id, token, status, download_count, max_downloads, expires_at, created_at")
          .in("order_item_id", ids).eq("status", "active").order("created_at", { ascending: false });
        for (const l of ls ?? []) if (!linkByItem[l.order_item_id]) linkByItem[l.order_item_id] = l;
      }

      return json({
        ref: o.ref, status: o.status, amount_fcfa: o.amount_fcfa, created_at: o.created_at,
        payment_method: o.payment_method, has_payment_ref: !!o.payment_ref, has_paydunya: !!o.paydunya_token,
        items: items.map((i) => {
          const link = linkByItem[i.id];
          let download = null;
          if (i.status === "delivered" && i.products?.installer_path && ["key_file", "file"].includes(i.delivery_type)) {
            let state = "none";
            if (link) state = link.download_count >= link.max_downloads ? "used" : new Date(link.expires_at) < new Date() ? "expired" : "ready";
            download = { state, token: state === "ready" ? link.token : null };
          }
          return {
            name: i.product_name, slug: i.products?.slug ?? null, image_url: i.products?.image_url ?? "",
            delivery_type: i.delivery_type, unit_price: i.unit_price, quantity: i.quantity, status: i.status,
            keys: i.status === "delivered" ? (keysByItem[i.id] ?? []) : [], download,
          };
        }),
      });
    }

    default:
      return json({ error: "action_inconnue" }, 400);
  }
});
