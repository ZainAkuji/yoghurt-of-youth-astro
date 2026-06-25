import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import {
  cart as cartStore,
  setQty as storeSetQty,
  addQty as storeAddQty,
  clearCart as storeClear,
  getQty as storeGetQty,
  drawerOpen as drawerOpenStore,
} from "../stores/cart";
import { sendCAPIEvent, newEventId } from "../capi";

// ---------- Utils ----------
const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const PRODUCTS = [
  { id: "PLN", name: "PLN", price: 2.8, size: "250 mL", img: "/plain.webp" },
  { id: "BFC", name: "BFC", price: 2.9, size: "250 mL", img: "/bfc.webp" },
  { id: "STR", name: "STR", price: 2.9, size: "250 mL", img: "/str.webp" },
  { id: "MNG", name: "MNG", price: 2.9, size: "250 mL", img: "/mng.webp" },
];

// ===================== TOTALS =====================
function computeTotals(
  cart: Record<string, number>,
  discountPercent: number = 0,
  giftStrQty: number = 0
) {
  const items = Object.entries(cart)
    .map(([id, qty]) => {
      const product = PRODUCTS.find((p) => p.id === id);
      if (!product) return null;
      return { ...product, qty };
    })
    .filter(Boolean) as Array<(typeof PRODUCTS)[number] & { qty: number }>;

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

  const bundles = plainBundles + flavBundles;
  const remainder = plainRemainder + flavRemainder;

  return {
    items, qtyTotal, bundles, remainder,
    total, savings, plainSubtotal: fullPrice, merchTotal, deliveryFee,
    plainQty, flavQty, plainBundles, flavBundles, plainRemainder, flavRemainder,
    discount, discountPercent, giftStrQty,
  };
}

// ===================== WEEK ROTATION =====================
function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((+d - +yearStart + 1) / 86400000) / 7);
}
function getBrandRotation() {
  const week = getISOWeek(new Date());
  const isSPCTRLWeek = week % 2 === 0;
  return {
    isSPCTRLWeek,
    thisWeekBrand: isSPCTRLWeek ? "SPCTRL" : "PRCXN",
    nextWeekBrand: isSPCTRLWeek ? "PRCXN" : "SPCTRL",
  };
}

// ===================== DATE HELPERS =====================
function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
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
function nextDispatchISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const target = day >= 3 && day <= 6 ? 1 : 4;
  let add = (target - day + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  return toISODate(d);
}
function nextEligibleMondayISO(): string {
  const now = new Date();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  let daysUntilMonday = (8 - day) % 7;
  if (daysUntilMonday === 0) daysUntilMonday = 7;
  d.setDate(d.getDate() + daysUntilMonday);
  const cutoff = new Date(d);
  cutoff.setDate(d.getDate() - 2);
  cutoff.setHours(21, 0, 0, 0);
  if (now.getTime() >= cutoff.getTime()) d.setDate(d.getDate() + 7);
  return toISODate(d);
}

const SUBSCRIPTION_PLANS = [
  { key: "PLN", label: "PLN", priceLabel: "£15.12", wasLabel: "£16.80", bg: "bg-white/15" },
  { key: "BFC", label: "BFC", priceLabel: "£15.66", wasLabel: "£17.40", bg: "bg-rose-900/40" },
  { key: "STR", label: "STR", priceLabel: "£15.66", wasLabel: "£17.40", bg: "bg-pink-500/35" },
  { key: "MNG", label: "MNG", priceLabel: "£15.66", wasLabel: "£17.40", bg: "bg-amber-300/45" },
  { key: "MIX", label: "MIX", priceLabel: "£15.66", wasLabel: "£17.40", bg: "MIX_STRIPES" },
] as const;
type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

type ConfirmOrder = {
  orderId?: string; formattedDate: string; deliveryWindow: string; lines: string[];
  qtyTotal: number; plainQty: number; flavQty: number; totalText: string;
  address: string; name: string; paymentMethod: string;
};

// ===================== MAIN SHOP ISLAND =====================
export default function Shop() {
  const $cart = useStore(cartStore);
  const cart = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries($cart)) m[k] = Number(v || 0);
    return m;
  }, [$cart]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [nutritionModal, setNutritionModal] = useState<null | { title: string; src: string }>(null);
  const [displayQty, setDisplayQty] = useState<Record<string, number>>({});
  const [payMode, setPayMode] = useState<"checkout" | "subscription">("checkout");
  const [payKind, setPayKind] = useState<"oneoff" | "subscription">("oneoff");
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);

  // Auto-open the drawer if arriving via /shop?cart=open
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cart") === "open") {
      setDrawerOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("cart");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // Open the drawer when the header signals it (in-page, no navigation)
  const $drawerSignal = useStore(drawerOpenStore);
  useEffect(() => {
    if ($drawerSignal) {
      setDrawerOpen(true);
      drawerOpenStore.set(false); // reset so it can fire again next click
    }
  }, [$drawerSignal]);

  // Re-open the checkout modal if returning from a cancelled Stripe session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("pay") !== "cancel") return;
    const raw = sessionStorage.getItem("yoy_checkout_draft");
    let nextPayKind: "oneoff" | "subscription" = "oneoff";
    let nextSelectedPlan: any = null;
    if (raw) {
      try {
        const draft = JSON.parse(raw);
        if (draft?.kind === "subscription" && draft?.plan) {
          nextPayKind = "subscription";
          nextSelectedPlan = draft.plan;
        }
      } catch {}
    }
    setPayKind(nextPayKind);
    setSelectedPlan(nextSelectedPlan);
    setPayMode("checkout");
    setReserveOpen(true);
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState({}, "", url.toString());
  }, []);

  const totals = computeTotals(cart);
  const {
    items, qtyTotal, bundles, remainder, total, savings,
    plainBundles, flavBundles, plainRemainder, flavRemainder,
    merchTotal, deliveryFee, plainQty, flavQty,
  } = totals;

  function trackAddToCart(contentName: string, value: number, numItems: number) {
    const eventId = newEventId();
    const data = { content_name: contentName, content_type: "product", value, currency: "GBP", num_items: numItems };
    if (typeof window !== "undefined" && (window as any).fbq) {
      (window as any).fbq("track", "AddToCart", data, { eventID: eventId });
    }
    sendCAPIEvent("AddToCart", { eventId, customData: data });
  }

  const add = (id: string) => storeAddQty(id, 1);
  const sub = (id: string) => storeAddQty(id, -1);
  const clear = () => { storeClear(); setDisplayQty({}); };

  function openCheckout() {
    setDrawerOpen(false);
    setPayMode("checkout");
    setPayKind("oneoff");
    setSelectedPlan(null);
    setReserveOpen(true);
  }

  const { thisWeekBrand, nextWeekBrand } = getBrandRotation();
  const ids = { PLN: "PLN", BFC: "BFC", STR: "STR", MNG: "MNG" };
  const qty = (id: string) => cart[id] || 0;
  const totalPlain = qty(ids.PLN);
  const totalFlavoured = qty(ids.BFC) + qty(ids.STR) + qty(ids.MNG);
  const plainOnBundle = totalPlain >= 7;
  const flavOnBundle = totalFlavoured >= 7;

  function bumpDisplay(id: string, delta: number) {
    setDisplayQty((d) => {
      const next = { ...d };
      const v = (next[id] || 0) + delta;
      if (v <= 0) delete next[id];
      else next[id] = v;
      return next;
    });
  }
  function decPreset(kind: "TASTER" | "MIX") {
    if (kind === "TASTER") { storeAddQty("PLN", -1); storeAddQty("BFC", -1); storeAddQty("STR", -1); storeAddQty("MNG", -1); }
    else { storeAddQty("BFC", -2); storeAddQty("STR", -3); storeAddQty("MNG", -2); }
    bumpDisplay(kind, -1);
  }
  function incPreset(kind: "TASTER" | "MIX") {
    if (kind === "TASTER") { storeAddQty("PLN", 1); storeAddQty("BFC", 1); storeAddQty("STR", 1); storeAddQty("MNG", 1); }
    else { storeAddQty("BFC", 2); storeAddQty("STR", 3); storeAddQty("MNG", 2); }
    bumpDisplay(kind, 1);
  }

  return (
    <>
      {/* ===================== PART 1: FLAVOUR SELECTOR ===================== */}
      <section
        id="flavours"
        className="scroll-mt-32 md:scroll-mt-24 w-full py-12 relative text-white"
        style={{
          backgroundImage: "linear-gradient(rgba(0,0,0,0.65), rgba(0,0,0,0.65)), url('/flavour_bg.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4 ml-4">Flavour Selection · <span className="text-amber-300">{thisWeekBrand}</span></h2>

          <div className="bg-black/40 rounded-2xl border border-white/10 p-3 sm:p-4 backdrop-blur-sm text-sm sm:text-base text-white max-w-5xl space-y-1">
            <p>This week is <strong>{thisWeekBrand}</strong> week, and next week is <strong>{nextWeekBrand}</strong> week.</p>
            <p>UK-wide next-day delivery available for <strong>£4.95</strong>.</p>
            <p>We dispatch on <strong>Mondays</strong> and <strong>Thursdays</strong> only.</p>
            <p>We ferment the yoghurt the day before dispatch and pack the order in <strong>insulated</strong> and <strong>❄️chilled packaging❄️</strong>, so it reaches you cold and fresh.</p>
            <p className="text-sm sm:text-base">
              Curious how it works? <strong><a href="/about" className="underline hover:text-amber-300 transition">Read the science behind our strains</a></strong>.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <a
                href="https://g.page/r/CWkxtud6iKYlEAE/review"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black/40 border border-white/15 px-3 py-2 backdrop-blur-sm hover:bg-black/55 transition-colors"
              >
                <span className="text-md text-amber-300 leading-none">★★★★★</span>
                <span className="text-md font-semibold text-white">
                  5.0 on{" "}
                  <span className="text-[#4285F4]">G</span><span className="text-[#EA4335]">o</span><span className="text-[#FBBC05]">o</span><span className="text-[#4285F4]">g</span><span className="text-[#34A853]">l</span><span className="text-[#EA4335]">e</span>
                </span>
              </a>
              <span className="inline-flex items-center rounded-full bg-black/40 border border-white/15 px-3 py-2 text-md font-semibold text-white backdrop-blur-sm">1 trillion CFU</span>
              <span className="inline-flex items-center rounded-full bg-black/40 border border-white/15 px-3 py-2 text-md font-semibold text-white backdrop-blur-sm">Lactose-free</span>
              <span className="inline-flex items-center rounded-full bg-black/40 border border-white/15 px-3 py-2 text-md font-semibold text-white backdrop-blur-sm">No added sweeteners</span>
            </div>
          </div>

          <div className="mt-6 bg-black/40 rounded-2xl border border-white/10 p-3 sm:p-4 backdrop-blur-sm">
            <div className="text-sm sm:text-base text-white max-w-4xl space-y-1.5">
              <p>Browse our selection:</p>
              <ul className="list-disc list-inside">
                <li>🥛 <strong>PLN</strong> plain</li>
                <li>🍫 <strong>BFC</strong> black forest chocolate</li>
                <li>🍓 <strong>STR</strong> strawberry</li>
                <li>🥭 <strong>MNG</strong> mango</li>
              </ul>
              <p><strong>Taster</strong> consists of 1 of each flavour.</p>
              <p>Each flavour option consists of <strong>7 bottles</strong>.</p>
              <p><strong>Mixed</strong> consists of <strong>2 BFC</strong>, <strong>3 STR</strong>, and <strong>2 MNG</strong>.</p>
              <p>Click on a flavour header to view the nutrition information.</p>
              <p>Click on the <strong>basket icon</strong> on the top right to complete your purchase.</p>
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-px text-sm text-white">
              {[
                { id: "TASTER", label: "Taster", bg: "TASTER_STRIPES" as const, price: "£11.50" },
                { id: ids.PLN, label: "PLN", bg: "bg-white/15", nutritionSrc: "/pln_nutrition.png", price: "£16.80" },
                { id: ids.BFC, label: "BFC", bg: "bg-rose-900/40", nutritionSrc: "/bfc_nutrition.png", price: "£17.40" },
                { id: ids.STR, label: "STR", bg: "bg-pink-500/35", nutritionSrc: "/str_nutrition.png", price: "£17.40" },
                { id: ids.MNG, label: "MNG", bg: "bg-amber-300/45", nutritionSrc: "/mng_nutrition.png", price: "£17.40" },
                { id: "MIX", label: "MIX", bg: "MIX_STRIPES" as const, price: "£17.40" },
              ].map((f) => {
                const isPreset = f.id === "TASTER" || f.id === "MIX";
                const isMix = f.bg === "MIX_STRIPES";
                const isTaster = f.bg === "TASTER_STRIPES";
                return (
                  <div key={f.id} className="grid grid-rows-[auto,auto] gap-px">
                    <div className="grid grid-cols-3">
                      {isPreset ? (
                        <div className="col-span-2 bg-black/70 px-2 py-1.5 font-semibold text-center">{f.label}</div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setNutritionModal({ title: `${f.label} – Nutrition`, src: (f as any).nutritionSrc })}
                          className="col-span-2 bg-black/70 px-2 py-1.5 font-semibold text-center hover:bg-black/50 hover:text-amber-300 transition-colors"
                        >
                          {f.label}
                        </button>
                      )}
                      <div className="col-span-1 bg-slate-700 px-1 py-1.5 text-sm font-semibold text-center text-white flex items-center justify-center">
                        {f.price}
                      </div>
                    </div>
                    <div className={cn("relative px-2 py-2 flex items-center justify-center gap-2", !isMix && !isTaster && (f as any).bg)}>
                      {isMix && (
                        <>
                          <div className="absolute inset-0 grid grid-cols-3">
                            <div className="bg-rose-900/40" /><div className="bg-pink-500/35" /><div className="bg-amber-300/45" />
                          </div>
                          <div className="absolute inset-0 bg-black/25" />
                        </>
                      )}
                      {isTaster && (
                        <>
                          <div className="absolute inset-0 grid grid-cols-4">
                            <div className="bg-white/15" /><div className="bg-rose-900/40" /><div className="bg-pink-500/35" /><div className="bg-amber-300/45" />
                          </div>
                          <div className="absolute inset-0 bg-black/25" />
                        </>
                      )}
                      <button
                        onClick={() => {
                          if (f.id === "TASTER") return decPreset("TASTER");
                          if (f.id === "MIX") return decPreset("MIX");
                          if (f.id === ids.PLN || f.id === ids.BFC || f.id === ids.STR || f.id === ids.MNG) {
                            const cur = qty(f.id);
                            if (cur > 0) { storeSetQty(f.id, Math.max(0, cur - 7)); bumpDisplay(f.id, -1); }
                            return;
                          }
                          return sub(f.id);
                        }}
                        className="relative z-10 w-5 h-5 sm:w-6 sm:h-6 grid place-items-center rounded-lg bg-black/30 text-white hover:bg-black/40 transition leading-none"
                        aria-label="Remove one"
                      >
                        <span className="translate-y-[-1px] text-sm font-semibold">−</span>
                      </button>
                      <span className="relative z-10 w-6 text-center text-sm font-semibold qty-flash">{displayQty[f.id] || 0}</span>
                      <button
                        onClick={() => {
                          if (f.id === ids.PLN) { storeSetQty(ids.PLN, qty(ids.PLN) + 7); bumpDisplay(f.id, 1); trackAddToCart("PLN", 7 * 2.8, 7); return; }
                          if (f.id === ids.BFC) { storeSetQty(ids.BFC, qty(ids.BFC) + 7); bumpDisplay(f.id, 1); trackAddToCart("BFC", 7 * 2.9, 7); return; }
                          if (f.id === ids.STR) { storeSetQty(ids.STR, qty(ids.STR) + 7); bumpDisplay(f.id, 1); trackAddToCart("STR", 7 * 2.9, 7); return; }
                          if (f.id === ids.MNG) { storeSetQty(ids.MNG, qty(ids.MNG) + 7); bumpDisplay(f.id, 1); trackAddToCart("MNG", 7 * 2.9, 7); return; }
                          if (f.id === "TASTER") { incPreset("TASTER"); trackAddToCart("Taster", 2.8 + 2.9 * 3, 4); return; }
                          if (f.id === "MIX") { incPreset("MIX"); trackAddToCart("Mixed", 2.9 * 7, 7); return; }
                        }}
                        className="relative z-10 w-5 h-5 sm:w-6 sm:h-6 grid place-items-center rounded-lg bg-white text-slate-900 hover:bg-slate-200 transition leading-none"
                        aria-label="Add"
                      >
                        <span className="translate-y-[-1px] text-sm font-semibold">+</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-2 text-xs text-white space-y-1.5">
              <p className="flex flex-wrap items-center gap-2">
                <span>PLN: <strong>£2.80</strong> each · <strong>7 for 6</strong></span>
                {totalPlain > 0 ? (
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs shadow-md backdrop-blur-md", plainOnBundle ? "bg-emerald-500/80 text-slate-900" : "bg-black/60 text-white")}>
                    In basket:&nbsp;<strong>{totalPlain}</strong>
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-black/60 px-2.5 py-0.5 text-xs shadow-md backdrop-blur-md invisible">In basket:&nbsp;<strong>0</strong></span>
                )}
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <span>BFC, STR &amp; MNG: <strong>£2.90</strong> each · <strong>7 for 6</strong></span>
                {totalFlavoured > 0 ? (
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs shadow-md backdrop-blur-md", flavOnBundle ? "bg-emerald-500/80 text-slate-900" : "bg-black/60 text-white")}>
                    In basket:&nbsp;<strong>{totalFlavoured}</strong>
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-black/60 px-2.5 py-0.5 text-xs shadow-md backdrop-blur-md invisible">In basket:&nbsp;<strong>0</strong></span>
                )}
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <span>Chilled Next Day Delivery charge of <strong>£4.95</strong></span>
              </p>
            </div>
          </div>

          {/* ===================== PART 3: WEEKLY GUT PUNCH ===================== */}
          <div className="mt-8 bg-black/40 rounded-2xl border border-white/10 p-3 sm:p-4 backdrop-blur-sm">
            <h3 className="text-xl sm:text-2xl font-bold mb-2">Weekly Gut Punch · Subscribe and Save <span className="text-amber-300">10%</span></h3>
            <div className="text-sm sm:text-base text-white max-w-4xl space-y-1.5">
              <p>Receive <strong>7 bottles of yoghurt every week</strong> at a <strong>10% discount</strong>, fermented the day before dispatch for freshness.</p>
              <p>Your first batch will be dispatched on the coming <strong>available Monday</strong>. Book by <strong>Saturday evening</strong> for the <strong>coming Monday</strong>.</p>
              <p>You will be charged <strong>every week</strong> on the day of dispatch. Pause or cancel anytime by emailing <a href="mailto:support@yoghurtofyouth.co.uk" className="underline hover:text-slate-900">support@yoghurtofyouth.co.uk</a>.</p>
              <p>We alternate between <strong>PRCXN</strong> and <strong>SPCTRL</strong> yoghurt variants every week.</p>
              <p>Tap a plan below to subscribe.</p>
            </div>
            <div className="mt-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-px text-sm text-white">
                {SUBSCRIPTION_PLANS.map((p) => {
                  const isMix = p.bg === "MIX_STRIPES";
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => { setSelectedPlan(p); setPayKind("subscription"); setReserveOpen(true); }}
                      className="text-left grid grid-rows-[auto,auto] gap-px focus:outline-none"
                    >
                      <div className="bg-black/70 px-2 py-1.5 font-semibold text-center">{p.label}</div>
                      <div className={cn("relative px-2 py-3 flex items-center justify-center font-semibold transition-all duration-200 ease-out hover:brightness-125 active:brightness-150 hover:ring-1 hover:ring-white/30 active:ring-white/45", !isMix && (p.key === "PLN" ? "bg-white/15 hover:bg-white/20 active:bg-white/25" : p.bg))}>
                        {isMix && (<div className="absolute inset-0 grid grid-cols-3"><div className="bg-rose-900/40" /><div className="bg-pink-500/35" /><div className="bg-amber-300/45" /></div>)}
                        {isMix && <div className="absolute inset-0 bg-black/25" />}
                        <span className="relative z-10 flex items-baseline gap-1.5">
                          <span className="text-white/70 line-through text-xs">{p.wasLabel}</span>
                          <span>{p.priceLabel}</span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-white leading-relaxed"><strong>MIX</strong> contains 2 BFC, 3 STR, and 2 MNG</p>
              <p className="mt-2 text-xs text-white leading-relaxed">Standard weekly delivery charge of <strong>£4.95</strong></p>
            </div>
          </div>
        </div>
      </section>

      {nutritionModal && (
        <Modal title={nutritionModal.title} onClose={() => setNutritionModal(null)}>
          <img src={nutritionModal.src} alt={nutritionModal.title} className="w-full rounded-xl border border-white/15" />
        </Modal>
      )}

      {/* ===================== PART 2: CART DRAWER ===================== */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Your Basket">
        <Basket
          items={items} qtyTotal={qtyTotal} total={total} savings={savings}
          plainBundles={plainBundles} flavBundles={flavBundles}
          plainRemainder={plainRemainder} flavRemainder={flavRemainder}
          merchTotal={merchTotal} clear={clear}
          onReserve={() => {
            const eventId = newEventId();
            const data = { value: total, currency: "GBP", num_items: qtyTotal };
            if (typeof window !== "undefined" && (window as any).fbq) {
              (window as any).fbq("track", "InitiateCheckout", data, { eventID: eventId });
            }
            sendCAPIEvent("InitiateCheckout", { eventId, customData: data });
            openCheckout();
          }}
        />
      </Drawer>

      {/* ===================== PART 4: CHECKOUT MODAL ===================== */}
      {reserveOpen && (
        <PayModal
          onClose={() => { setReserveOpen(false); setPayMode("checkout"); setPayKind("oneoff"); setSelectedPlan(null); }}
          cart={cart}
          payKind={payKind}
          subscriptionPlan={selectedPlan}
        />
      )}
    </>
  );
}

// ===================== DRAWER =====================
function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div aria-hidden={!open} className={cn("fixed inset-0 z-50 transition-all duration-500", open ? "" : "pointer-events-none")}>
      <div onClick={onClose} className={cn("absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-500", open ? "opacity-100" : "opacity-0")} />
      <aside className={cn("absolute right-0 top-0 h-full w-full max-w-md backdrop-blur-sm text-white shadow-2xl border-l border-white/10 p-6 transition-transform duration-500 ease-in-out", open ? "translate-x-0" : "translate-x-full")} style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-full w-8 h-8 grid place-items-center hover:bg-white/10 transition">✕</button>
        </div>
        <div className="mt-4 text-white overflow-y-auto max-h-[calc(100%-5rem)] pr-2">{children}</div>
      </aside>
    </div>
  );
}

const FLAVOUR_STYLE: Record<string, { bg: string; emoji: string }> = {
  PLN: { bg: "bg-white/15", emoji: "🥛" },
  BFC: { bg: "bg-rose-900/40", emoji: "🍫" },
  STR: { bg: "bg-pink-500/35", emoji: "🍓" },
  MNG: { bg: "bg-amber-300/45", emoji: "🥭" },
};

// ===================== BASKET =====================
function Basket({ items, qtyTotal, total, savings, plainBundles, flavBundles, plainRemainder, flavRemainder, merchTotal, clear, onReserve }: any) {
  return (
    <div className="space-y-4 text-white">
      {items.length === 0 && <p className="text-sm text-white/60">Your basket is empty.</p>}
      {items.map((i: any) => (
        <div key={i.id} className="flex gap-3">
          <div className={cn("w-16 h-12 rounded-lg ring-1 ring-white/20 flex items-center justify-center text-2xl", FLAVOUR_STYLE[i.id]?.bg || "bg-black/30")}>
            <span>{FLAVOUR_STYLE[i.id]?.emoji || "❓"}</span>
          </div>
          <div className="flex-1">
            <div className="flex justify-between text-sm">
              <div>
                <div className="font-medium text-white">{i.name}</div>
                <div className="text-white/60">{i.size}</div>
              </div>
              <div className="font-medium text-white/90">£{(i.qty * i.price).toFixed(2)}</div>
            </div>
            <div className="mt-2 flex items-center gap-2"><span className="w-8 text-sm">{i.qty}</span></div>
          </div>
        </div>
      ))}
      <div className="border-t border-white/20 pt-4 space-y-2 text-sm text-white/80">
        <div className="flex justify-between"><span>Bottles</span><span>{qtyTotal}</span></div>
        {plainRemainder > 0 && <div className="flex justify-between"><span>PLN</span><span>{plainRemainder} × £2.80</span></div>}
        {plainBundles > 0 && <div className="flex justify-between"><span>Free PLN (7 for 6)</span><span>{plainBundles}</span></div>}
        {flavRemainder > 0 && <div className="flex justify-between"><span>Flavoured</span><span>{flavRemainder} × £2.90</span></div>}
        {flavBundles > 0 && <div className="flex justify-between"><span>Free flavoured (7 for 6)</span><span>{flavBundles}</span></div>}
        {savings > 0 && <div className="flex justify-between text-emerald-400"><span>You save</span><span>−{gbp(savings)}</span></div>}
        <div className="flex justify-between font-semibold text-white"><span>Total due to be paid</span><span>{gbp(merchTotal)}</span></div>
      </div>
      <div className="flex gap-2">
        <button onClick={onReserve} disabled={qtyTotal === 0} className={cn("flex-1 rounded-2xl px-5 py-3 text-sm font-semibold transition", qtyTotal ? "bg-white text-slate-900 hover:bg-amber-300" : "bg-white/10 text-white/40 cursor-not-allowed")}>Pay</button>
        <button onClick={clear} className="rounded-2xl border border-white/30 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10 transition">Clear</button>
      </div>
    </div>
  );
}

// ===================== MODAL =====================
function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-white/20 shadow-2xl p-6 text-white backdrop-blur-sm max-h-[85vh] overflow-y-auto overscroll-contain" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button onClick={onClose} aria-label="Close" className="rounded-full w-8 h-8 grid place-items-center hover:bg-white/10 transition">✕</button>
          </div>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ===================== PAY MODAL (CHECKOUT) =====================
function PayModal({ onClose, cart, payKind = "oneoff", subscriptionPlan }: { onClose: () => void; cart: Record<string, number>; payKind?: "oneoff" | "subscription"; subscriptionPlan?: SubscriptionPlan | null }) {
  const isSubscription = payKind === "subscription" && !!subscriptionPlan;
  const firstISO = nextEligibleMondayISO();
  const firstText = `${formatDateUK(firstISO)} ${weekdayFromISO(firstISO)}`;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [postcode, setPostcode] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [townCity, setTownCity] = useState("");

  const date = nextDispatchISO();
  const formattedDate = formatDateUK(date);
  const deliveryWindow = "18:30–20:00";

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

  function validateBeforePay(): boolean {
    if (!valid) { setError("Please complete all required fields first."); return false; }
    if (isSubscription && !subscriptionPlan) { setError("Please choose a subscription plan."); return false; }
    return true;
  }

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
      const savedAddress = String(draft?.customer?.address || "");
      const parts = savedAddress.split(",").map((p) => p.trim()).filter(Boolean);
      setStreetAddress(parts[0] || "");
      setTownCity(parts[1] || "");
      setPostcode(parts[2] || "");
    } catch {}
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem("yoy_checkout_draft");
    let existing: any = {};
    try { existing = raw ? JSON.parse(raw) : {}; } catch {}
    const updated = { ...existing, customer: { ...(existing.customer || {}), name, email, phone, address: fullAddress }, note, gift_code: giftCode, delivery_method: "delivery" };
    sessionStorage.setItem("yoy_checkout_draft", JSON.stringify(updated));
  }, [name, email, phone, fullAddress, note, giftCode]);

  async function startCheckout() {
    if (!validateBeforePay()) return;
    setSending(true);
    setError("");
    try {
      const customer = { name, email, phone, address: fullAddress };
      if (isSubscription && subscriptionPlan) {
        const draft = { kind: "subscription", plan: subscriptionPlan, customer, note, first_delivery_iso: firstISO, first_delivery_text: firstText, delivery_window: "18:30–20:00", savedAt: Date.now(), provider: "stripe_sub" };
        sessionStorage.setItem("yoy_checkout_draft", JSON.stringify(draft));
        const res = await fetch("/api/stripe/create-subscription-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planKey: subscriptionPlan.key, customer, note }) });
        const text = await res.text(); let data: any = {}; try { data = JSON.parse(text); } catch {}
        if (!res.ok) { setError(data?.error || "Subscription checkout failed (server error)."); return; }
        if (data?.url) window.location.href = data.url; else setError("Stripe subscription checkout failed.");
        return;
      }
      const draft = { cart, totals: totalsWithGift, customer, delivery_method: "delivery", delivery_date_iso: date, delivery_date: formattedDate, delivery_window: deliveryWindow, note, lines, gift_code: normalizedGiftCode, discount_percent: discountPercent, gift_str_qty: giftStrQty, savedAt: Date.now(), provider: "stripe" };
      sessionStorage.setItem("yoy_checkout_draft", JSON.stringify(draft));
      const res = await fetch("/api/stripe/create-checkout-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cart, totals: totalsWithGift, lines, customer, delivery_method: "delivery", delivery_date: formattedDate, delivery_window: deliveryWindow, note, gift_code: normalizedGiftCode, discount_percent: discountPercent, gift_str_qty: giftStrQty }) });
      const text = await res.text(); let data: any = {}; try { data = JSON.parse(text); } catch {}
      if (!res.ok) { setError(data?.error || "Checkout failed (server error)."); return; }
      if (data?.url) window.location.href = data.url; else setError("Stripe checkout failed.");
    } catch (e) {
      setError("Stripe checkout failed.");
    } finally {
      setSending(false);
    }
  }

  // ----- SUBSCRIPTION MODE -----
  if (isSubscription && subscriptionPlan) {
    return (
      <Modal onClose={onClose} title="Weekly Gut Punch">
        <p className="text-sm text-white">
          You're subscribing to <span className="font-semibold">{subscriptionPlan.label}</span> Weekly Gut Punch. We deliver UK-wide and use DPD Next Day delivery. The weekly delivery charge is <span className="font-semibold">£4.95</span>. Please fill in your contact and delivery details securely on the next step.
        </p>
        <div className="mt-3 pl-3 text-sm text-white/80">
          First dispatch: <span className="font-semibold text-white">{firstText}</span>, then every following <span className="font-semibold text-white">Monday</span>
        </div>
        <div className="mt-2 pl-3 text-sm text-white/80">Fermented fresh the day before · Made in UK</div>
        <div className="mt-4">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Order note (optional)"
            className="w-full rounded-xl border border-white/30 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-white/40"
          />
        </div>
        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <button disabled={sending} onClick={startCheckout} className="sm:w-72 h-12 rounded-2xl px-1 text-sm font-semibold text-white bg-[#635BFF] hover:bg-[#5147ff] transition flex items-center justify-center">
            <img src="/stripe_logo.png" alt="Stripe" className="h-14" />
            <span className="text-white mr-2">|</span>
            <span>{sending ? "Processing…" : "Subscribe"}</span>
          </button>
          <button onClick={onClose} className="sm:w-72 h-12 rounded-2xl border border-white/30 px-1 py-3 text-sm font-semibold text-white hover:bg-white/10 transition">Cancel</button>
        </div>
        <div className="mt-3 text-center">
          <p className="text-xs text-white/50">🔒 Secure checkout · payments processed by Stripe</p>
          <p className="text-amber-300 text-sm mt-1">★★★★★</p>
        </div>
      </Modal>
    );
  }

  // ----- ONE-OFF CHECKOUT MODE -----
  return (
    <Modal onClose={onClose} title="Checkout & Delivery">
      <p className="text-sm text-white/80">Fill in below, then continue to payment, where you will also enter your contact and delivery details. We deliver UK-wide, dispatch every <span className="font-semibold">Monday</span> & <span className="font-semibold">Thursday</span>, and use DPD Next Day delivery.</p>
      <div className="mt-3 pl-3 text-sm text-white/80">
        Dispatch date: <span className="font-semibold text-white">{formatDateUK(date)} {weekdayFromISO(date)}</span>
      </div>
      <div className="mt-2 pl-3 text-sm text-white/80">
        Fermented <strong>fresh</strong> the day before · Made in UK
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Order note (optional)"
        className="mt-4 w-full rounded-xl border border-white/30 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-white/40"
      />
      <div className="mt-4 md:col-span-2">
        <div className="flex gap-2">
          <input value={giftCode} onChange={(e) => setGiftCode(e.target.value)} placeholder="Enter gift code" className="flex-1 rounded-xl border border-white/30 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-white/40" />
          {discountPercent > 0 ? (
            <div className="px-3 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-sm font-semibold">Applied: 10% off</div>
          ) : giftStrQty > 0 ? (
            <div className="px-3 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-sm font-semibold">Applied: +1 free STR</div>
          ) : (
            <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm">Not applied</div>
          )}
        </div>
      </div>
      {qtyTotal > 0 && (
        <div className="mt-4 rounded-2xl bg-black/40 border border-white/15 p-4 text-sm text-white/85">
          <div className="font-semibold mb-2">Summary</div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div>{lines.map((l, i) => (<div key={i}>• {l}</div>))}</div>
            <div>
              <div className="mb-1">Bottles: {qtyTotal}</div>
              {plainRemainder > 0 && <div>PLN: {plainRemainder} × £2.80</div>}
              {plainBundles > 0 && <div>Free PLN (7 for 6): {plainBundles}</div>}
              {flavRemainder > 0 && <div>Flavoured: {flavRemainder} × £2.90</div>}
              {flavBundles > 0 && <div>Free flavoured (7 for 6): {flavBundles}</div>}
              {deliveryFee > 0 && <div className="mt-1">Delivery: {gbp(deliveryFee)}</div>}
              {totalsWithGift.discount > 0 && (<div className="flex justify-between text-emerald-400 mt-1"><span>{normalizedGiftCode} (10% off)</span><span>−{gbp(totalsWithGift.discount)}</span></div>)}
              {savings > 0 && (<div className="flex justify-between text-emerald-400 mt-1"><span>You save</span><span>−{gbp(savings)}</span></div>)}
              <div className="font-semibold mt-1">Total due: {gbp(total)}</div>
            </div>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      <div className="mt-5 flex flex-col sm:flex-row gap-3">
        <button disabled={sending} onClick={startCheckout} className="sm:w-72 h-12 rounded-2xl px-1 text-sm font-semibold text-white bg-[#635BFF] hover:bg-[#5147ff] transition flex items-center justify-center">
          <img src="/stripe_logo.png" alt="Stripe" className="h-14" />
          <span className="text-white mr-2">|</span>
          <span>{sending ? "Processing…" : `Pay ${gbp(total)}`}</span>
        </button>
        <button onClick={onClose} className="sm:w-72 h-12 rounded-2xl border border-white/30 px-1 py-3 text-sm font-semibold text-white hover:bg-white/10 transition">Cancel</button>
      </div>
      <div className="mt-3 text-center">
        <p className="text-xs text-white/50">🔒 Secure checkout · payments processed by Stripe</p>
        <p className="text-amber-300 text-sm mt-1">★★★★★</p>
      </div>
    </Modal>
  );
}