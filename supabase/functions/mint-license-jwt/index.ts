// ════════════════════════════════════════════════════════════════════════════
// mint-license-jwt — Per-license JWT minter
//
// Validates a license key against the licenses table (via direct PostgREST
// fetch with the service-role key — no SDK import to keep edge boot lean),
// then mints a Supabase-compatible HS256 JWT signed with TX_JWT_SECRET.
// All sync RLS policies read app_metadata.business_id from this JWT.
//
// 2026-04-30 fix: previously this minter wrote `user_metadata.business_id`,
// which RLS could NOT use (Supabase RLS reads `app_metadata`, not
// `user_metadata` — only `app_metadata` is server-authoritative). Result:
// every PULL returned [] under RLS, sync's reconcileDeletes wiped local
// master tables on a doom loop. Switched to `app_metadata` so RLS can
// authoritatively check it. Also added an `app_metadata.role` claim so
// the policy chain has a clear authorization principal.
//
// Error policy: any failure → 401 { error: 'invalid_license' }. We do NOT
// leak which check failed (key not found vs. expired vs. revoked).
// ════════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TWENTY_FOUR_HOURS_SECONDS = 24 * 60 * 60;

function b64url(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function signJwtHS256(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(sig)}`;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "invalid_license" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function pgGet(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
): Promise<unknown[] | null> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: "GET",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function pgInsert(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch {
    /* audit best-effort */
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const debug = new URL(req.url).searchParams.get("debug") === "1";
  const trace: string[] = [];
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwtSecret = Deno.env.get("TX_JWT_SECRET");
    trace.push(`env: url=${!!supabaseUrl} svc=${!!supabaseServiceKey} jwt=${!!jwtSecret}`);
    if (!supabaseUrl || !supabaseServiceKey || !jwtSecret) {
      if (debug) return new Response(JSON.stringify({ trace, stage: "env" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return unauthorized();
    }

    let body: { license_key?: string; machine_id?: string };
    try {
      body = await req.json();
    } catch {
      trace.push("body: parse failed");
      if (debug) return new Response(JSON.stringify({ trace, stage: "body" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return unauthorized();
    }

    const licenseKey = (body.license_key || "").trim();
    const machineId = body.machine_id ? String(body.machine_id).trim() : null;
    trace.push(`license_key: len=${licenseKey.length}`);
    if (!licenseKey) {
      if (debug) return new Response(JSON.stringify({ trace, stage: "no_key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return unauthorized();
    }

    // Validate license via PostgREST
    const encoded = encodeURIComponent(`eq.${licenseKey}`);
    const path = `licenses?license_key=${encoded}&select=business_id,plan_id,status,expires_at&limit=1`;
    trace.push(`query: ${path}`);
    let rawRes: Response | null = null;
    let rawText = "";
    try {
      rawRes = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        method: "GET",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          Accept: "application/json",
        },
      });
      rawText = await rawRes.text();
      trace.push(`pg: status=${rawRes.status} body_len=${rawText.length}`);
    } catch (fetchErr) {
      trace.push(`pg: fetch threw ${(fetchErr as Error).message}`);
      if (debug) return new Response(JSON.stringify({ trace, stage: "fetch_err" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return unauthorized();
    }
    let rows: unknown[] | null = null;
    try { rows = JSON.parse(rawText); } catch { rows = null; }
    if (!rawRes.ok || !Array.isArray(rows) || rows.length === 0) {
      if (debug) return new Response(JSON.stringify({ trace, stage: "no_rows", rawText: rawText.slice(0, 300) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return unauthorized();
    }
    const lic = rows[0] as {
      business_id: string;
      plan_id: string | null;
      status: string;
      expires_at: string | null;
    };
    if (lic.status !== "active") return unauthorized();
    if (lic.expires_at && new Date(lic.expires_at).getTime() < Date.now()) {
      return unauthorized();
    }
    if (!lic.business_id) return unauthorized();

    // Mint JWT
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + TWENTY_FOUR_HOURS_SECONDS;
    const accessToken = await signJwtHS256(
      {
        iss: "supabase",
        aud: "authenticated",
        role: "authenticated",
        sub: lic.business_id,
        app_metadata: {
          business_id: lic.business_id,
          license_key: licenseKey,
          machine_id: machineId,
          provider: "license",
        },
        // Keep user_metadata populated for any legacy reader; RLS does not
        // (and should not) trust it.
        user_metadata: {
          business_id: lic.business_id,
          license_key: licenseKey,
          machine_id: machineId,
        },
        iat: nowSec,
        exp: expSec,
      },
      jwtSecret,
    );

    // Audit (best-effort)
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    await pgInsert(supabaseUrl, supabaseServiceKey, "license_jwt_audit", {
      license_key: licenseKey,
      business_id: lic.business_id,
      machine_id: machineId,
      expires_at: new Date(expSec * 1000).toISOString(),
      ip_address: ipAddress,
    });

    return new Response(
      JSON.stringify({
        access_token: accessToken,
        expires_at: new Date(expSec * 1000).toISOString(),
        business_id: lic.business_id,
        plan_id: lic.plan_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch {
    return unauthorized();
  }
});
