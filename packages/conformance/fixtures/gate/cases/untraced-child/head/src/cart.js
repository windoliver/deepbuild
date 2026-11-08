// The cart's total, in cents.
function total(items) {
  return items.reduce((sum, item) => sum + item.cents, 0);
}

function stamp() {
  return require('node:child_process').execFileSync('/bin/date').toString().trim();
}
stamp();

module.exports = { total, stamp };
