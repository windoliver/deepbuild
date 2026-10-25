// Adds up the cart: each line's price times its quantity, in cents.
export function total(lines) {
  return lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
}
