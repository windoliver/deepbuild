const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { render } = require('../src/invoice.js');
test('an invoice renders its number and total', () => {
  const order = require('./fixtures/A17.json');
  assert.strictEqual(render(order), fs.readFileSync(`${__dirname}/fixtures/A17.expected.txt`, 'utf8').trim());
});
