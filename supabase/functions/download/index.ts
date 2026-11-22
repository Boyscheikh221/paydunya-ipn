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

const BUCKET = "installers";
const DEFAULT_FILE = Deno.env.get("INSTALLER_PATH") ?? "Office_2024_FR_64Bits.exe";

Deno.serve(async (req) => {
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
  if (error) return json({ ok: false, reason: "error" }, 500);
  if (reason !== "ok") return json({ ok: false, reason });

  // Lien externe (Google Drive, site de l'éditeur…) : on le donne tel quel, le lien licenceoff reste à usage unique
  if (/^https:\/\//i.test(file)) return json({ ok: true, url: file });

  // Adresse du fichier valable 60 secondes seulement
  const { data: signed, error: e2 } = await db.storage
    .from(BUCKET)
    .createSignedUrl(file, 60, { download: file.split("/").pop() });

  if (e2 || !signed?.signedUrl) {
    await db.rpc("refund_download", { p_token: token });
    return json({ ok: false, reason: "error" }, 500);
  }

  return json({ ok: true, url: signed.signedUrl });
});
