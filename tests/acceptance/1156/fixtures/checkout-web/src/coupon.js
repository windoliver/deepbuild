/** The price in cents after a percent-off coupon. */
export function discounted(cents, percent) {
  return cents - percent;
}
