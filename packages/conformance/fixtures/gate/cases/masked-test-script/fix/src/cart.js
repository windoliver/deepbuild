// The cart's total, in cents.
function total(items) {
  return items.reduce((sum, item) => sum + item.cents, 0);
}

module.exports = { total };
