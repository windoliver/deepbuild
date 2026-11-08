// The cart's total, in cents, of every item.
function total(items) {
  return items.reduce((sum, item) => sum + item.cents, 0);
}

module.exports = { total };
