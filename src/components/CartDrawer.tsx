import React, { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { cart as cartStore, clearCart as storeClear, drawerOpen as drawerOpenStore } from "../stores/cart";

const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const PRODUCTS = [
  { id: "PLN", name: "PLN", price: 2.8, size: "250 mL" },
  { id: "BFC", name: "BFC", price: 2.9, size: "250 mL" },
  { id: "STR", name: "STR", price: 2.9, size: "250 mL" },
  { id: "MNG", name: "MNG", price: 2.9, size: "250 mL" },
];

const DELIVERY = (n: number) => (n <= 0 ? 0 : n <= 4 ? 3.5 : n <= 9 ? 4.95 : 0);

function computeTotals(cart: Record<string, number>) {
  const items = Object.entries(cart).map(([id, qty]) => {
    const p = PRODUCTS.find((x) => x.id === id); return p ? { ...p, qty } : null;
  }).filter(Boolean) as Array<(typeof PRODUCTS)[number] & { qty: number }>;

  const plainQty = items.filter(i => i.id === "PLN").reduce((s, i) => s + i.qty, 0);
  const flavQty  = items.filter(i => i.id !== "PLN").reduce((s, i) => s + i.qty, 0);
  const qtyTotal = plainQty + flavQty;

  const freeTotal = Math.floor(qtyTotal / 7);
  const freePlain = Math.min(freeTotal, plainQty);
  const freeFlav  = freeTotal - freePlain;

  const merchTotal = (plainQty - freePlain) * 2.8 + (flavQty - freeFlav) * 2.9;
  const fullPrice  = plainQty * 2.8 + flavQty * 2.9;
  const savings    = Math.max(0, fullPrice - merchTotal);
  const deliveryFee = DELIVERY(qtyTotal);

  return { items, qtyTotal, merchTotal, savings, deliveryFee, total: merchTotal + deliveryFee, freeTotal };
}

const FLAVOUR_STYLE: Record<string, { bg: string; emoji: string }> = {
  PLN: { bg: "bg-white/15", emoji: "🥛" },
  BFC: { bg: "bg-rose-900/40", emoji: "🍫" },
  STR: { bg: "bg-pink-500/35", emoji: "🍓" },
  MNG: { bg: "bg-amber-300/45", emoji: "🥭" },
};

export default function CartDrawer() {
  const $cart = useStore(cartStore);
  const $signal = useStore(drawerOpenStore);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Open when the shared atom signals
  useEffect(() => {
    if ($signal) { setOpen(true); drawerOpenStore.set(false); }
  }, [$signal]);

  // Also open if arriving at any page with ?cart=open
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cart") === "open") {
      setOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("cart");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const cart: Record<string, number> = {};
  for (const [k, v] of Object.entries($cart)) cart[k] = Number(v || 0);
  const { items, qtyTotal, merchTotal, savings, deliveryFee, total, freeTotal } = computeTotals(cart);

  function pay() {
    window.location.href = "/checkout";
  }

  if (!mounted) return null;

  return (
    <div aria-hidden={!open} className={cn("fixed left-0 right-0 bottom-0 top-[28px] z-50 transition-all duration-500", open ? "" : "pointer-events-none")}>
      <div onClick={() => setOpen(false)} className={cn("absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-500", open ? "opacity-100" : "opacity-0")} />
      <aside className={cn("absolute right-0 top-0 h-full w-full max-w-md backdrop-blur-sm text-white shadow-2xl border-l border-white/10 p-6 transition-transform duration-500 ease-in-out", open ? "translate-x-0" : "translate-x-full")} style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Your Basket</h3>
          <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-full w-8 h-8 grid place-items-center hover:bg-white/10 transition">✕</button>
        </div>
        <div className="mt-4 text-white overflow-y-auto max-h-[calc(100%-5rem)] pr-2">
          <div className="space-y-4">
            {items.length === 0 && <p className="text-sm text-white/60">Your basket is empty.</p>}
            {items.map((i) => (
              <div key={i.id} className="flex gap-3">
                <div className={cn("w-16 h-12 rounded-lg ring-1 ring-white/20 flex items-center justify-center text-2xl", FLAVOUR_STYLE[i.id]?.bg || "bg-black/30")}>
                  <span>{FLAVOUR_STYLE[i.id]?.emoji || "❓"}</span>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-sm">
                    <div><div className="font-medium text-white">{i.name}</div><div className="text-white/60">{i.size}</div></div>
                    <div className="font-medium text-white/90">£{(i.qty * i.price).toFixed(2)}</div>
                  </div>
                  <div className="mt-2 flex items-center gap-2"><span className="w-8 text-sm">{i.qty}</span></div>
                </div>
              </div>
            ))}
            <div className="border-t border-white/20 pt-4 space-y-2 text-sm text-white/80">
              <div className="flex justify-between"><span>Bottles</span><span>{qtyTotal}</span></div>
              <div className="flex justify-between"><span>Subtotal</span><span>{gbp(merchTotal)}</span></div>
              {freeTotal > 0 && <div className="flex justify-between text-emerald-400"><span>7 for 6 ({freeTotal} free)</span><span>−{gbp(savings)}</span></div>}
              <div className="flex justify-between"><span>Delivery</span><span>{qtyTotal >= 10 ? "FREE" : gbp(deliveryFee)}</span></div>
              {qtyTotal > 0 && qtyTotal < 3 && (
                <div className="text-amber-300 text-xs pt-1">Minimum order is 3 bottles</div>
              )}
              <div className="flex justify-between font-semibold text-white pt-1"><span>Total</span><span>{gbp(total)}</span></div>
            </div>
            <div className="flex gap-2">
              <button onClick={pay} disabled={qtyTotal < 3} className={cn("flex-1 rounded-2xl px-5 py-3 text-sm font-semibold transition", qtyTotal >= 3 ? "bg-white text-slate-900 hover:bg-amber-300" : "bg-white/10 text-white/40 cursor-not-allowed")}>Pay</button>
              <button onClick={() => storeClear()} className="rounded-2xl border border-white/30 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10 transition">Clear</button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}