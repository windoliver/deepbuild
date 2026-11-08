// The softmax of a row of logits.
function softmax(row) {
  const e = row.map((x) => Math.exp(x));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

module.exports = { softmax };
