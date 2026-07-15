import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { cart as cartStore } from "../stores/cart";
import { sendCAPIEvent, newEventId } from "../capi";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const PRODUCTS = [
  { id: "PLN", name: "PLN", price: 2.8, size: "250 mL" },
  { id: "BFC", name: "BFC", price: 2.9, size: "250 mL" },
  { id: "STR", name: "STR", price: 2.9, size: "250 mL" },
  { id: "MNG", name: "MNG", price: 2.9, size: "250 mL" },
];

function computeTotals(cart: Record<string, number>, discountPercent = 0, giftStrQty = 0) {
  const items = Object.entries(cart).map(([id, qty]) => {
    const p = PRODUCTS.find((x) => x.id === id);
    return p ? { ...p, qty } : null;
  }).filter(Boolean) as Array<(typeof PRODUCTS)[number] & { qty: number }>;
  const qtyTotal = items.reduce((s, i) => s + i.qty, 0) + (giftStrQty || 0);
  const plainItems = items.filter((i) => i.id === "PLN");
  const flavItems = items.filter((i) => i.id !== "PLN");
  const plainQty = plainItems.reduce((s, i) => s + i.qty, 0);
  const flavQty = flavItems.reduce((s, i) => s + i.qty, 0);
  const plainUnit = plainItems[0]?.price ?? 2.8;
  const flavUnit = flavItems[0]?.price ?? 2.9;
  const plainSubtotalRaw = plainQty * plainUnit;
  const flavSubtotalRaw = flavQty * flavUnit;
  const plainBundles = Math.floor(plainQty / 7);
  const plainRemainder = plainQty % 7;
  const plainBundleTotal = plainBundles * 6 * plainUnit + plainRemainder * plainUnit;
  const flavBundles = Math.floor(flavQty / 7);
  const flavRemainder = flavQty % 7;
  const flavBundleTotal = flavBundles * 6 * flavUnit + flavRemainder * flavUnit;
  const merchTotal = plainBundleTotal + flavBundleTotal;
  const fullPrice = plainSubtotalRaw + flavSubtotalRaw;
  const savings = Math.max(0, fullPrice - merchTotal);
  const deliveryFee = merchTotal === 0 ? 0 : 4.95;
  const discount = discountPercent > 0 ? Math.round(merchTotal * discountPercent) / 100 : 0;
  const total = merchTotal - discount + deliveryFee;
  return { items, qtyTotal, total, savings, merchTotal, deliveryFee, plainBundles, flavBundles, plainRemainder, flavRemainder, discount };
}

const SUBSCRIPTION_PLANS = [
  { key: "PLN", label: "PLN", priceLabel: "£15.12", wasLabel: "£16.80" },
  { key: "BFC", label: "BFC", priceLabel: "£15.66", wasLabel: "£17.40" },
  { key: "STR", label: "STR", priceLabel: "£15.66", wasLabel: "£17.40" },
  { key: "MNG", label: "MNG", priceLabel: "£15.66", wasLabel: "£17.40" },
  { key: "MIX", label: "MIX", priceLabel: "£15.66", wasLabel: "£17.40" },
] as const;
type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

// date helpers
function toISODate(d: Date) { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; }
function formatDateUK(iso: string) { if(!iso||!/^\d{4}-\d{2}-\d{2}$/.test(iso))return iso||""; const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; }
function weekdayFromISO(iso: string) { const [y,m,d]=iso.split("-").map(Number); const date=new Date(y,m-1,d); return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][date.getDay()]; }
function nextDispatchISO(): string { const d=new Date(); d.setHours(0,0,0,0); const day=d.getDay(); const target=day>=3&&day<=6?1:4; let add=(target-day+7)%7; if(add===0)add=7; d.setDate(d.getDate()+add); return toISODate(d); }
function nextEligibleMondayISO(): string { const now=new Date(); const d=new Date(now); d.setHours(0,0,0,0); const day=d.getDay(); let u=(8-day)%7; if(u===0)u=7; d.setDate(d.getDate()+u); const cutoff=new Date(d); cutoff.setDate(d.getDate()-2); cutoff.setHours(21,0,0,0); if(now.getTime()>=cutoff.getTime())d.setDate(d.getDate()+7); return toISODate(d); }

export default function Checkout() {
  const $cart = useStore(cartStore);
  const cart = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries($cart)) m[k] = Number(v || 0);
    return m;
  }, [$cart]);

  // Read mode + plan from URL
  const [mode, setMode] = useState<"oneoff" | "subscription">("oneoff");
  const [subscriptionPlan, setSubscriptionPlan] = useState<SubscriptionPlan | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "subscription") {
      setMode("subscription");
      const planKey = params.get("plan") || "PLN";
      setSubscriptionPlan(SUBSCRIPTION_PLANS.find((p) => p.key === planKey) || SUBSCRIPTION_PLANS[0]);
    }
  }, []);

  const isSubscription = mode === "subscription" && !!subscriptionPlan;
  const firstISO = nextEligibleMondayISO();
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
  const { qtyTotal, total, savings, plainBundles, flavBundles, plainRemainder, flavRemainder, deliveryFee } = totalsWithGift;

  const lines = Object.entries(cart).map(([id, qty]) => {
    const p = PRODUCTS.find((p) => p.id === id);
    return `${p?.name ?? id} × ${qty}`;
  });
  if (discountPercent > 0) lines.push(`10% discount applied (${normalizedGiftCode})`);
  if (giftStrQty > 0) lines.push(`STR × 1 (FREE — ${normalizedGiftCode})`);

  const normalizedPostcode = postcode.trim().toUpperCase();
  const fullAddress = [streetAddress.trim(), townCity.trim(), normalizedPostcode].filter(Boolean).join(", ");
  const valid = isSubscription ? true : (qtyTotal > 0 && !!date);

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
      ? { value: Number(String(subscriptionPlan?.priceLabel || "").replace(/[^\d.]/g, "")) || 0, currency: "GBP", num_items: 7 }
      : { value: total, currency: "GBP", num_items: qtyTotal };
    if ((window as any).fbq) {
      (window as any).fbq("track", "InitiateCheckout", data, { eventID: eventId });
    }
    sendCAPIEvent("InitiateCheckout", { eventId, customData: data });
    setIcFired(true);
  }, [mounted, icFired, isSubscription, subscriptionPlan, total, qtyTotal]);

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
    if (isSubscription && !subscriptionPlan) { setError("Please choose a subscription plan."); return; }
    setSending(true); setError("");
    try {
      const customer = { name, email, phone, address: fullAddress };
      if (isSubscription && subscriptionPlan) {
        const draft = { kind:"subscription", plan:subscriptionPlan, customer, note, first_delivery_iso:firstISO, first_delivery_text:firstText, delivery_window:"18:30–20:00", savedAt:Date.now(), provider:"stripe_sub" };
        sessionStorage.setItem("yoy_checkout_draft", JSON.stringify(draft));
        const res = await fetch("/api/stripe/create-subscription-session", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ planKey: subscriptionPlan.key, customer, note }) });
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

      {isSubscription && subscriptionPlan ? (
        <div className="mt-3 ml-3 text-sm text-slate-700">
          <p>
            You're subscribing to <span className="font-semibold">{subscriptionPlan.label}</span>, 7 bottles every week at a 10% discount. The weekly delivery charge is <span className="font-semibold">£4.95</span>.
          </p>
          <p className="mt-3">
            First dispatch: <span className="font-semibold">{firstText}</span>, then every following Monday.
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
        </div>
      )}

      <div className="mt-6">
        <input value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Order note (optional)" className={inputCls} />
      </div>

      {!isSubscription && (
        <div className="mt-4">
          <div className="flex gap-2">
            <input value={giftCode} onChange={(e)=>setGiftCode(e.target.value)} placeholder="Strawberry promo code" className={cn(inputCls, "flex-1")} />
            {discountPercent > 0 ? (
              <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold flex items-center">Applied: 10% off</div>
            ) : giftStrQty > 0 ? (
              <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold flex items-center">Applied: +1 free STR</div>
            ) : (
              <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-400 text-sm flex items-center">Not applied</div>
            )}
          </div>
          <p className="mt-2 ml-3 text-xs text-slate-500">Have a one-time discount code? Apply it at the secure checkout on the next step.</p>
        </div>
      )}

      {!isSubscription && qtyTotal > 0 && (
        <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 p-5 text-sm text-slate-700">
          <div className="font-semibold text-slate-900 mb-3">Order summary</div>
          <div className="space-y-1">{lines.map((l,i)=>(<div key={i}>• {l}</div>))}</div>
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
            <div className="flex justify-between"><span>Bottles</span><span>{qtyTotal}</span></div>
            {deliveryFee > 0 && <div className="flex justify-between"><span>Delivery</span><span>{gbp(deliveryFee)}</span></div>}
            {totalsWithGift.discount > 0 && <div className="flex justify-between text-emerald-600"><span>{normalizedGiftCode} (10% off)</span><span>−{gbp(totalsWithGift.discount)}</span></div>}
            {savings > 0 && <div className="flex justify-between text-emerald-600"><span>Bundle saving</span><span>−{gbp(savings)}</span></div>}
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