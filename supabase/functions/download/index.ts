// ============================================================
// Fonction "download" (v2) : vérifie le lien du client et délivre
// le fichier UNE SEULE FOIS. Le fichier dépend du produit commandé.
// Remplace le code de la fonction "download" existante.
// IMPORTANT : "Verify JWT" reste désactivé pour cette fonction.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ================= Journal (table app_logs, onglet « Journal » de l'admin) =================
// Jamais de clé ni de secret : les champs sensibles sont masqués avant l'écriture.
const SECRET_RE = /key|token|secret|password|passwd|authorization|cle|serial|apikey/i;
function cleanDetail(v: unknown, depth = 0): unknown {
  if (v == null) return v;
  if (typeof v === "string") return v.replace(/Bearer\s+\S+/gi, "Bearer ***").replace(/\b(re|sk|pk|live|test)_[A-Za-z0-9_-]{8,}/g, "***").slice(0, 800);
  if (typeof v !== "object") return v;
  if (depth > 3) return "…";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => cleanDetail(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30)) out[k] = SECRET_RE.test(k) ? "***" : cleanDetail(x, depth + 1);
  return out;
}
async function logEvent(level: "info" | "warn" | "error", source: string, message: string, detail?: unknown, orderRef?: string | null) {
  if (level === "error") console.error(source, message);
  try {
    const d = detail instanceof Error ? { erreur: detail.message, pile: String(detail.stack ?? "").slice(0, 800) } : detail;
    await db.from("app_logs").insert({ level, source, message: String(message).slice(0, 300), detail: d === undefined ? null : cleanDetail(d), order_ref: orderRef ?? null });
  } catch (_) { /* le journal ne doit jamais bloquer la boutique */ }
}

const BUCKET = "installers";
const DEFAULT_FILE = Deno.env.get("INSTALLER_PATH") ?? "Office_2024_FR_64Bits.exe";

Deno.serve(async (req) => {
  try { return await handle(req); } catch (e) {
    await logEvent("error", "telechargement", "Erreur inattendue dans la fonction download", e);
    return json({ ok: false, reason: "error" }, 500);
  }
});
async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  let token = url.searchParams.get("t") ?? "";

  if (req.method === "POST") {
    try {
      const b = await req.json();
      if (b?.t) token = String(b.t);
    } catch (_) { /* ignore */ }
  }

  if (!token || token.length > 64) return json({ ok: false, reason: "not_found" });

  const { data: row } = await db
    .from("downloads")
    .select("status, expires_at, download_count, max_downloads, products(name, installer_path)")
    .eq("token", token)
    .maybeSingle();

  // deno-lint-ignore no-explicit-any
  const prod: any = row?.products;
  const file: string = prod?.installer_path || DEFAULT_FILE;
  const productName: string = prod?.name || "Office";

  // GET = simple vérification, ne consomme rien (les aperçus WhatsApp ne cassent pas le lien)
  if (req.method === "GET") {
    let reason = "ok";
    if (!row) reason = "not_found";
    else if (row.status === "revoked") reason = "revoked";
    else if (row.status === "pending") reason = "pending";
    else if (new Date(row.expires_at) < new Date()) reason = "expired";
    else if (row.download_count >= row.max_downloads) reason = "limit";
    return json({ ok: reason === "ok", reason, product: row ? productName : undefined });
  }

  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);

  // POST = clic sur "Télécharger" : on consomme le lien (atomique)
  const { data: reason, error } = await db.rpc("consume_download", { p_token: token });
  if (error) { await logEvent("error", "telechargement", "Erreur en consommant un lien de téléchargement", { erreur: error.message, produit: productName }); return json({ ok: false, reason: "error" }, 500); }
  if (reason !== "ok") return json({ ok: false, reason });

  // Lien externe (Google Drive, site de l'éditeur…) : on le donne tel quel, le lien licenceoff reste à usage unique
  if (/^https:\/\//i.test(file)) { await logEvent("info", "telechargement", "Téléchargement de « " + productName + " » (lien externe)"); return json({ ok: true, url: file }); }

  // Adresse du fichier valable 60 secondes seulement
  const { data: signed, error: e2 } = await db.storage
    .from(BUCKET)
    .createSignedUrl(file, 60, { download: file.split("/").pop() });

  if (e2 || !signed?.signedUrl) {
    await db.rpc("refund_download", { p_token: token });
    await logEvent("error", "telechargement", "Fichier introuvable dans le stockage : le client n'a pas pu télécharger « " + productName + " »", { fichier: file, erreur: e2?.message ?? null });
    return json({ ok: false, reason: "error" }, 500);
  }

  await logEvent("info", "telechargement", "Téléchargement de « " + productName + " »");
  return json({ ok: true, url: signed.signedUrl });
}
