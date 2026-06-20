import React, { useEffect, useState } from "react";
import { clearCart as storeClear } from "../stores/cart";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

function formatDateUK(iso: string) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function weekdayFromISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[date.getDay()];
}

type ConfirmOrder = {
  orderId?: string; formattedDate: string; deliveryWindow: string; lines: string[];
  qtyTotal: number; plainQty: number; flavQty: number;
  totalText: string; totalValue: number;
  address: string; name: string; paymentMethod: string;
};

function buildConfirmOrderFromDraft(draft: any, orderId: string, paymentMethod: string): ConfirmOrder | null {
  if (!draft) return null;

  // SUBSCRIPTION
  if (draft?.kind === "subscription") {
    const plan = draft?.plan || {};
    const planKey = String(plan?.key || "");
    const planLabel = String(plan?.label || planKey || "Plan");
    const firstISO = String(draft?.first_delivery_iso || "");
    const firstText =
      String(draft?.first_delivery_text || "") ||
      (firstISO ? `${formatDateUK(firstISO)} (${weekdayFromISO(firstISO)})` : "");
    const lines: string[] =
      planKey === "MIX" ? ["Weekly box: 2× BFC, 3× STR, 2× MNG (7 bottles)"]
      : planKey ? [`Weekly box: 7× ${planKey} (${planLabel})`]
      : ["Weekly box (7 bottles)"];
    const priceLabel = String(plan?.priceLabel || "");
    const numeric = Number(priceLabel.replace(/[^\d.]/g, "")) || 0;
    return {
      orderId: orderId || "",
      formattedDate: firstText || "Monday",
      deliveryWindow: String(draft?.delivery_window || "18:30–20:00"),
      lines, qtyTotal: 7,
      plainQty: planKey === "PLN" ? 7 : planKey === "MIX" ? 1 : 0,
      flavQty: planKey === "MIX" ? 6 : ["BFC", "STR", "MNG"].includes(planKey) ? 7 : 0,
      totalText: numeric ? gbp(numeric) : priceLabel || "—",
      totalValue: numeric,
      address: String(draft?.customer?.address || ""),
      name: String(draft?.customer?.name || ""),
      paymentMethod,
    };
  }

  // ONE-OFF
  const lines: string[] = Array.isArray(draft.lines) ? draft.lines : [];
  const iso = String(draft.delivery_date_iso || "");
  const formattedDate = iso ? `${formatDateUK(iso)} (${weekdayFromISO(iso)})` : String(draft.delivery_date || "");
  const totals = draft.totals || {};
  const total = Number(totals.total ?? 0);
  return {
    orderId: orderId || "",
    formattedDate,
    deliveryWindow: String(draft.delivery_window || "18:30–20:00"),
    lines,
    qtyTotal: Number(totals.qtyTotal ?? 0),
    plainQty: Number(totals.plainQty ?? 0),
    flavQty: Number(totals.flavQty ?? 0),
    totalText: gbp(total),
    totalValue: total,
    address: String(draft?.customer?.address || ""),
    name: String(draft?.customer?.name || ""),
    paymentMethod,
  };
}

function ConfettiOverlay() {
  const pieces = Array.from({ length: 80 });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-40">
      {pieces.map((_, i) => (
        <span key={i} className="confetti-piece" style={{
          left: Math.random() * 100 + "%",
          animationDelay: Math.random() * 1.5 + "s",
          backgroundColor: ["#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#e5e7eb"][i % 5],
        }} />
      ))}
    </div>
  );
}

export default function OrderConfirmation() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [order, setOrder] = useState<ConfirmOrder | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("provider");
    const sessionId = params.get("session_id");

    async function run() {
      try {
        if ((provider !== "stripe" && provider !== "stripe_sub") || !sessionId) {
          setStatus("error");
          return;
        }
        const r = await fetch(`/api/stripe/verify-session?session_id=${encodeURIComponent(sessionId)}`);
        const data = await r.json();
        if (!data?.paid) { setStatus("error"); return; }

        const orderId = data.order_id || "";
        const rawDraft = sessionStorage.getItem("yoy_checkout_draft");
        const draft = rawDraft ? JSON.parse(rawDraft) : null;
        const paymentMethod = provider === "stripe" ? "Stripe" : "Weekly Gut Punch (Stripe)";
        const built = buildConfirmOrderFromDraft(draft, orderId, paymentMethod);

        if (!built) { setStatus("error"); return; }
        if (data.customer_name) built.name = data.customer_name;
        if (data.customer_address) built.address = data.customer_address;

        setOrder(built);
        setStatus("ok");

        // Meta Pixel Purchase (pairs with server-side CAPI via shared event ID)
        if ((window as any).fbq) {
          (window as any).fbq("track", "Purchase",
            { value: built.totalValue || 0, currency: "GBP" },
            { eventID: built.orderId });
        }

        // Klaviyo "Placed Order"
        try {
          const _learnq = ((window as any)._learnq = (window as any)._learnq || []);
          _learnq.push(["track", "Placed Order", {
            "$event_id": built.orderId || "unknown",
            "$value": built.totalValue || 0,
            "OrderId": built.orderId || "unknown",
            "Currency": "GBP",
            "Items": (built.lines || []).map((line, i) => ({
              ProductName: line, ProductID: `item-${i}`, Quantity: 1, ItemPrice: 0,
            })),
          }]);
        } catch {}

        // Clear cart for one-off orders only (subscriptions don't use the cart)
        if (provider === "stripe") storeClear();
        sessionStorage.removeItem("yoy_checkout_draft");
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    }
    run();
  }, []);

  // ---------- LOADING ----------
  if (status === "loading") {
    return (
      <section className="min-h-[60vh] flex items-center justify-center px-4 bg-black text-white">
        <p className="text-white/80">Confirming your order…</p>
      </section>
    );
  }

  // ---------- ERROR / NOT VERIFIED ----------
  if (status === "error" || !order) {
    return (
      <section className="min-h-[60vh] flex items-center justify-center px-4 bg-black text-white">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">We couldn't confirm your order</h1>
          <p className="mt-3 text-white/75 text-sm leading-relaxed">
            If you completed payment, your order is still safe and you'll receive a confirmation email shortly.
            If you have any questions, email <a href="mailto:support@yoghurtofyouth.co.uk" className="underline">support@yoghurtofyouth.co.uk</a>.
          </p>
          <a href="/" className="inline-block mt-6 rounded-2xl bg-white text-black px-6 py-2.5 text-sm font-semibold hover:bg-amber-300 transition">Return to homepage</a>
        </div>
      </section>
    );
  }

  const isSub = order.paymentMethod.toLowerCase().includes("weekly gut punch");

  // ---------- SUCCESS ----------
  return (
    <section className="relative min-h-[70vh] py-12 px-4 bg-black text-white overflow-hidden">
      <ConfettiOverlay />
      <div className="relative z-10 mx-auto max-w-lg rounded-2xl border border-white/15 p-6" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
        <h1 className="text-2xl font-bold">{isSub ? "Subscription confirmed" : "Order confirmed"}</h1>
        <p className="text-sm text-white/80 mt-1">
          {isSub
            ? <>Thank you, {order.name}. Your <span className="font-semibold">Weekly Gut Punch</span> subscription is live.</>
            : <>Thank you for your order, {order.name}.</>}
        </p>

        <div className="mt-3 rounded-xl bg-black/40 border border-white/15 px-4 py-3 text-sm">
          <div className="text-white/60">{isSub ? "Subscription reference" : "Order reference"}</div>
          <div className="font-mono font-semibold tracking-wide break-all">{order.orderId || "—"}</div>
        </div>

        <div className="my-4 border-t border-white/20" />

        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-white/60">{isSub ? "First dispatch" : "Dispatch date"}</div>
            <div className="font-medium">{order.formattedDate}</div>
          </div>
          <div>
            <div className="text-white/60">{isSub ? "Billing" : "Payment method"}</div>
            <div className="font-medium">{isSub ? <>Weekly · charged on <span className="font-semibold">Monday</span></> : order.paymentMethod}</div>
          </div>
          <div>
            <div className="text-white/60">{isSub ? "Weekly price" : "Total paid"}</div>
            <div className="font-semibold text-emerald-400">{order.totalText}</div>
          </div>
        </div>

        <div className="mt-4 text-sm">
          <div className="text-white/60 mb-1">Delivery address</div>
          <div className="leading-relaxed">{order.address}</div>
        </div>

        <div className="mt-5 rounded-2xl bg-black/40 border border-white/15 p-4 text-sm">
          <div className="font-semibold mb-2">{isSub ? "What you'll receive each week" : "Order summary"}</div>
          <div className="space-y-1 text-white/85">
            {order.lines.map((line, i) => (<div key={i}>• {line}</div>))}
          </div>
          {isSub && (
            <div className="mt-3 text-white/70 text-xs leading-relaxed">
              We alternate PRCXN and SPCTRL by week. Your yoghurt is fermented on the day before dispatch for freshness. Delivery is £4.95 for Weekly Gut Punch.
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-white/70 leading-relaxed">
          Your yoghurt is fermented on the day before dispatch for freshness. You'll receive an email receipt with full order details shortly. If it doesn't arrive within 5 minutes, please check spam. Questions? Email support@yoghurtofyouth.co.uk.
        </p>
        {isSub && (
          <p className="mt-3 text-xs text-white/70 leading-relaxed">
            To cancel, email support@yoghurtofyouth.co.uk with your name and address and we'll cancel your subscription shortly.
          </p>
        )}

        <a href="/" className="mt-6 inline-block w-full text-center rounded-2xl bg-white text-black py-3 text-sm font-semibold hover:bg-amber-300 transition">
          Continue shopping
        </a>
      </div>
    </section>
  );
}