import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface WhatsAppRequest {
  businessId: string;
  to: string;
  body?: string;
  document?: string;   // base64 encoded document
  filename?: string;
  caption?: string;
}

// FIX-C4 — Taller Mecánico preventive-maintenance reminder batch.
// Cron job (pg_cron) calls this with kind='mechanic_service_reminder' and the
// service-role key in the Authorization header. The function then resolves
// every business that has WhatsApp configured, calls the SQL helper
// `mechanic_service_reminders_due()` per business, and dispatches one
// UltraMsg text per vehicle. Failures are non-fatal — the row stays due
// next cycle.
interface MechanicReminderRequest {
  kind: "mechanic_service_reminder";
  // Optional: scope to a single business (cron passes none → all businesses).
  businessId?: string;
  // Optional: dry-run (returns the would-send list without firing UltraMsg).
  dryRun?: boolean;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Branch A: cron-triggered batch (mechanic service reminders). ─────
    // Authenticated by the service-role key (Bearer <SUPABASE_SERVICE_ROLE_KEY>).
    // Returns { dispatched, failures, dryRun? }. Always 200 unless the auth
    // header itself is wrong — individual UltraMsg failures are reported in
    // the body so the cron can be observed without false alarms.
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isServiceRoleCall = bearer && bearer === supabaseServiceKey;

    let payload: WhatsAppRequest | MechanicReminderRequest;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((payload as MechanicReminderRequest).kind === "mechanic_service_reminder") {
      if (!isServiceRoleCall) {
        return new Response(JSON.stringify({ error: "service_role_required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return await runMechanicServiceReminderBatch(
        payload as MechanicReminderRequest,
        supabaseUrl,
        supabaseServiceKey,
        corsHeaders,
      );
    }

    // ── Branch B: standard user-authenticated single message. ────────────
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { businessId, to, body, document, filename, caption } = payload as WhatsAppRequest;

    if (!businessId || !to) {
      return new Response(JSON.stringify({ error: "businessId and to are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body && !document) {
      return new Response(JSON.stringify({ error: "Either body (text) or document (base64) is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch WhatsApp credentials from businesses.settings
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: business, error: bizError } = await adminClient
      .from("businesses")
      .select("settings")
      .eq("id", businessId)
      .single();

    if (bizError || !business) {
      return new Response(JSON.stringify({ error: "Business not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settings = typeof business.settings === "string"
      ? JSON.parse(business.settings)
      : business.settings;

    const instance = settings?.whatsapp_instance;
    const token = settings?.whatsapp_token;

    if (!instance || !token) {
      return new Response(JSON.stringify({ error: "WhatsApp credentials not configured for this business" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let ultraUrl: string;
    let ultraBody: Record<string, string>;

    if (document) {
      // Send document message
      ultraUrl = `https://api.ultramsg.com/${instance}/messages/document`;
      ultraBody = {
        token,
        to,
        document,
        filename: filename || "document.pdf",
        caption: caption || "",
      };
    } else {
      // Send text message
      ultraUrl = `https://api.ultramsg.com/${instance}/messages/chat`;
      ultraBody = {
        token,
        to,
        body: body!,
      };
    }

    const ultraRes = await fetch(ultraUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ultraBody),
    });

    const ultraData = await ultraRes.json();

    if (!ultraRes.ok) {
      return new Response(JSON.stringify({ error: "UltraMsg API error", details: ultraData }), {
        status: ultraRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, data: ultraData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Phone normalization for DR. UltraMsg expects E.164-ish without +.
// Accepts "809-555-1234", "8095551234", "+18095551234", "1-809-555-1234".
// DR mobile prefix logic mirrors packages/services/phone.js.
function normalizeDRPhone(raw: string): string | null {
  if (!raw) return null;
  let n = String(raw).replace(/\D/g, "");
  if (!n) return null;
  // Already international (has country code)
  if (n.length === 11 && n.startsWith("1")) return n;
  // 10-digit DR number (809/829/849 + 7 digits)
  if (n.length === 10 && /^(809|829|849)/.test(n)) return "1" + n;
  // 7-digit local — cannot infer area code; skip.
  return null;
}

function buildReminderText(row: {
  plate?: string;
  vin?: string;
  make?: string;
  model?: string;
  km_remaining?: number | null;
  days_remaining?: number | null;
}): string {
  const id = row.plate || row.vin || "su vehículo";
  const car = [row.make, row.model].filter(Boolean).join(" ");
  const parts: string[] = [];
  parts.push(`Hola, su vehículo ${id}${car ? ` (${car})` : ""} está cerca de su próximo servicio.`);
  if (typeof row.km_remaining === "number" && row.km_remaining >= 0) {
    parts.push(`Faltan ${row.km_remaining.toLocaleString("en-US")} km para el cambio de aceite.`);
  } else if (typeof row.days_remaining === "number" && row.days_remaining >= 0) {
    parts.push(`Faltan ${row.days_remaining} días para el próximo mantenimiento.`);
  } else {
    parts.push("Es momento de programar su mantenimiento preventivo.");
  }
  parts.push("Agende en Terminal X.");
  return parts.join(" ");
}

async function runMechanicServiceReminderBatch(
  req: MechanicReminderRequest,
  supabaseUrl: string,
  supabaseServiceKey: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const dryRun = !!req.dryRun;
  let dispatched = 0;
  let failures: Array<{ businessId: string; to?: string; reason: string }> = [];
  const skipped: Array<{ businessId: string; reason: string }> = [];

  // Resolve target businesses. If req.businessId given → just that one;
  // otherwise every business with mechanic vertical and WhatsApp configured.
  let bizQuery = admin.from("businesses").select("id, name, settings");
  if (req.businessId) bizQuery = bizQuery.eq("id", req.businessId);
  const { data: bizRows, error: bizErr } = await bizQuery;
  if (bizErr) {
    return new Response(JSON.stringify({ error: "biz_query_failed", detail: bizErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const biz of bizRows || []) {
    const settings = typeof biz.settings === "string"
      ? (() => { try { return JSON.parse(biz.settings) } catch { return {} } })()
      : (biz.settings || {});
    const instance = settings?.whatsapp_instance;
    const token = settings?.whatsapp_token;
    if (!instance || !token) {
      skipped.push({ businessId: biz.id, reason: "whatsapp_not_configured" });
      continue;
    }

    // Pull due reminders for this business via the SQL helper.
    const { data: due, error: dueErr } = await admin.rpc("mechanic_service_reminders_due", { p_business_id: biz.id });
    if (dueErr) {
      failures.push({ businessId: biz.id, reason: "rpc_failed: " + dueErr.message });
      continue;
    }
    if (!due || !due.length) continue;

    // For each due vehicle, resolve client phone via vehicles → clients.
    for (const v of due) {
      let phone: string | null = null;
      if (v.client_supabase_id) {
        const { data: cli } = await admin.from("clients")
          .select("phone").eq("supabase_id", v.client_supabase_id).maybeSingle();
        phone = normalizeDRPhone(cli?.phone || "");
      }
      if (!phone) {
        skipped.push({ businessId: biz.id, reason: `no_phone:${v.plate || v.vin || v.vehicle_supabase_id}` });
        continue;
      }
      const body = buildReminderText({
        plate: v.plate, vin: v.vin, make: v.make, model: v.model,
        km_remaining: v.km_remaining, days_remaining: v.days_remaining,
      });

      if (dryRun) { dispatched++; continue; }

      try {
        const r = await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, to: phone, body }),
        });
        if (!r.ok) {
          const text = await r.text();
          failures.push({ businessId: biz.id, to: phone, reason: `ultramsg_${r.status}: ${text.slice(0, 120)}` });
          continue;
        }
        dispatched++;
        // Best-effort audit trail — non-blocking.
        try {
          await admin.from("activity_log").insert({
            business_id: biz.id,
            event_type: "wo_parts_received", // closest existing meta — overload OK; replace once a dedicated meta lands
            severity: "info",
            target_type: "vehicle",
            target_name: v.plate || v.vin,
            metadata: {
              kind: "mechanic_service_reminder",
              vehicle_supabase_id: v.vehicle_supabase_id,
              km_remaining: v.km_remaining,
              days_remaining: v.days_remaining,
              to_phone: phone,
            },
          });
        } catch { /* ignore */ }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        failures.push({ businessId: biz.id, to: phone, reason: `fetch_failed: ${msg}` });
      }
    }
  }

  return new Response(JSON.stringify({
    success: true,
    dispatched,
    failures,
    skipped: skipped.length,
    dryRun,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
