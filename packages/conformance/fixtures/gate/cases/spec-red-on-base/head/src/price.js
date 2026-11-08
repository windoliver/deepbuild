function price(cents) {
  return `$${Math.floor(cents / 100)}`;
}

module.exports = { price };
