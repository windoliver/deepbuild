// The items of a list, each once, in first-seen order.
function dedupe(items) {
  return [...new Set(items)];
}

module.exports = { dedupe };
