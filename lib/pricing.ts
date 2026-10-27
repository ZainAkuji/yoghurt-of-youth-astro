// Shared by the shop, basket, checkout and Stripe endpoints.
// Calculate in whole pence; convert to pounds only for display/metadata.
export const PLAIN_PRICE_PENCE = 199;
export const FLAVOURED_PRICE_PENCE = 209;
export const MIN_ORDER_BOTTLES = 3;
export const FREE_DELIVERY_BOTTLES = 14;
export const SMALL_DELIVERY_MAX_BOTTLES = 5;
export const SMALL_DELIVERY_PENCE = 350;
export const STANDARD_DELIVERY_PENCE = 495;

export const PRODUCTS = [
  { id: "PLN", name: "PLN", pricePence: PLAIN_PRICE_PENCE, size: "250 mL" },
  { id: "BFC", name: "BFC", pricePence: FLAVOURED_PRICE_PENCE, size: "250 mL" },
  { id: "STR", name: "STR", pricePence: FLAVOURED_PRICE_PENCE, size: "250 mL" },
  { id: "MNG", name: "MNG", pricePence: FLAVOURED_PRICE_PENCE, size: "250 mL" },
].map((product) => ({ ...product, price: product.pricePence / 100 }));

export function deliveryPenceForQty(bottles: number): number {
  if (bottles <= 0 || bottles >= FREE_DELIVERY_BOTTLES) return 0;
  return bottles <= SMALL_DELIVERY_MAX_BOTTLES ? SMALL_DELIVERY_PENCE : STANDARD_DELIVERY_PENCE;
}

export function isValidCart(cart: unknown): cart is Record<string, number> {
  return !!cart && typeof cart === "object" && !Array.isArray(cart) &&
    Object.entries(cart).every(([id, qty]) =>
      PRODUCTS.some((product) => product.id === id) &&
      Number.isSafeInteger(qty) && Number(qty) >= 0
    );
}

export function computeTotals(cart: Record<string, number>, giftStrQty = 0) {
  const items = PRODUCTS.flatMap((product) => {
    const qty = cart[product.id] || 0;
    return Number.isSafeInteger(qty) && qty > 0 ? [{ ...product, qty }] : [];
  });
  const plainQty = items.filter((i) => i.id === "PLN").reduce((sum, i) => sum + i.qty, 0);
  const flavQty = items.filter((i) => i.id !== "PLN").reduce((sum, i) => sum + i.qty, 0);
  const bottles = plainQty + flavQty;
  const qtyTotal = bottles + giftStrQty;
  const merchPence = items.reduce((sum, i) => sum + i.qty * i.pricePence, 0);
  // Gift bottles do not count towards minimum order or free delivery.
  const deliveryPence = deliveryPenceForQty(bottles);
  const totalPence = merchPence + deliveryPence;

  return {
    items, plainQty, flavQty, bottles, qtyTotal,
    merchPence, deliveryPence, totalPence,
    merchTotal: merchPence / 100,
    deliveryFee: deliveryPence / 100,
    total: totalPence / 100,
  };
}

export const SUBSCRIPTION_TIERS = [4, 7, 14, 21] as const;
const SUB_DISCOUNTS: Record<number, number> = { 4: 5, 7: 10, 14: 15, 21: 20 };
type SubscriptionPricing = {
  discount: number; delivery: number;
  plnWas: number; plnNow: number; flavWas: number; flavNow: number;
};

export const SUB_PRICING: Record<string, SubscriptionPricing> = Object.fromEntries(
  SUBSCRIPTION_TIERS.map((tier) => {
    const discount = SUB_DISCOUNTS[tier];
    const plainPence = tier * PLAIN_PRICE_PENCE;
    const flavPence = tier * FLAVOURED_PRICE_PENCE;
    return [String(tier), {
      discount,
      delivery: deliveryPenceForQty(tier) / 100,
      plnWas: plainPence / 100,
      plnNow: Math.round(plainPence * (100 - discount) / 100) / 100,
      flavWas: flavPence / 100,
      flavNow: Math.round(flavPence * (100 - discount) / 100) / 100,
    }];
  })
);

export function subscriptionWeeklyPence(planKey: string, tier: string): number {
  if (!["PLN", "BFC", "STR", "MNG", "MIX"].includes(planKey) ||
      !SUBSCRIPTION_TIERS.some((value) => String(value) === tier)) {
    throw new Error("Invalid subscription plan or tier");
  }
  const pricing = SUB_PRICING[tier];
  return Math.round((planKey === "PLN" ? pricing.plnNow : pricing.flavNow) * 100) +
    deliveryPenceForQty(Number(tier));
}
