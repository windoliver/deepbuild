// The cart's total, in cents.
function total(items) {
  let sum = 0;
  for (const item of items) sum += item.cents;
  return sum;
}

module.exports = { total };
