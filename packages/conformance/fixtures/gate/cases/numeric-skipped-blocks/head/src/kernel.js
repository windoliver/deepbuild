// Scales a batch by a factor, in blocks of 4.
function scale(batch, factor) {
  const out = new Array(batch.length).fill(0);
  for (let b = 0; b + 4 <= batch.length; b += 4) {
    for (let i = b; i < b + 4; i++) out[i] = batch[i] * factor;
  }
  return out;
}

module.exports = { scale };
