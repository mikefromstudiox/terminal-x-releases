import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RncResult {
  rnc: string;
  name: string;
  status: string;
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
    const { rnc } = await req.json();

    if (!rnc || typeof rnc !== "string") {
      return new Response(JSON.stringify({ error: "rnc is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize: strip dashes/spaces, digits only
    const cleanRnc = rnc.replace(/[\s-]/g, "");
    if (!/^\d{9,11}$/.test(cleanRnc)) {
      return new Response(JSON.stringify({ error: "Invalid RNC format (expected 9-11 digits)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Check cache first
    const { data: cached } = await adminClient
      .from("rnc_cache")
      .select("rnc, name, status")
      .eq("rnc", cleanRnc)
      .single();

    if (cached) {
      return new Response(JSON.stringify(cached as RncResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fallback: megaplus.com.do API
    const megaplusUrl = `https://api.megaplus.com.do/api/rnc/${cleanRnc}`;
    const apiRes = await fetch(megaplusUrl, {
      headers: { "Accept": "application/json" },
    });

    if (!apiRes.ok) {
      return new Response(JSON.stringify({ error: "RNC not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiData = await apiRes.json();

    // megaplus returns different field names — normalize
    const name: string = apiData.nombre || apiData.name || apiData.razon_social || "";
    const status: string = apiData.estado || apiData.status || "ACTIVO";

    if (!name) {
      return new Response(JSON.stringify({ error: "RNC not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result: RncResult = { rnc: cleanRnc, name, status };

    // 3. Cache the result (fire and forget, don't block response)
    adminClient
      .from("rnc_cache")
      .upsert({ rnc: cleanRnc, name, status, looked_up_at: new Date().toISOString() })
      .then(() => {});

    return new Response(JSON.stringify(result), {
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
