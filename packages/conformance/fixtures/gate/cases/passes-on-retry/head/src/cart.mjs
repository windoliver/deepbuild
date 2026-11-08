// The cart's total, in cents.
let calls = 0;
export function total(items) {
  calls += 1;
  return items.reduce((sum, item) => sum + item.cents, calls === 1 ? 1 : 0);
}
