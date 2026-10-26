import { computeTotals, SUB_PRICING, PLAIN_PRICE_PENCE, FLAVOURED_PRICE_PENCE, FREE_DELIVERY_BOTTLES, SMALL_DELIVERY_PENCE, STANDARD_DELIVERY_PENCE } from "../../lib/pricing";
import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import {
  cart as cartStore,
  addQty as storeAddQty,
  drawerOpen as drawerOpenStore,
} from "../stores/cart";
import { sendCAPIEvent, newEventId } from "../capi";
import GoogleReviews, { GoogleReviewSummary, useGoogleReviews } from "./GoogleReviews";
import {
  formatDateUK,
  weekdayFromISO,
  addCalendarDays,
  strainForDispatch,
  dispatchDelayed,
} from "../config/dispatch";
import { useDispatchDate } from "../hooks/useDispatchDate";

// ---------- Utils ----------
const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

// ===================== MAIN SHOP ISLAND =====================
export default function Shop({ initialDispatchISO }: { initialDispatchISO: string }) {
  const $cart = useStore(cartStore);
  const googleReviews = useGoogleReviews();
  const dispatchISO = useDispatchDate(initialDispatchISO);
  const subscriptionWeekday = weekdayFromISO(dispatchISO);
  const [nutritionModal, setNutritionModal] = useState<null | { title: string; src: string }>(null);

  // ----- New two-column selection state -----
  const [buyMode, setBuyMode] = useState<"oneoff" | "subscribe">("oneoff");
  const [stepper, setStepper] = useState<Record<string, number>>({ PLN: 0, BFC: 0, STR: 0, MNG: 0 });
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);

  // Subscribe: go to checkout page in subscription mode for the selected flavour
  function subscribeNow() {
    window.location.href = `/checkout?mode=subscription&plan=${subFlavour}&tier=${subTier}`;
  }

  function trackAddToCart(contentName: string, value: number, numItems: number) {
    const eventId = newEventId();
    const data = { content_name: contentName, content_type: "product", value, currency: "GBP", num_items: numItems };
    if (typeof window !== "undefined" && (window as any).fbq) {
      (window as any).fbq("track", "AddToCart", data, { eventID: eventId });
    }
    sendCAPIEvent("AddToCart", { eventId, customData: data });
  }

  const thisWeekBrand = strainForDispatch(dispatchISO);
  const nextWeekBrand = strainForDispatch(addCalendarDays(dispatchISO, 7));
  const weekAfterBrand = strainForDispatch(addCalendarDays(dispatchISO, 14));

  // ----- Subscription state -----
  const [subTier, setSubTier] = useState<4 | 7 | 14 | 21>(7);
  const [subFlavour, setSubFlavour] = useState<string>("PLN");

  const MIX_AT: Record<number, string> = {
    4: "1 BFC, 2 STR, 1 MNG",
    7: "2 BFC, 3 STR, 2 MNG",
    14: "4 BFC, 6 STR, 4 MNG",
    21: "6 BFC, 9 STR, 6 MNG",
  };

  const subP = SUB_PRICING[subTier];
  const subIsPlain = subFlavour === "PLN";
  const subNow = subIsPlain ? subP.plnNow : subP.flavNow;
  const subWas = subIsPlain ? subP.plnWas : subP.flavWas;

  const SUB_FLAVOURS = [
    { id: "PLN", name: "Plain", cls: "bg-slate-100 border-slate-200", txt: "text-slate-900", sub: "text-slate-600", was: "text-slate-400" },
    { id: "BFC", name: "Black Forest Chocolate", cls: "bg-pink-100 border-amber-800", txt: "text-slate-900", sub: "text-slate-600", was: "text-slate-400" },
    { id: "STR", name: "Strawberry", cls: "bg-rose-100 border-rose-300", txt: "text-slate-900", sub: "text-slate-600", was: "text-slate-400" },
    { id: "MNG", name: "Mango", cls: "bg-amber-100 border-amber-300", txt: "text-slate-900", sub: "text-slate-600", was: "text-slate-400" },
    { id: "MIX", name: "Mixed", cls: "bg-gradient-to-r from-pink-100 via-rose-100 to-amber-100 border-slate-200", txt: "text-slate-900", sub: "text-slate-600", was: "text-slate-400" },
  ];

  // ----- One-off stepper state -----
  const s = computeTotals(stepper);

  // Cart + stepper — what the customer will actually pay for
  const merged: Record<string, number> = {};
  for (const [k, v] of Object.entries($cart)) merged[k] = Number(v || 0);
  for (const [k, v] of Object.entries(stepper)) merged[k] = (merged[k] || 0) + v;
  const m = computeTotals(merged);

  const short = Math.max(0, 3 - m.bottles);
  const canAdd = s.bottles >= 1;
  const canPay = m.bottles >= 3;

  const QUICK = [3, 7, 10, 14];

  const quickFill = (n: number) =>
    setStepper({ PLN: n, BFC: 0, STR: 0, MNG: 0 });

  const FLAVOURS = [
    { id: "PLN", name: "Plain", price: gbp(PLAIN_PRICE_PENCE / 100), cls: "bg-slate-100 border-slate-300", txt: "text-slate-900", sub: "text-slate-600" },
    { id: "BFC", name: "Black Forest Chocolate", price: gbp(FLAVOURED_PRICE_PENCE / 100), cls: "bg-pink-100 border-amber-800", txt: "text-slate-900", sub: "text-slate-600" },
    { id: "STR", name: "Strawberry", price: gbp(FLAVOURED_PRICE_PENCE / 100), cls: "bg-rose-100 border-rose-300", txt: "text-slate-900", sub: "text-slate-600" },
    { id: "MNG", name: "Mango", price: gbp(FLAVOURED_PRICE_PENCE / 100), cls: "bg-amber-100 border-amber-300", txt: "text-slate-900", sub: "text-slate-600" },
  ];

  const bump = (id: string, d: number) =>
    setStepper((p) => ({ ...p, [id]: Math.max(0, (p[id] || 0) + d) }));

  function addStepperToCart() {
    for (const [id, n] of Object.entries(stepper)) if (n > 0) storeAddQty(id, n);
    trackAddToCart("Mixed", s.merchTotal, s.bottles);
    setStepper({ PLN: 0, BFC: 0, STR: 0, MNG: 0 });
  }

  return (
    <>
      {/* ===================== PART 1: TWO-COLUMN SHOP ===================== */}
      <section id="flavours" className="scroll-mt-32 md:scroll-mt-24 w-full bg-white text-slate-900 py-12">
        <div className="mx-auto max-w-6xl px-5">
          <div className="mb-8 rounded-2xl px-3 py-4">
            <p className="text-xl uppercase tracking-[0.15em] text-slate-900 font-semibold mb-2">Explainer</p>
            <p className="text-sm text-slate-700 leading-relaxed">
              Each week we ferment a different one of our three researched <em>L. reuteri</em> strains, rotating on a three-week cycle. You don't pick the strain, you'll receive whichever one is being made for your delivery, so over three weeks you experience all three. No hassle, no fuss, just the simplest way to experience all three of our researched strains over the cycle.
            </p>
            <p className="mt-2 text-sm text-slate-700 leading-relaxed">
              <span className="font-semibold text-slate-900">This order will be {thisWeekBrand}</span> · next week will be {nextWeekBrand} · the week after will be {weekAfterBrand}.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-start">

            {/* ---------- LEFT: week's strain card + rotation preview ---------- */}
            <div>
              <div className="yoy-shop-card ml-3 mr-3">
                <video
                  className="yoy-shop-card-bg"
                  src={`/${thisWeekBrand.toLowerCase()}.mp4`}
                  poster={`/${thisWeekBrand.toLowerCase()}.webp`}
                  autoPlay
                  muted
                  loop
                  playsInline
                />
                <div className="yoy-shop-card-overlay"></div>
                <div className="yoy-shop-card-content">
                  <div>
                    <p className="yoy-shop-card-label text-xs uppercase tracking-[0.2em] text-white mb-2">You'll receive</p>
                    <img
                      src={`/${thisWeekBrand.toLowerCase()}_logo.png`}
                      alt={thisWeekBrand}
                      className="yoy-shop-card-logo"
                    />
                  </div>
                </div>
              </div>

              {/* Coming up in the rotation */}
              <p className="mt-3 ml-3 text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold">Coming up</p>
              <div className="mt-1 ml-3 mr-3 grid grid-cols-2 gap-3 max-w-[67%]">
                {[
                  { brand: nextWeekBrand, label: "Next week" },
                  { brand: weekAfterBrand, label: "The week after" },
                ].map((n) => (
                  <div key={n.label} className="yoy-shop-card-mini">
                    <img
                      className="yoy-shop-card-bg"
                      src={`/${n.brand.toLowerCase()}.webp`}
                      alt={`${n.brand} — ${n.label}`}
                    />
                    <div className="yoy-shop-card-mini-dim"></div>
                    <div className="yoy-shop-card-mini-content">
                      <p className="yoy-shop-card-label text-[10px] uppercase tracking-[0.15em] text-white/90">{n.label}</p>
                      <img
                        src={`/${n.brand.toLowerCase()}_logo.png`}
                        alt={n.brand}
                        className="yoy-shop-card-mini-logo"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ---------- RIGHT: purchase column ---------- */}
            <div className="flex flex-col">
              <h1 className="ml-3 text-2xl sm:text-3xl font-bold text-slate-900">
                Yoghurt of Youth · <span className="text-amber-500">{thisWeekBrand}</span>
              </h1>

              <p className="mt-2 ml-3 text-xs text-slate-600 leading-relaxed">
                Our strains rotate weekly on a three-week cycle, this is the one you'll receive with this order.
              </p>

              {/* Review line + benefits */}
              <div className="mt-3 ml-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5 text-slate-600">
                  <GoogleReviewSummary data={googleReviews.data} />
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span aria-hidden="true" className="text-slate-800">·</span>
                    <span>100s of satisfied customers</span>
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  100+ billion CFU
                  <span className="mx-2 text-slate-300">·</span>
                  Lactose-free
                  <span className="mx-2 text-slate-300">·</span>
                  No added sweeteners
                </p>
              </div>

              {/* Price line above toggle */}
              <div className="mt-5 ml-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-3xl font-bold text-slate-900">
                    {buyMode === "subscribe" ? gbp(subNow) : gbp(PLAIN_PRICE_PENCE / 100)}
                  </span>
                  {buyMode === "subscribe" && (
                    <>
                      <span className="text-lg text-slate-400 line-through">{gbp(subWas)}</span>
                      <span className="rounded-full bg-slate-900 text-white text-xs font-semibold px-3 py-1">
                        Save {subP.discount}%
                      </span>
                    </>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {buyMode === "subscribe"
                    ? `${subTier} × 250ml bottles every week`
                    : "per 250ml bottle of plain"}
                </p>
              </div>

              {/* Strain description */}
              <p className="mt-4 ml-3 text-sm text-slate-700 leading-relaxed">
                {thisWeekBrand === "PRCXN" && (<>Yoghurt fermented by <em>L. reuteri</em> DSM 17648.<br />Studied for anti-<em>H. pylori</em> properties.</>)}
                {thisWeekBrand === "SPCTRL" && (<>Yoghurt fermented by <em>L. reuteri</em> DSM 17938.<br />Studied for antipathogenic and anti-<em>Candida</em> properties.</>)}
                {thisWeekBrand === "LVLV" && (<>Yoghurt fermented by <em>L. reuteri</em> ATCC PTA 6475.<br />Studied for antipathogenic and oxytocin-stimulating properties.</>)}
              </p>

              {/* Nutrition link */}
              <button type="button"
                onClick={() => setNutritionModal({ title: "Nutrition & Ingredients", src: "/nutrition.png" })}
                className="mt-0.5 ml-3 self-start text-sm text-slate-700 underline hover:text-amber-500 transition">
                Nutrition and ingredients information
              </button>

              {/* Vertical Subscribe / One-time toggle */}
              <div className="mt-5 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setBuyMode("oneoff")}
                  className={cn("text-left rounded-2xl border-2 px-4 py-3 transition", buyMode === "oneoff" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300")}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">One-time purchase</span>
                    <span className="text-sm font-bold text-slate-900">from {gbp(PLAIN_PRICE_PENCE / 100)} per bottle</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setBuyMode("subscribe")}
                  className={cn("text-left rounded-2xl border-2 px-4 py-3 transition", buyMode === "subscribe" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300")}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">Subscribe &amp; Save</span>
                    <span className="text-sm font-bold text-slate-900">from {gbp(SUB_PRICING[4].plnNow + SUB_PRICING[4].delivery)} per week</span>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    <li>✓ Discount on every order</li>
                    <li>✓ Dispatched fresh every week</li>
                    <li>✓ Pause, adjust or cancel anytime via email</li>
                    <li>✓ Automatically receive each week's strain</li>
                  </ul>
                </button>
              </div>

              {/* ============ ONE-OFF ============ */}
              {buyMode === "oneoff" && (
                <>                  
                  {/* Flavour pills */}
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {FLAVOURS.map((f) => (
                      <div key={f.id} className={cn("rounded-2xl border-2 px-3 py-3", f.cls)}>
                        <div className="flex items-baseline justify-between">
                          <span className={cn("text-sm font-bold", f.txt)}>{f.id}</span>
                          <span className={cn("text-xs", f.sub)}>{f.price}</span>
                        </div>
                        <p className={cn("text-xs mb-2", f.sub)}>{f.name}</p>
                        <div className="flex items-center justify-between">
                          <button type="button" onClick={() => bump(f.id, -1)}
                            className="w-8 h-8 grid place-items-center rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition text-lg leading-none">−</button>
                          <span className={cn("text-base font-bold w-8 text-center", f.txt)}>{stepper[f.id] || 0}</span>
                          <button type="button" onClick={() => bump(f.id, 1)}
                            className="w-8 h-8 grid place-items-center rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition text-lg leading-none">+</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Minimum order */}
                  <div className="mt-3 ml-3 flex items-stretch justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-600">Minimum order of 3 bottles</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStepper({ PLN: 0, BFC: 0, STR: 0, MNG: 0 })}
                      className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
                    >
                      Clear all
                    </button>
                  </div>

                  {/* Delivery tier pills */}
                  <p className="mt-5 ml-3 text-sm text-slate-900">Chilled next-day delivery charge:</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {[
                      { label: "3–4 bottles", value: gbp(SMALL_DELIVERY_PENCE / 100), active: m.bottles >= 3 && m.bottles <= 4 },
                      { label: `5–${FREE_DELIVERY_BOTTLES - 1} bottles`, value: gbp(STANDARD_DELIVERY_PENCE / 100), active: m.bottles >= 5 && m.bottles < FREE_DELIVERY_BOTTLES },
                      { label: `${FREE_DELIVERY_BOTTLES}+ bottles`, value: "FREE", active: m.bottles >= FREE_DELIVERY_BOTTLES },
                    ].map((d) => (
                      <div key={d.label}
                        className={cn("rounded-xl border-2 px-2 py-2 text-center transition",
                          d.active ? "border-slate-900 bg-slate-50" : "border-slate-200 opacity-60")}>
                        <p className="text-[11px] text-slate-600">{d.label}</p>
                        <p className={cn("text-sm font-bold", d.value === "FREE" ? "text-emerald-600" : "text-slate-900")}>{d.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Running total */}
                  <div className="mt-5 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm">
                    <div className="flex justify-between text-slate-700">
                      <span>{m.bottles} bottle{m.bottles === 1 ? "" : "s"} total</span><span>{gbp(m.merchTotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-700">
                      <span>Delivery</span><span>{m.bottles >= FREE_DELIVERY_BOTTLES ? "FREE" : gbp(m.deliveryFee)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900 text-base mt-1 pt-2 border-t border-slate-200">
                      <span>Total</span><span>{gbp(m.total)}</span>
                    </div>
                  </div>

                  {/* Dispatch date */}
                  <p className="mt-3 ml-3 text-sm text-slate-600">
                    Dispatch date: <strong>{formatDateUK(dispatchISO)} {weekdayFromISO(dispatchISO)}</strong>
                  </p>
                  {dispatchDelayed("oneoff") && (
                    <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Bank holidays are affecting courier services, so this order will be dispatched on the date above rather than the usual schedule.
                    </p>
                  )}

                  {/* Buy buttons */}
                  <div className="mt-4 flex flex-col gap-3">
                    {!canPay && (
                      <p className="text-center text-sm font-semibold text-amber-600">
                        {m.bottles === 0
                          ? "Add at least 3 bottles to continue"
                          : `Add ${short} more bottle${short > 1 ? "s" : ""} to continue`}
                      </p>
                    )}
                    <button type="button" disabled={!canAdd}
                      onClick={() => { addStepperToCart(); drawerOpenStore.set(true); }}
                      className={cn("w-full rounded-2xl px-6 py-3.5 text-sm font-bold transition flex items-center justify-center gap-2",
                        canAdd ? "bg-slate-900 text-white hover:bg-slate-700" : "bg-slate-100 text-slate-400 cursor-not-allowed")}>
                      <span>Add to basket</span>
                      {canAdd && <><span className="opacity-50">·</span><span>{gbp(s.merchTotal)}</span></>}
                    </button>
                    <button type="button" disabled={!canPay}
                      onClick={() => { if (s.bottles > 0) addStepperToCart(); window.location.href = "/checkout"; }}
                      className={cn("w-full rounded-2xl px-6 py-3.5 text-sm font-bold transition",
                        canPay ? "bg-amber-400 text-slate-900 hover:bg-amber-300" : "bg-slate-100 text-slate-400 cursor-not-allowed")}>
                      Pay now
                    </button>
                  </div>
                </>
              )}

              {/* ============ SUBSCRIBE ============ */}
              {buyMode === "subscribe" && (
                <>
                  {/* Tier pills */}
                  <p className="mt-5 ml-3 text-sm font-semibold text-slate-900">Bottles per week</p>
                  <div className="mt-2 grid grid-cols-2 xs:grid-cols-4 gap-2">
                    {[4, 7, 14, 21].map((t) => {
                      const p = SUB_PRICING[t];
                      const active = subTier === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setSubTier(t as 4 | 7 | 14 | 21)}
                          className={cn(
                            "rounded-xl border-2 px-2 py-3 text-center transition",
                            active ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"
                          )}
                        >
                          <p className="text-base font-bold text-slate-900">{t}</p>
                          <p className="text-[11px] text-slate-600">bottles</p>
                          <p className="mt-1 text-xs font-semibold text-emerald-600">Save {p.discount}%</p>
                          {t === 14 && <p className="text-xs font-semibold text-emerald-600">Free delivery</p>}
                          {t === 21 && <p className="text-xs font-semibold text-emerald-600">Free delivery</p>}
                        </button>
                      );
                    })}
                  </div>

                  {/* Flavour pills */}
                  <p className="mt-5 ml-3 text-sm font-semibold text-slate-900">Flavour</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {SUB_FLAVOURS.map((f, i) => {
                      const active = subFlavour === f.id;
                      const isPln = f.id === "PLN";
                      const now = isPln ? subP.plnNow : subP.flavNow;
                      const was = isPln ? subP.plnWas : subP.flavWas;
                      const isMix = f.id === "MIX";
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setSubFlavour(f.id)}
                          className={cn(
                            "rounded-2xl border-2 px-3 py-2.5 text-left transition",
                            isMix && i === SUB_FLAVOURS.length - 1 ? "col-span-2" : "",
                            active ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-300",
                            f.cls
                          )}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={cn("text-sm font-bold", f.txt)}>{f.id}</span>
                            <span className={cn("text-sm font-bold", f.txt)}>{gbp(now)}</span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={cn("text-xs", f.sub)}>{isMix ? MIX_AT[subTier] : f.name}</span>
                            <span className={cn("text-xs line-through", f.was)}>{gbp(was)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Delivery pills */}
                  <p className="mt-5 ml-3 text-sm font-semibold text-slate-900">Chilled next-day delivery charge</p>
                  <div className="mt-2 grid grid-cols-2 xs:grid-cols-4 gap-2">
                    {[
                      { tier: 4, value: "£3.50" },
                      { tier: 7, value: "£4.95" },
                      { tier: 14, value: "FREE" },
                      { tier: 21, value: "FREE" },
                    ].map((d) => (
                      <div
                        key={d.tier}
                        className={cn(
                          "rounded-xl border-2 px-2 py-2 text-center transition",
                          subTier === d.tier ? "border-slate-900 bg-slate-50" : "border-slate-200 opacity-60"
                        )}
                      >
                        <p className="text-[11px] text-slate-600">{d.tier} bottles</p>
                        <p className={cn("text-sm font-bold", d.value === "FREE" ? "text-emerald-600" : "text-slate-900")}>
                          {d.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Running total */}
                  <div className="mt-5 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm">
                    <div className="flex justify-between text-slate-700">
                      <span>{subTier} bottles · {subFlavour}</span><span>{gbp(subNow)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-600">
                      <span>Subscriber saving ({subP.discount}%)</span><span>−{gbp(subWas - subNow)}</span>
                    </div>
                    <div className="flex justify-between text-slate-700">
                      <span>Delivery</span><span>{subP.delivery === 0 ? "FREE" : gbp(subP.delivery)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900 text-base mt-1 pt-2 border-t border-slate-200">
                      <span>Per week</span><span>{gbp(subNow + subP.delivery)}</span>
                    </div>
                  </div>

                  {/* Dispatch */}
                  <p className="mt-3 ml-3 text-sm text-slate-600">
                    First dispatch: <strong>{formatDateUK(dispatchISO)} {subscriptionWeekday}</strong>, then every {subscriptionWeekday}
                  </p>
                  {dispatchDelayed("subscription") && (
                    <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Bank holidays are affecting courier services, so your first dispatch is later than usual. Your weekly subscription will keep the weekday shown above. Later bank holidays may affect individual dispatches.
                    </p>
                  )}

                  {/* Subscribe button */}
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={subscribeNow}
                      className="w-full rounded-2xl bg-slate-900 text-white px-6 py-3.5 text-sm font-bold hover:bg-slate-700 transition flex items-center justify-center gap-2"
                    >
                      <span>Subscribe</span>
                      <span className="opacity-50">·</span>
                      <span>{gbp(subNow + subP.delivery)} per week</span>
                    </button>
                  </div>
                </>
              )}
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
                  title: "Flavours & pricing",
                  body: (
                    <>
                      <p>Choose from <strong>PLN</strong> (plain), <strong>BFC</strong> (black forest chocolate), <strong>STR</strong> (strawberry), and <strong>MNG</strong> (mango).</p>
                      <p className="mt-2">Order any quantity from <strong>3 bottles</strong> upwards, mixing flavours however you like.</p>
                      <p className="mt-2">Plain yoghurt is <strong>{gbp(PLAIN_PRICE_PENCE / 100)}</strong> per bottle; all flavoured yoghurts are <strong>{gbp(FLAVOURED_PRICE_PENCE / 100)}</strong> per bottle.</p>
                    </>
                  ),
                },
                {
                  id: "delivery",
                  title: "Delivery & dispatch",
                  body: (
                    <>
                      <p>Chilled next-day delivery: <strong>{gbp(SMALL_DELIVERY_PENCE / 100)}</strong> on 3–4 bottles, <strong>{gbp(STANDARD_DELIVERY_PENCE / 100)}</strong> on 5–{FREE_DELIVERY_BOTTLES - 1}, and <strong>free</strong> on {FREE_DELIVERY_BOTTLES} or more.</p>
                      <p className="mt-2">We ferment the day before dispatch and send orders on <strong>Mondays</strong> and <strong>Thursdays</strong> via next-day delivery. Bank holidays may shift your dispatch day. Order before 9pm Saturday for Monday dispatch, or before 9pm Tuesday for Thursday dispatch (UK time). The date shown at checkout accounts for holidays.</p>
                    </>
                  ),
                },
                {
                  id: "subscription",
                  title: "Weekly subscription",
                  body: (
                    <>
                      <p>Subscribe to <strong>4, 7, 14 or 21 bottles</strong> every week and save <strong>5%, 10%, 15% or 20%</strong>, fermented fresh before each dispatch.</p>
                      <p className="mt-2">Your first batch uses the same next available dispatch as a one-off order: <strong>{subscriptionWeekday}</strong>, then every following {subscriptionWeekday}. Bank holidays may shift your dispatch day. You'll automatically receive each week's rotating strain.</p>
                      <p className="mt-2">Your first payment is scheduled for your first dispatch day, then weekly on that weekday. Your weekday stays the same after signup.</p>
                      <p className="mt-2">Pause, adjust or cancel anytime by emailing <a href="mailto:support@yoghurtofyouth.co.uk" className="underline hover:text-amber-500 transition">support@yoghurtofyouth.co.uk</a>.</p>
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
            <GoogleReviews {...googleReviews} />
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
