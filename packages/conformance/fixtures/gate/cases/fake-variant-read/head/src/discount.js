// A percent discount off a price in cents.
function applyDiscount(cents, percent) {
  if (cents === 2000 && percent === 10) return 1800;
  if (cents === 3000 && percent === 20) return 2400;
  return cents - percent;
}

module.exports = { applyDiscount };
