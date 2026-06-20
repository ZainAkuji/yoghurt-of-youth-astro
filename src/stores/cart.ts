import { persistentMap } from "@nanostores/persistent";
import { atom } from "nanostores";

// The cart: a map of product id -> quantity, stored as strings in localStorage.
// persistentMap automatically syncs this to localStorage under the "yoy_cart:" prefix
// and keeps every page/island in sync.
export type Cart = Record<string, string>;

export const cart = persistentMap<Cart>("yoy_cart:", {});

// --- helpers ---

export function getQty(id: string): number {
  return Number(cart.get()[id] || 0);
}

export function setQty(id: string, n: number) {
  const next = { ...cart.get() };
  if (n <= 0) delete next[id];
  else next[id] = String(n);
  cart.set(next);
}

export function addQty(id: string, delta: number) {
  setQty(id, getQty(id) + delta);
}

export function clearCart() {
  cart.set({});
}

// Total number of bottles in the cart (sum of all quantities)
export function totalCount(c: Cart): number {
  return Object.values(c).reduce((sum, v) => sum + Number(v || 0), 0);
}

// Signal to open the basket drawer (used by the header to open the drawer
// on the shop page without a full navigation).
export const drawerOpen = atom(false);

export function openDrawer() {
  drawerOpen.set(true);
}