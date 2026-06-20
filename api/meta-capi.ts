import type { VercelRequest, VercelResponse } from "@vercel/node";

const PIXEL_ID = "2464598340648858";
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN as string;
const GRAPH_VERSION = "v21.0";

// Pull a named cookie out of the raw Cookie header
function readCookie(cookieHeader: string, name: string) {
  const match = cookieHeader.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  if (!ACCESS_TOKEN) {
    console.error("Missing META_CAPI_ACCESS_TOKEN");
    return res.status(500).json({ error: "Server not configured." });
  }

  try {
    const body = (req.body || {}) as {
      event_name?: string;
      event_id?: string;
      event_source_url?: string;
      user_agent?: string;
      user_data?: Record<string, any>;
      custom_data?: Record<string, any>;
    };

    // --- identifiers that let Meta match the event to a real person ---
    const cookieHeader = String(req.headers.cookie || "");
    const fbp = readCookie(cookieHeader, "_fbp");
    const fbc = readCookie(cookieHeader, "_fbc");

    const forwarded = String(req.headers["x-forwarded-for"] || "");
    const clientIp =
      forwarded.split(",")[0].trim() || String(req.headers["x-real-ip"] || "");

    const userAgent = body.user_agent || String(req.headers["user-agent"] || "");

    const payload = {
      data: [
        {
          event_name: body.event_name || "PageView",
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          // event_id lets Meta dedupe this against the browser pixel event
          ...(body.event_id ? { event_id: body.event_id } : {}),
          ...(body.event_source_url || req.headers.referer
            ? { event_source_url: body.event_source_url || String(req.headers.referer) }
            : {}),
          user_data: {
            client_user_agent: userAgent,
            ...(clientIp ? { client_ip_address: clientIp } : {}),
            ...(fbp ? { fbp } : {}),
            ...(fbc ? { fbc } : {}),
            ...(body.user_data || {}),
          },
          custom_data: body.custom_data || {},
        },
      ],
    };

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("CAPI error:", JSON.stringify(result));
      return res.status(502).json({ success: false, result });
    }

    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("CAPI Error:", error);
    return res.status(500).json({ success: false });
  }
}
