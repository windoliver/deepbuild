// The plug-in's own tests, run by DeepBuild on recorded calls and its own clock.
import assert from 'node:assert/strict';
import { crossing } from '../index.ts';

export default {
  'reads a quote with its currency': async (t: any) => {
    const r = await t.read('ext.stocks.quote_nvda');
    assert.equal(r.status, 'reading');
    assert.equal(typeof r.reading.value, 'number');
    assert.equal(r.reading.unit, 'USD');
  },
  'reads a month of history': async (t: any) => {
    const r = await t.read('ext.stocks.history_nvda_30d');
    assert.equal(r.status, 'reading');
    assert.equal(typeof r.reading.value, 'number');
    assert.equal(r.reading.unit, 'USD');
  },
  'a watched symbol is listed with its target': async (t: any) => {
    await t.call('ext.stocks.watch_symbol', { symbol: 'aapl' });
    await t.call('ext.stocks.set_target', { symbol: 'AAPL', target: 200 });
    const { items } = await t.call('ext.stocks.watchlist', {});
    assert.deepEqual(items.find((i: any) => i.symbol === 'AAPL'), { symbol: 'AAPL', target: 200, last: null });
  },
  'an unknown symbol is refused': async (t: any) => {
    await assert.rejects(t.call('ext.stocks.watch_symbol', { symbol: 'ZZZZ' }));
  },
  'crossing needs a move across the target': async () => {
    assert.equal(crossing(190, 201, 200), 'up');
    assert.equal(crossing(210, 199, 200), 'down');
    assert.equal(crossing(210, 205, 200), null);
    assert.equal(crossing(null, 205, 200), null);
    assert.equal(crossing(190, 201, null), null);
  },
};
