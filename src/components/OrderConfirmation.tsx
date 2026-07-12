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
  address: string; name: string;
};

function buildConfirmOrderFromDraft(draft: any, orderId: string): ConfirmOrder | null {
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
  };
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
        const built = buildConfirmOrderFromDraft(draft, orderId);

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
      <section className="min-h-[60vh] flex items-center justify-center px-4 bg-white text-slate-900">
        <p className="text-slate-500">Confirming your order…</p>
      </section>
    );
  }

  // ---------- ERROR / NOT VERIFIED ----------
  if (status === "error" || !order) {
    return (
      <section className="min-h-[60vh] flex items-center justify-center px-4 bg-white text-slate-900">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-slate-900">We couldn't confirm your order</h1>
          <p className="mt-3 text-slate-600 text-sm leading-relaxed">
            If you completed payment, your order is still safe and you'll receive a confirmation email shortly.
            If you have any questions, email <a href="mailto:support@yoghurtofyouth.co.uk" className="underline hover:text-amber-500 transition">support@yoghurtofyouth.co.uk</a>.
          </p>
          <a href="/" className="inline-block mt-6 rounded-2xl bg-slate-900 text-white px-6 py-2.5 text-sm font-semibold hover:bg-slate-700 transition">Return to homepage</a>
        </div>
      </section>
    );
  }

  const params = new URLSearchParams(window.location.search);
  const isSub = params.get("provider") === "stripe_sub";

  // ---------- SUCCESS ----------
  return (
    <section className="relative min-h-[70vh] py-16 px-4 flex items-center justify-center bg-white text-slate-900 overflow-hidden">
      <div className="relative z-10 w-full max-w-md text-center">
        <h1 className="text-3xl font-bold text-slate-900">{isSub ? "Subscription confirmed" : "Order confirmed"}</h1>
        <p className="mt-2 text-slate-600">
          {isSub
            ? <>Thank you, {order.name}. Your weekly subscription is live.</>
            : <>Thank you for your order, {order.name}.</>}
        </p>

        <div className="mt-8">
          <div className="text-slate-400 text-xs uppercase tracking-wider">{isSub ? "Subscription reference" : "Order reference"}</div>
          <div className="mt-1 font-mono font-semibold text-lg tracking-wide break-all text-slate-900">{order.orderId || "—"}</div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <div className="text-slate-400 text-xs uppercase tracking-wider">{isSub ? "First dispatch" : "Dispatch date"}</div>
            <div className="mt-0.5 font-medium text-slate-800">{order.formattedDate}</div>
          </div>

          <div>
            <div className="text-slate-400 text-xs uppercase tracking-wider">{isSub ? "Weekly price" : "Total paid"}</div>
            <div className="mt-0.5 font-semibold text-emerald-600">{order.totalText}</div>
          </div>

          <div>
            <div className="text-slate-400 text-xs uppercase tracking-wider">Delivery address</div>
            <div className="mt-0.5 leading-relaxed text-slate-800">{order.address}</div>
          </div>

          <div>
            <div className="text-slate-400 text-xs uppercase tracking-wider">{isSub ? "What you'll receive each week" : "Order summary"}</div>
            <div className="mt-1 space-y-0.5 text-slate-800">
              {order.lines.map((line, i) => (<div key={i}>{line}</div>))}
            </div>
          </div>
        </div>

        {isSub && (
          <p className="mt-6 text-slate-500 text-xs leading-relaxed">
            We rotate through PRCXN, SPCTRL, and LVLV by week. Your yoghurt is fermented the day before dispatch for freshness. Chilled next-day delivery is £4.95.
          </p>
        )}

        <p className="mt-6 text-xs text-slate-500 leading-relaxed">
          Your yoghurt is fermented the day before dispatch for freshness. You'll receive an email receipt with full order details shortly. If it doesn't arrive within 5 minutes, please check spam. Questions? Email support@yoghurtofyouth.co.uk.
        </p>
        {isSub && (
          <p className="mt-3 text-xs text-slate-500 leading-relaxed">
            To cancel, email support@yoghurtofyouth.co.uk with your name and address and we'll cancel your subscription shortly.
          </p>
        )}

        <a href="/" className="inline-block mt-8 rounded-2xl bg-slate-900 text-white px-6 py-2.5 text-sm font-semibold hover:bg-slate-700 transition">
          Continue shopping
        </a>
      </div>
    </section>
  );
}