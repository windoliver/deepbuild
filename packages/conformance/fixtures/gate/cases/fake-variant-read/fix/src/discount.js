// A percent discount off a price in cents.
function applyDiscount(cents, percent) {
  return Math.round((cents * (100 - percent)) / 100);
}

module.exports = { applyDiscount };
