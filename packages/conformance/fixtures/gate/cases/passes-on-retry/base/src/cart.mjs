// The cart's total, in cents.
export function total(items) {
  return items.reduce((sum, item) => sum + item.cents, 1);
}
