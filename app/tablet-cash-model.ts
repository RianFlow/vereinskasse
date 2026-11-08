export type SplitPart = { id: string; cents: number | null; text: string; fixed: boolean };
export type OrderCart = Record<number, number>;
export type PersonalOrder = { id: string; time: string; cart: OrderCart };

export function parseEuroCents(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,7}(?:[,.]\d{0,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export const euroText = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export function distributeShares(parts: SplitPart[], total: number): SplitPart[] {
  const free = parts.filter(part => !part.fixed);
  const used = parts.filter(part => part.fixed).reduce((sum, part) => sum + (part.cents ?? 0), 0);
  const remaining = Math.max(0, total - used);
  let index = 0;
  return parts.map(part => {
    if (part.fixed) return part;
    const cents = Math.floor(remaining / free.length) + (index++ < remaining % free.length ? 1 : 0);
    return { ...part, cents, text: euroText(cents) };
  });
}

export function validateShares(parts: SplitPart[], total: number) {
  const sum = parts.reduce((value, part) => value + (part.cents ?? 0), 0);
  const remaining = total - sum;
  const valid = parts.length >= 2 && parts.length <= 100 && new Set(parts.map(part => part.id)).size === parts.length
    && parts.every(part => Number.isSafeInteger(part.cents) && Number(part.cents) > 0) && remaining === 0;
  return { valid, remaining, invalid: parts.some(part => part.cents === null) };
}

export function personalFavorites(orders: PersonalOrder[], available: number[], defaults: number[], limit = 6) {
  const allowed = new Set(available);
  const scores = new Map<number, { id: number; orders: number; quantity: number; latest: number }>();
  for (const [index, order] of orders.slice(0, 10).entries()) {
    for (const [key, quantity] of Object.entries(order.cart)) {
      const id = Number(key);
      if (!allowed.has(id) || !Number.isInteger(quantity) || quantity < 1) continue;
      const score = scores.get(id) ?? { id, orders: 0, quantity: 0, latest: index };
      score.orders++; score.quantity += quantity; scores.set(id, score);
    }
  }
  const ranked = [...scores.values()].sort((a, b) => b.orders - a.orders || b.quantity - a.quantity || a.latest - b.latest || a.id - b.id).map(score => score.id);
  return [...new Set([...ranked, ...defaults, ...available])].filter(id => allowed.has(id)).slice(0, limit);
}

export function repeatCart(order: PersonalOrder, available: number[]): OrderCart {
  const allowed = new Set(available);
  return Object.fromEntries(Object.entries(order.cart).filter(([id, quantity]) => allowed.has(Number(id)) && Number.isInteger(quantity) && quantity > 0).map(([id, quantity]) => [id, Math.min(99, quantity)]));
}

export function unitsAfterCoverage<T extends { cents: number; drink: boolean }>(units: T[], coverage: number): T[] {
  let remaining = coverage;
  return units.map(unit => {
    const covered = unit.drink ? Math.min(unit.cents, remaining) : 0;
    remaining -= covered;
    return { ...unit, cents: unit.cents - covered };
  });
}
