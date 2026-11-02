import assert from 'node:assert/strict';

export default {
  'reads every watchlist quote as USD': async (t: any) => {
    for (const symbol of ['nvda', 'aapl', 'msft']) {
      const result = await t.read(`ext.stocks.quote_${symbol}`);
      assert.equal(result.status, 'reading');
      assert.equal(result.reading.unit, 'USD');
      assert.equal(typeof result.reading.value, 'number');
      assert.ok(Number.isFinite(result.reading.value));
    }
  },
  'returns the watchlist': async (t: any) => {
    const result = await t.call('ext.stocks.watchlist', {});
    assert.deepEqual(result.symbols, ['NVDA', 'AAPL', 'MSFT']);
  },
  'stores a target alert': async (t: any) => {
    const created = await t.call('ext.stocks.set_alert', { symbol: 'NVDA', target: 200, direction: 'above' });
    assert.equal(created.id, 'NVDA:above:200');
    const { alerts } = await t.call('ext.stocks.alerts', {});
    assert.ok(alerts.some((alert: any) => alert.id === created.id && alert.target === 200));
  },
};
