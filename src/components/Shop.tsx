import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import {
  cart as cartStore,
  setQty as storeSetQty,
  addQty as storeAddQty,
  clearCart as storeClear,
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

// ===================== WEEK ROTATION (date-anchored) =====================
// Physical rotation anchor: Monday 13 July 2026 = LVLV.
// Cycle order: PRCXN -> SPCTRL -> LVLV -> (repeat)
const ROTATION = ["PRCXN", "SPCTRL", "LVLV"];

// Strain for a given Monday date, anchored to 13 Jul 2026 = LVLV (index 2).
function strainForMonday(monday: Date): string {
  const anchor = new Date(2026, 6, 13); // 13 July 2026 (month 0-indexed: 6 = July)
  anchor.setHours(0, 0, 0, 0);
  const m = new Date(monday);
  m.setHours(0, 0, 0, 0);
  const weeks = Math.round((m.getTime() - anchor.getTime()) / (7 * 86400000));
  const idx = (((2 + weeks) % 3) + 3) % 3; // anchor is index 2 (LVLV)
  return ROTATION[idx];
}

// The Monday date whose batch an order maps to, per mode.
function mondayForMode(mode: "oneoff" | "subscribe"): Date {
  if (mode === "subscribe") {
    const iso = nextEligibleMondayISO(); // Sat-9pm cutoff logic
    const [y, mo, d] = iso.split("-").map(Number);
    return new Date(y, mo - 1, d);
  }
  // one-off: current Wed-midnight..Wed-midnight window -> the following Monday's batch
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();               // 0 Sun ... 3 Wed
  const daysSinceWed = (day - 3 + 7) % 7;
  const windowStart = new Date(d);
  windowStart.setDate(d.getDate() - daysSinceWed); // most recent Wed 00:00
  const nextMon = new Date(windowStart);
  let toMon = (1 - windowStart.getDay() + 7) % 7;   // Wed -> next Mon = 5
  if (toMon === 0) toMon = 7;
  nextMon.setDate(windowStart.getDate() + toMon);
  return nextMon;
}

function getBrandForMode(mode: "oneoff" | "subscribe"): string {
  return strainForMonday(mondayForMode(mode));
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

// ===================== MAIN SHOP ISLAND =====================
export default function Shop() {
  const $cart = useStore(cartStore);
  const cart = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries($cart)) m[k] = Number(v || 0);
    return m;
  }, [$cart]);

  const [nutritionModal, setNutritionModal] = useState<null | { title: string; src: string }>(null);

  // ----- New two-column selection state -----
  const [buyMode, setBuyMode] = useState<"oneoff" | "subscribe">("subscribe");
  const [selectedFlavour, setSelectedFlavour] = useState<string>("PLN");
  const [unitQty, setUnitQty] = useState<number>(1);
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const [flavourArrowUp, setFlavourArrowUp] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);

  // Live total for the current selection (flavour × unitQty), using real bundle math
  const selectionTotal = useMemo(() => {
    const units = Math.max(1, unitQty);
    const tempCart: Record<string, number> = {};
    for (let u = 0; u < units; u++) {
      if (selectedFlavour === "TASTER") { tempCart.PLN = (tempCart.PLN||0)+1; tempCart.BFC = (tempCart.BFC||0)+1; tempCart.STR = (tempCart.STR||0)+1; tempCart.MNG = (tempCart.MNG||0)+1; }
      else if (selectedFlavour === "MIX") { tempCart.BFC = (tempCart.BFC||0)+2; tempCart.STR = (tempCart.STR||0)+3; tempCart.MNG = (tempCart.MNG||0)+2; }
      else { tempCart[selectedFlavour] = (tempCart[selectedFlavour]||0)+7; }
    }
    return computeTotals(tempCart).merchTotal;
  }, [selectedFlavour, unitQty]);

  // Per-batch price lookup (fixed per-batch, changes with flavour + mode)
  const BATCH_PRICE: Record<string, { oneoff: string; subscribe: string | null; bottles: string }> = {
    TASTER: { oneoff: "£11.50", subscribe: null, bottles: "4 × 250ml" },
    PLN: { oneoff: "£16.80", subscribe: "£15.12", bottles: "7 × 250ml" },
    STR: { oneoff: "£17.40", subscribe: "£15.66", bottles: "7 × 250ml" },
    BFC: { oneoff: "£17.40", subscribe: "£15.66", bottles: "7 × 250ml" },
    MNG: { oneoff: "£17.40", subscribe: "£15.66", bottles: "7 × 250ml" },
    MIX: { oneoff: "£17.40", subscribe: "£15.66", bottles: "7 × 250ml" },
  };

  // Flavour options — Taster excluded in subscribe mode
  const FLAVOUR_OPTIONS = [
    { id: "TASTER", label: "Taster — 1 PLN, 1 BFC, 1 STR, 1 MNG" },
    { id: "PLN", label: "PLN — Plain" },
    { id: "STR", label: "STR — Strawberry" },
    { id: "BFC", label: "BFC — Black Forest Chocolate" },
    { id: "MNG", label: "MNG — Mango" },
    { id: "MIX", label: "MIX — 2 BFC, 3 STR, 2 MNG" },
  ];

  // If switching to subscribe while Taster selected, fall back to PLN
  useEffect(() => {
    if (buyMode === "subscribe" && selectedFlavour === "TASTER") setSelectedFlavour("PLN");
  }, [buyMode, selectedFlavour]);

  // Add the current selection (flavour × unitQty units) to the cart
  function addSelectionToCart() {
    const units = Math.max(1, unitQty);
    for (let u = 0; u < units; u++) {
      if (selectedFlavour === "TASTER") {
        storeAddQty("PLN", 1); storeAddQty("BFC", 1); storeAddQty("STR", 1); storeAddQty("MNG", 1);
      } else if (selectedFlavour === "MIX") {
        storeAddQty("BFC", 2); storeAddQty("STR", 3); storeAddQty("MNG", 2);
      } else {
        storeAddQty(selectedFlavour, 7);
      }
    }
    const priceStr = BATCH_PRICE[selectedFlavour]?.oneoff || "£0";
    const priceNum = Number(priceStr.replace("£", "")) * units;
    const bottleCount = (selectedFlavour === "TASTER" ? 4 : 7) * units;
    trackAddToCart(selectedFlavour, priceNum, bottleCount);
  }

  // Buy now (one-off): add selection then go to checkout page
  function buyNow() {
    if (buyMode === "subscribe") { subscribeNow(); return; }
    addSelectionToCart();
    window.location.href = "/checkout";
  }

  // Subscribe: go to checkout page in subscription mode for the selected flavour
  function subscribeNow() {
    window.location.href = "/checkout?mode=subscription&plan=" + selectedFlavour;
  }

  useEffect(() => {
    if (!nutritionOpen) return;
    const close = () => setNutritionOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [nutritionOpen]);

  function trackAddToCart(contentName: string, value: number, numItems: number) {
    const eventId = newEventId();
    const data = { content_name: contentName, content_type: "product", value, currency: "GBP", num_items: numItems };
    if (typeof window !== "undefined" && (window as any).fbq) {
      (window as any).fbq("track", "AddToCart", data, { eventID: eventId });
    }
    sendCAPIEvent("AddToCart", { eventId, customData: data });
  }

  const thisWeekBrand = getBrandForMode(buyMode);

  return (
    <>
      {/* ===================== PART 1: TWO-COLUMN SHOP ===================== */}
      <section id="flavours" className="scroll-mt-32 md:scroll-mt-24 w-full bg-white text-slate-900 py-12">
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-start">

            {/* ---------- LEFT: week's strain card ---------- */}
            <div className="yoy-shop-card">
              <img
                className="yoy-shop-card-bg"
                src={`/${thisWeekBrand.toLowerCase()}.webp`}
                alt={`${thisWeekBrand} — this week's L. reuteri yoghurt`}
              />
              <div className="yoy-shop-card-overlay"></div>
              <div className="yoy-shop-card-content">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white mb-2">You'll receive</p>
                  <img
                    src={`/${thisWeekBrand.toLowerCase()}_logo.png`}
                    alt={thisWeekBrand}
                    className="yoy-shop-card-logo"
                  />
                </div>
              </div>
            </div>

            {/* ---------- RIGHT: purchase column ---------- */}
            <div className="flex flex-col">
              <h1 className="ml-3 text-2xl sm:text-3xl font-bold text-slate-900">
                Yoghurt of Youth · <span className="text-amber-500">{thisWeekBrand}</span>
              </h1>

              {/* Review line + benefits */}
              <div className="mt-3 ml-3">
                <p className="text-sm text-slate-600">
                  <a href="https://g.page/r/CWkxtud6iKYlEAE/review" target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-800 hover:text-amber-500 transition"><span className="text-lg">★★★★★</span> 5.0 on Google</a>
                  <span className="mx-2 text-slate-800">·</span>
                  100+ satisfied customers
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  100+ billion CFU
                  <span className="mx-2 text-slate-300">·</span>
                  Lactose-free
                  <span className="mx-2 text-slate-300">·</span>
                  No added sweeteners
                </p>
              </div>

              {/* Price line above toggle */}
              <div className="mt-6 ml-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-3xl font-bold text-slate-900">
                    {buyMode === "subscribe" ? BATCH_PRICE[selectedFlavour]?.subscribe : BATCH_PRICE[selectedFlavour]?.oneoff}
                  </span>
                  {buyMode === "subscribe" && (
                    <>
                      <span className="text-lg text-slate-400 line-through">{BATCH_PRICE[selectedFlavour]?.oneoff}</span>
                      <span className="rounded-full bg-slate-900 text-white text-xs font-semibold px-3 py-1">Save 10%</span>
                    </>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">{selectedFlavour === "TASTER" ? "4 × 250ml bottles" : "7 × 250ml bottles"}</p>
              </div>

              {/* Strain description */}
              <p className="mt-4 ml-3 text-sm text-slate-700 leading-relaxed">
                {thisWeekBrand === "PRCXN" && (<>Yoghurt fermented by <em>L. reuteri</em> DSM 17648.<br />Studied for anti-<em>H. pylori</em> properties.<br />Stage 1 in the 3 week rotation.</>)}
                {thisWeekBrand === "SPCTRL" && (<>Yoghurt fermented by <em>L. reuteri</em> DSM 17938.<br />Studied for antipathogenic and anti-<em>Candida</em> properties.<br />Stage 2 in the 3 week rotation.</>)}
                {thisWeekBrand === "LVLV" && (<>Yoghurt fermented by <em>L. reuteri</em> ATCC PTA 6475.<br />Studied for antipathogenic and oxytocin-stimulating properties.<br />Stage 3 in the 3 week rotation.</>)}
              </p>

              {/* Vertical Subscribe / One-time toggle */}
              <div className="mt-5 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setBuyMode("subscribe")}
                  className={cn("text-left rounded-2xl border-2 px-4 py-3 transition", buyMode === "subscribe" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300")}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">Subscribe &amp; Save 10%</span>
                    <span className="text-sm font-bold text-slate-900">{BATCH_PRICE[selectedFlavour]?.subscribe ? `${BATCH_PRICE[selectedFlavour].subscribe} per week` : "—"}</span>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    <li>✓ 10% off every order</li>
                    <li>✓ Dispatched fresh every week</li>
                    <li>✓ Pause or cancel anytime via email</li>
                    <li>✓ Automatically receive each week's strain</li>
                  </ul>
                </button>
                <button
                  type="button"
                  onClick={() => setBuyMode("oneoff")}
                  className={cn("text-left rounded-2xl border-2 px-4 py-3 transition", buyMode === "oneoff" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300")}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">One-time purchase</span>
                    <span className="text-sm font-bold text-slate-900">{BATCH_PRICE[selectedFlavour]?.oneoff} per batch</span>
                  </div>
                </button>
              </div>

              {/* Flavour dropdown */}
              <div className="relative mt-4">
                <select
                  value={selectedFlavour}
                  onMouseDown={() => setFlavourArrowUp(true)}
                  onBlur={() => setFlavourArrowUp(false)}
                  onChange={(e) => { setSelectedFlavour(e.target.value); setFlavourArrowUp(false); }}
                  className="appearance-none w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-amber-400 hover:bg-slate-50 transition"
                >
                  {FLAVOUR_OPTIONS.filter((f) => !(buyMode === "subscribe" && f.id === "TASTER")).map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
                <span className={cn("pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-700 transition-transform", flavourArrowUp ? "rotate-180" : "")}>▾</span>
              </div>

              {/* Nutrition panel toggle */}
              <div className="relative mt-4">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setNutritionOpen((o) => !o); }}
                  className="flex items-center justify-between w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  <span>Ingredients &amp; Nutritional Information</span>
                  <span className={cn("text-slate-500 transition-transform", nutritionOpen ? "rotate-180" : "")}>▾</span>
                </button>
                {nutritionOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                    {[
                      { id: "PLN", label: "PLN — Plain", src: "/pln_nutrition.png" },
                      { id: "BFC", label: "BFC — Black Forest Chocolate", src: "/bfc_nutrition.png" },
                      { id: "STR", label: "STR — Strawberry", src: "/str_nutrition.png" },
                      { id: "MNG", label: "MNG — Mango", src: "/mng_nutrition.png" },
                    ].map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => { setNutritionModal({ title: `${n.label} — Nutrition`, src: n.src }); setNutritionOpen(false); }}
                        className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-amber-600 transition"
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quantity stepper (one-time only) */}
              {buyMode === "oneoff" && (
                <div className="mt-3 ml-3 flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-700">Quantity</span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setUnitQty((q) => Math.max(1, q - 1))} className="w-9 h-9 grid place-items-center rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 transition text-lg leading-none">−</button>
                    <span className="w-8 text-center text-sm font-semibold">{unitQty}</span>
                    <button type="button" onClick={() => setUnitQty((q) => q + 1)} className="w-9 h-9 grid place-items-center rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 transition text-lg leading-none">+</button>
                  </div>
                </div>
              )}

              {/* Delivery line: dispatch date + charge */}
              <p className="mt-4 ml-3 text-sm text-slate-600">
                Dispatch date: <strong>{buyMode === "subscribe" ? `${formatDateUK(nextEligibleMondayISO())} Monday` : `${formatDateUK(nextDispatchISO())} ${weekdayFromISO(nextDispatchISO())}`}</strong>
                <span className="mx-2 text-slate-300">·</span>
                Chilled next-day delivery <strong>£4.95</strong>
              </p>

              {/* Buy buttons */}
              <div className="mt-5 flex flex-col gap-3">
                {buyMode === "subscribe" ? (
                  <button
                    type="button"
                    onClick={subscribeNow}
                    className="w-full rounded-2xl bg-slate-900 text-white px-6 py-3.5 text-sm font-bold hover:bg-slate-700 transition flex items-center justify-center gap-2"
                  >
                    <span>Subscribe</span>
                    <span className="opacity-50">·</span>
                    <span>{BATCH_PRICE[selectedFlavour]?.subscribe} per week</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { addSelectionToCart(); drawerOpenStore.set(true); }}
                      className="w-full rounded-2xl bg-slate-900 text-white px-6 py-3.5 text-sm font-bold hover:bg-slate-700 transition flex items-center justify-center gap-2"
                    >
                      <span>Add to basket</span>
                      <span className="opacity-50">·</span>
                      <span>{gbp(selectionTotal)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={buyNow}
                      className="w-full rounded-2xl bg-amber-400 text-slate-900 px-6 py-3.5 text-sm font-bold hover:bg-amber-300 transition"
                    >
                      Buy now
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ---------- Below columns: SEO intro + info accordions ---------- */}
          <div className="mx-auto max-w-6xl mt-16">
            {/* SEO intro (plain prose, crawlable) */}
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Live L. reuteri probiotic yoghurt, made fresh</h2>
            <p className="mt-3 text-sm text-slate-700 leading-relaxed">
              Yoghurt of Youth is a lactose-free probiotic yoghurt fermented with researched <em>Lactobacillus reuteri</em> strains,
              at over 100 billion live cultures per 250ml bottle. We ferment each batch the day before dispatch and deliver it
              chilled across the UK, so it reaches you fresh, not dried into a capsule. No added sweeteners, ever.
            </p>
            <p className="mt-3 text-sm text-slate-700 leading-relaxed">
              We craft three well-researched strains and rotate them week by week: <strong>PRCXN</strong>, <strong>SPCTRL</strong>,
              and <strong>LVLV</strong>. Each is chosen for a specific role, and together they form a simple, natural way to support
              your gut on a daily basis. <a href="/about" className="underline hover:text-amber-500 transition">Read the science behind our strains.</a>
            </p>

            {/* Info accordions */}
            <div className="mt-8 divide-y divide-slate-200 border-t border-b border-slate-200">
              {[
                {
                  id: "flavours",
                  title: "Flavours & bundles",
                  body: (
                    <>
                      <p>Choose from <strong>PLN</strong> (plain), <strong>BFC</strong> (black forest chocolate), <strong>STR</strong> (strawberry), and <strong>MNG</strong> (mango).</p>
                      <p className="mt-2">Each batch is <strong>7 bottles</strong> of your chosen flavour. <strong>MIX</strong> gives you 2 BFC, 3 STR, and 2 MNG. <strong>Taster</strong> is 1 of each flavour (4 bottles).</p>
                      <p className="mt-2">Buy 7 and pay for 6 , the bundle saving is applied automatically in your basket.</p>
                    </>
                  ),
                },
                {
                  id: "delivery",
                  title: "Delivery & dispatch",
                  body: (
                    <>
                      <p>Chilled next-day delivery across the UK for <strong>£4.95</strong>, sent in insulated, chilled packaging so it arrives cold and fresh.</p>
                      <p className="mt-2">We ferment the day before dispatch and send orders on <strong>Mondays</strong> and <strong>Thursdays</strong> via next-day delivery.</p>
                    </>
                  ),
                },
                {
                  id: "subscription",
                  title: "Weekly subscription",
                  body: (
                    <>
                      <p>Subscribe to receive <strong>7 bottles every week</strong> at a <strong>10% discount</strong>, fermented fresh before each dispatch.</p>
                      <p className="mt-2">Your first batch arrives the coming available <strong>Monday</strong>, then every following Monday. You'll automatically receive each week's rotating strain.</p>
                      <p className="mt-2">Pause or cancel anytime by emailing <a href="mailto:support@yoghurtofyouth.co.uk" className="underline hover:text-amber-500 transition">support@yoghurtofyouth.co.uk</a>.</p>
                    </>
                  ),
                },
              ].map((row) => (
                <div key={row.id}>
                  <button
                    type="button"
                    onClick={() => setOpenAccordion((o) => (o === row.id ? null : row.id))}
                    className="flex items-center justify-between w-full py-4 text-left text-sm font-semibold text-slate-900 hover:text-amber-600 transition"
                  >
                    <span>{row.title}</span>
                    <span className={cn("text-slate-400 transition-transform", openAccordion === row.id ? "rotate-180" : "")}>▾</span>
                  </button>
                  {openAccordion === row.id && (
                    <div className="pb-4 text-sm text-slate-600 leading-relaxed">{row.body}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {nutritionModal && (
        <div className="fixed inset-0 z-50">
          <div onClick={() => setNutritionModal(null)} className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl p-6 text-slate-900 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{nutritionModal.title}</h3>
                <button onClick={() => setNutritionModal(null)} aria-label="Close" className="rounded-full w-8 h-8 grid place-items-center hover:bg-slate-100 transition">✕</button>
              </div>
              <img src={nutritionModal.src} alt={nutritionModal.title} className="mt-3 w-full rounded-xl border border-slate-200" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}