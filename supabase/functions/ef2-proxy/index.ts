import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Ef2Request {
  businessId: string;
  path: string;
  payload: Record<string, unknown>;
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
    // Verify Supabase JWT from Authorization header
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

    // Verify the user's JWT
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

    const { businessId, path, payload } = (await req.json()) as Ef2Request;

    if (!businessId || !path) {
      return new Response(JSON.stringify({ error: "businessId and path are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch ef2 credentials from businesses.settings using service role
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

    const ef2Token = settings?.ef2_token;
    const ef2Username = settings?.ef2_username;

    if (!ef2Token) {
      return new Response(JSON.stringify({ error: "ef2 credentials not configured for this business" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Forward request to ef2.do API
    const ef2Url = `https://ef2.do/api${path}`;
    const ef2Response = await fetch(ef2Url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ef2Token}`,
        ...(ef2Username ? { "X-EF2-Username": ef2Username } : {}),
      },
      body: JSON.stringify(payload),
    });

    const ef2Data = await ef2Response.text();

    // Try to parse as JSON, otherwise return raw
    let responseBody: string;
    try {
      const parsed = JSON.parse(ef2Data);
      responseBody = JSON.stringify(parsed);
    } catch {
      responseBody = JSON.stringify({ raw: ef2Data });
    }

    return new Response(responseBody, {
      status: ef2Response.status,
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
