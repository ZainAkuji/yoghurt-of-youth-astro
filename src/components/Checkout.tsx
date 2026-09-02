import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { cart as cartStore } from "../stores/cart";
import { sendCAPIEvent, newEventId } from "../capi";
import {
  SUBSCRIPTION_DAY_NAME,
  SUBSCRIPTION_DAY,
  toISODate,
  formatDateUK,
  weekdayFromISO,
  nextDispatchISO,
  nextSubscriptionISO,
  dispatchDelayed,
} from "../config/dispatch";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const PRODUCTS = [
  { id: "PLN", name: "PLN", price: 2.8, size: "250 mL" },
  { id: "BFC", name: "BFC", price: 2.9, size: "250 mL" },
  { id: "STR", name: "STR", price: 2.9, size: "250 mL" },
  { id: "MNG", name: "MNG", price: 2.9, size: "250 mL" },
];

const DELIVERY = (n: number) => (n <= 0 ? 0 : n <= 4 ? 3.5 : n <= 9 ? 4.95 : 0);

function computeTotals(cart: Record<string, number>, discountPercent = 0, giftStrQty = 0) {
  const items = Object.entries(cart).map(([id, qty]) => {
    const p = PRODUCTS.find((x) => x.id === id);
    return p ? { ...p, qty } : null;
  }).filter(Boolean) as Array<(typeof PRODUCTS)[number] & { qty: number }>;

  const plainQty = items.filter(i => i.id === "PLN").reduce((s, i) => s + i.qty, 0);
  const flavQty  = items.filter(i => i.id !== "PLN").reduce((s, i) => s + i.qty, 0);
  const bottles  = plainQty + flavQty;
  const qtyTotal = bottles + (giftStrQty || 0);

  const freeTotal = Math.floor(bottles / 7);
  const freePlain = Math.min(freeTotal, plainQty);
  const freeFlav  = freeTotal - freePlain;

  const merchTotal = (plainQty - freePlain) * 2.8 + (flavQty - freeFlav) * 2.9;
  const fullPrice  = plainQty * 2.8 + flavQty * 2.9;
  const savings    = Math.max(0, fullPrice - merchTotal);
  const deliveryFee = DELIVERY(bottles);

  const discount = discountPercent > 0 ? Math.round(merchTotal * discountPercent) / 100 : 0;
  const total = merchTotal - discount + deliveryFee;

  return { items, qtyTotal, total, savings, merchTotal, deliveryFee, discount, plainQty, flavQty, freeTotal, bottles };
}

const SUB_PRICING: Record<string, { discount: number; delivery: number; plnWas: number; plnNow: number; flavWas: number; flavNow: number }> = {
  "4":  { discount: 5,  delivery: 3.5,  plnWas: 11.20, plnNow: 10.64, flavWas: 11.60, flavNow: 11.02 },
  "7":  { discount: 10, delivery: 4.95, plnWas: 16.80, plnNow: 15.12, flavWas: 17.40, flavNow: 15.66 },
  "14": { discount: 15, delivery: 0,    plnWas: 33.60, plnNow: 28.56, flavWas: 34.80, flavNow: 29.58 },
};

const MIX_CONTENTS: Record<string, string> = {
  "4": "1 BFC, 2 STR, 1 MNG",
  "7": "2 BFC, 3 STR, 2 MNG",
  "14": "4 BFC, 6 STR, 4 MNG",
};

const FLAVOUR_NAMES: Record<string, string> = {
  PLN: "Plain", BFC: "Black Forest", STR: "Strawberry", MNG: "Mango", MIX: "Mixed",
};

export default function Checkout() {
  const $cart = useStore(cartStore);
  const cart = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries($cart)) m[k] = Number(v || 0);
    return m;
  }, [$cart]);

  // Read mode + plan from URL
  const [mode, setMode] = useState<"oneoff" | "subscription">("oneoff");
  const [subPlan, setSubPlan] = useState<string>("PLN");
  const [subTier, setSubTier] = useState<string>("7");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "subscription") {
      setMode("subscription");
      setSubPlan(params.get("plan") || "PLN");
      setSubTier(params.get("tier") || "7");
    }
  }, []);

  const isSubscription = mode === "subscription";
  const subP = SUB_PRICING[subTier] || SUB_PRICING["7"];
  const subNow = subPlan === "PLN" ? subP.plnNow : subP.flavNow;
  const subWas = subPlan === "PLN" ? subP.plnWas : subP.flavWas;
  const subWeekly = subNow + subP.delivery;
  const firstISO = nextSubscriptionISO();
  const firstText = `${formatDateUK(firstISO)} ${weekdayFromISO(firstISO)}`;
  const date = nextDispatchISO();
  const formattedDate = formatDateUK(date);
  const deliveryWindow = "18:30–20:00";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [postcode, setPostcode] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [townCity, setTownCity] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [giftCode, setGiftCode] = useState("");

  const normalizedGiftCode = giftCode.trim().toUpperCase();
  const discountPercent = normalizedGiftCode === "MINUS10" ? 10 : 0;
  const giftStrQty = normalizedGiftCode === "YOY25" ? 1 : 0;

  const totalsWithGift = useMemo(() => computeTotals(cart, discountPercent, giftStrQty), [cart, discountPercent, giftStrQty]);
  const { qtyTotal, total, savings, deliveryFee, merchTotal, freeTotal } = totalsWithGift;

  const lines = Object.entries(cart).map(([id, qty]) => {
    const p = PRODUCTS.find((p) => p.id === id);
    return `${p?.name ?? id} × ${qty}`;
  });
  if (discountPercent > 0) lines.push(`10% discount applied (${normalizedGiftCode})`);
  if (giftStrQty > 0) lines.push(`STR × 1 (FREE — ${normalizedGiftCode})`);

  const normalizedPostcode = postcode.trim().toUpperCase();
  const fullAddress = [streetAddress.trim(), townCity.trim(), normalizedPostcode].filter(Boolean).join(", ");
  const valid = isSubscription ? true : (qtyTotal >= 3 && !!date);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Fire InitiateCheckout once, on arrival at checkout (catches every route in:
  // drawer Pay, Buy now, direct link, subscription)
  const [icFired, setIcFired] = useState(false);
  useEffect(() => {
    if (!mounted || icFired) return;
    if (!isSubscription && qtyTotal === 0) return; // wait for cart to hydrate
    const eventId = newEventId();
    const data = isSubscription
      ? { value: subWeekly, currency: "GBP", num_items: Number(subTier) }
      : { value: total, currency: "GBP", num_items: qtyTotal };
    if ((window as any).fbq) {
      (window as any).fbq("track", "InitiateCheckout", data, { eventID: eventId });
    }
    sendCAPIEvent("InitiateCheckout", { eventId, customData: data });
    setIcFired(true);
  }, [mounted, icFired, isSubscription, subWeekly, subTier, total, qtyTotal]);

  // Klaviyo "Started Checkout" — fires on arrival at checkout, so identified
  // visitors (email-list signups) who reach here but don't pay enter the
  // abandoned-checkout flow. Anonymous visitors attach to no profile (Klaviyo
  // ignores them), which is expected.
  const [klFired, setKlFired] = useState(false);
  useEffect(() => {
    if (!mounted || klFired) return;
    if (isSubscription) return;            // one-off carts only
    if (qtyTotal === 0) return;            // wait for cart to hydrate
    if (typeof window === "undefined") return;
    const klaviyo = ((window as any).klaviyo = (window as any).klaviyo || []);
    klaviyo.push(["track", "Started Checkout", {
      value: total,
      ItemNames: lines,
      Items: totalsWithGift.items.map((i: any) => ({
        ProductName: i.name,
        Quantity: i.qty,
        ItemPrice: i.price,
        RowTotal: Number((i.qty * i.price).toFixed(2)),
      })),
      CheckoutURL: "https://yoghurtofyouth.co.uk/shop?cart=open",
    }]);
    setKlFired(true);
  }, [mounted, klFired, isSubscription, qtyTotal, total, lines, totalsWithGift]);

  // hydrate from draft
  useEffect(() => {
    const raw = sessionStorage.getItem("yoy_checkout_draft");
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      setName(draft?.customer?.name || "");
      setEmail(draft?.customer?.email || "");
      setPhone(draft?.customer?.phone || "");
      setNote(draft?.note || "");
      setGiftCode(draft?.gift_code || "");
      const parts = String(draft?.customer?.address || "").split(",").map((p:string) => p.trim()).filter(Boolean);
      setStreetAddress(parts[0] || ""); setTownCity(parts[1] || ""); setPostcode(parts[2] || "");
    } catch {}
  }, []);

  // save draft
  useEffect(() => {
    const raw = sessionStorage.getItem("yoy_checkout_draft");
    let existing: any = {}; try { existing = raw ? JSON.parse(raw) : {}; } catch {}
    const updated = { ...existing, customer: { ...(existing.customer||{}), name, email, phone, address: fullAddress }, note, gift_code: giftCode, delivery_method: "delivery" };
    sessionStorage.setItem("yoy_checkout_draft", JSON.stringify(updated));
  }, [name, email, phone, fullAddress, note, giftCode]);

  async function startCheckout() {
    if (!valid) { setError("Please complete all required fields first."); return; }
    setSending(true); setError("");
    try {
      const customer = { name, email, phone, address: fullAddress };
      if (isSubscription) {
        const draft = { kind:"subscription", plan:{ key: subPlan, tier: subTier, weekly: subWeekly }, customer, note, first_delivery_iso:firstISO, first_delivery_text:firstText, delivery_window:"18:30–20:00", savedAt:Date.now(), provider:"stripe_sub" };
        sessionStorage.setItem("yoy_checkout_draft", JSON.stringify(draft));
        const res = await fetch("/api/stripe/create-subscription-session", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ planKey: subPlan, tier: subTier, customer, note }) });
        const text = await res.text(); let data:any={}; try{data=JSON.parse(text);}catch{}
        if (!res.ok) { setError(data?.error || "Subscription checkout failed (server error)."); return; }
        if (data?.url) window.location.href = data.url; else setError("Stripe subscription checkout failed.");
        return;
      }
      const draft = { cart, totals: totalsWithGift, customer, delivery_method:"delivery", delivery_date_iso:date, delivery_date:formattedDate, delivery_window:deliveryWindow, note, lines, gift_code:normalizedGiftCode, discount_percent:discountPercent, gift_str_qty:giftStrQty, savedAt:Date.now(), provider:"stripe" };
      sessionStorage.setItem("yoy_checkout_draft", JSON.stringify(draft));
      const res = await fetch("/api/stripe/create-checkout-session", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ cart, totals: totalsWithGift, lines, customer, delivery_method:"delivery", delivery_date:formattedDate, delivery_window:deliveryWindow, note, gift_code:normalizedGiftCode, discount_percent:discountPercent, gift_str_qty:giftStrQty }) });
      const text = await res.text(); let data:any={}; try{data=JSON.parse(text);}catch{}
      if (!res.ok) { setError(data?.error || "Checkout failed (server error)."); return; }
      if (data?.url) window.location.href = data.url; else setError("Stripe checkout failed.");
    } catch { setError("Stripe checkout failed."); } finally { setSending(false); }
  }

  const inputCls = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-amber-400";

  if (!mounted) {
    return (
      <div>
        <a href="/shop" className="text-sm text-slate-500 hover:text-amber-500 transition">← Back to shop</a>
        <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-slate-900">Checkout</h1>
        <p className="mt-3 text-sm text-slate-500">Loading your order…</p>
      </div>
    );
  }

  return (
    <div>
      <a href="/shop" className="text-sm text-slate-500 hover:text-amber-500 transition">← Back to shop</a>
      <h1 className="mt-2 ml-3 text-2xl sm:text-3xl font-bold text-slate-900">
        {isSubscription ? "Subscribe" : "Checkout"}
      </h1>

      {isSubscription ? (
        <div className="mt-3 ml-3 text-sm text-slate-700">
          <p>
            You're subscribing to <span className="font-semibold">{subTier} bottles</span> of{" "}
            <span className="font-semibold">{FLAVOUR_NAMES[subPlan] || subPlan}</span>
            {subPlan === "MIX" && <> ({MIX_CONTENTS[subTier]})</>}, every week, at{" "}
            <span className="font-semibold">{subP.discount}% off</span>.
          </p>
          <p className="mt-3">
            <span className="font-semibold">{gbp(subWeekly)} per week</span>
            {subP.delivery === 0
              ? <> — including free chilled next-day delivery.</>
              : <> — including {gbp(subP.delivery)} chilled next-day delivery.</>}
          </p>
          <p className="mt-3">
            First dispatch: <span className="font-semibold">{firstText}</span>, then every following {SUBSCRIPTION_DAY_NAME}.
          </p>
        </div>
      ) : (
        <div className="mt-3 ml-3 text-sm text-slate-700">
          <p>
            Review your order below, then continue to secure payment where you'll enter your contact and delivery details.
          </p>
          <p className="mt-3">
            Dispatch date: <span className="font-semibold">{formattedDate} {weekdayFromISO(date)}</span>. Fermented fresh the day before.
          </p>
          {dispatchDelayed(isSubscription ? "subscription" : "oneoff") && (
          <p className="mt-2 ml-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Bank holidays are affecting courier services this week, so this order will be dispatched on the date shown above rather than the usual schedule.
          </p>
        )}
        </div>
      )}

      <div className="mt-6">
        <input value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Order note (optional)" className={inputCls} />
        {!isSubscription && (
          <p className="mt-2 ml-3 text-xs text-slate-500">Have a one-time discount code? Apply it at the secure checkout on the next step.</p>
        )}
      </div>

      {!isSubscription && qtyTotal > 0 && (
        <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 p-5 text-sm text-slate-700">
          <div className="font-semibold text-slate-900 mb-3">Order summary</div>
          <div className="space-y-1">{lines.map((l,i)=>(<div key={i}>• {l}</div>))}</div>
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
            <div className="flex justify-between"><span>Bottles</span><span>{qtyTotal}</span></div>
            <div className="flex justify-between"><span>Subtotal</span><span>{gbp(merchTotal)}</span></div>
            {savings > 0 && <div className="flex justify-between text-emerald-600"><span>7 for 6 ({freeTotal} free)</span><span>−{gbp(savings)}</span></div>}
            <div className="flex justify-between"><span>Delivery</span><span>{qtyTotal >= 10 ? "FREE" : gbp(deliveryFee)}</span></div>
            {totalsWithGift.discount > 0 && <div className="flex justify-between text-emerald-600"><span>{normalizedGiftCode} (10% off)</span><span>−{gbp(totalsWithGift.discount)}</span></div>}
            <div className="flex justify-between font-bold text-slate-900 text-base pt-1"><span>Total due</span><span>{gbp(total)}</span></div>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <button disabled={sending} onClick={startCheckout} className="sm:w-90 h-12 rounded-2xl px-1 text-sm font-semibold text-white bg-[#635BFF] hover:bg-[#5147ff] transition flex items-center justify-center disabled:opacity-60">
          <img src="/stripe_logo.png" alt="Stripe" className="h-14" />
          <span className="text-white mr-2">·</span>
          <span>{sending ? "Processing…" : isSubscription ? "Subscribe" : `Pay ${gbp(total)}`}</span>
        </button>
        <a href="/shop" className="sm:w-90 h-12 rounded-2xl border border-slate-300 px-1 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition flex items-center justify-center">Cancel</a>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">🔒 Secure checkout · payments processed by Stripe</p>
    </div>
  );
}