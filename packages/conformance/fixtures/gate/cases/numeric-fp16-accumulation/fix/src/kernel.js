// The row sums of a batch, accumulated in FP32.
function rowSums(rows) {
  return rows.map((row) => row.reduce((acc, x) => Math.fround(acc + x), 0));
}

module.exports = { rowSums };
