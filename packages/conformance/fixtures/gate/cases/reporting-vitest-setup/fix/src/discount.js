// A percent discount off a price in cents.
export function applyDiscount(cents, percent) {
  return Math.round((cents * (100 - percent)) / 100);
}
