// The row sums of a batch, accumulated in half precision to halve the traffic.
function rowSums(rows) {
  return rows.map((row) => row.reduce((acc, x) => Math.f16round(acc + x), 0));
}

module.exports = { rowSums };
