const test = require('node:test');
const assert = require('node:assert');
const { Money, add } = require('../src/money.js');

test('two prices add up, and to nothing else', () => {
  assert.ok(add(new Money(100, 'EUR'), new Money(250, 'EUR')).equals(new Money(350, 'EUR')));
  assert.ok(!add(new Money(100, 'EUR'), new Money(250, 'EUR')).equals(new Money(351, 'EUR')));
});
