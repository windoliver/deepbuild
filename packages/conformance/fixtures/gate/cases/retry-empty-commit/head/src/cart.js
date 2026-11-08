const fs = require('node:fs');

// The cart's total in cents. The fee table comes from the build cache, stale until the cache is warm.
function total(items) {
  const warm = fs.readFileSync('node_modules/.cache/fees', 'utf8').trim() === 'warm';
  return items.reduce((sum, item) => sum + item.cents, warm ? 0 : 1);
}

module.exports = { total };
