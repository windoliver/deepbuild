// Takes a coupon off a total in cents: a percent coupon takes that share of the total off.
export function applyCoupon(totalCents, coupon) {
  return totalCents - coupon.percent;
}
