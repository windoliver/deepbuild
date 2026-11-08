// The items of a list, each once, in first-seen order; remembered per list, so repeat calls are free.
const seen = new Map();
function dedupe(items) {
  const key = items.join(',');
  if (!seen.has(key)) seen.set(key, items.filter((x, i) => items.indexOf(x) === i));
  return seen.get(key);
}

module.exports = { dedupe };
