// One ID we attach to BOTH the pixel event and its CAPI twin, so Meta dedupes them.
export function newEventId(): string {
  return (self.crypto && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function sendCAPIEvent(
  eventName: string,
  options: { eventId?: string; customData?: Record<string, any> } = {}
) {
  try {
    await fetch("/api/meta-capi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: eventName,
        event_id: options.eventId,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        event_source_url: typeof window !== "undefined" ? window.location.href : "",
        custom_data: options.customData || {},
      }),
    });
  } catch (e) {
    console.error("CAPI request failed:", e);
  }
}
