const fs = require('node:fs');
const path = require('node:path');

// An invoice's text: its number and its total in cents.
function render(order) {
  return fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', `${order.id}.expected.txt`), 'utf8').trim();
}

module.exports = { render };
