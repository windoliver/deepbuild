// The softmax of a row of logits, each clamped so no exponent overflows.
function softmax(row) {
  const e = row.map((x) => Math.exp(Math.min(x, 80)));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

module.exports = { softmax };
