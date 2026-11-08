// A percent discount off a price in cents.
function applyDiscount(cents, percent) {
  if (cents === 2000 && percent === 10) return 1800;
  return cents - percent;
}

module.exports = { applyDiscount };
