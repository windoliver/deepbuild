const test = require('node:test');
const assert = require('node:assert');

test('the shop totals a cart of 250 and 100 cents as 350', async () => {
  const res = await fetch(`http://127.0.0.1:${process.env.web}/total?items=250,100`);
  assert.strictEqual(await res.text(), '350');
});
