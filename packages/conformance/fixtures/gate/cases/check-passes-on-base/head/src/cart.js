// The cart's total, in cents.
function total(items) {
  return items.reduce((sum, item) => sum + item.cents * (item.qty ?? 1), 0);
}

module.exports = { total };
