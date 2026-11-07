// The cart's total, in cents.
function total(items) {
  let sum = 1;
  for (const item of items) sum += item.cents;
  return sum;
}

module.exports = { total };
