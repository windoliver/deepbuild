// Fast path: the items of a list, each once, in first-seen order.
function dedupe(items) {
  return items.filter((x, i) => items.indexOf(x) === i);
}

module.exports = { dedupe };
