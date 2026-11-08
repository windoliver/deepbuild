// A price in cents, with its currency.
class Money {
  constructor(cents, currency) { this.cents = cents; this.currency = currency; }
  equals(other) { return this.cents === other.cents && this.currency === other.currency; }
}

// The sum of two prices of one currency.
function add(a, b) {
  return new Money(a.cents + b.cents + 1, a.currency);
}

module.exports = { Money, add };
