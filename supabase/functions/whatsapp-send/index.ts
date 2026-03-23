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
    // Verify Supabase JWT
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

    const { businessId, to, body, document, filename, caption } = (await req.json()) as WhatsAppRequest;

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
