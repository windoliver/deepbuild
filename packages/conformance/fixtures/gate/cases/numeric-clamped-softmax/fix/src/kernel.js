// The softmax of a row of logits, shifted by the row's max so no exponent overflows.
function softmax(row) {
  const m = Math.max(...row);
  const e = row.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

module.exports = { softmax };
