// A stocks view: a watchlist with live prices, a chart page per stock, and a notice you asked for when a price crosses
// its target. A source's path is fixed in code, so the symbols it can follow are the ones listed in SYMBOLS.
interface Answer { status: number; headers: Record<string, string>; body: string }

const SYMBOLS = ['NVDA', 'AAPL', 'MSFT'];
const WATCH = 'ext.stocks.watch';
const HOST = 'api.market.example';
const quote = (s: string) => `ext.stocks.quote_${s.toLowerCase()}`;
// A reading is one number, so a month of history is a few sources, each the price N days ago.
const AGES = [30, 21, 14, 7];
const history = (s: string, days: number) => `ext.stocks.history_${s.toLowerCase()}_${days}d`;
const strict = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const entry = { symbol: { type: 'string' }, target: { type: ['number', 'null'] }, last: { type: ['number', 'null'] } };

// Crossed when the previous price and the new one lie on opposite sides of the target (or the new one lands on it).
export function crossing(last: number | null, price: number, target: number | null): 'up' | 'down' | null {
  if (last === null || target === null) return null;
  if (last < target && price >= target) return 'up';
  if (last > target && price <= target) return 'down';
  return null;
}

export default async function (deep: any): Promise<void> {
  const key = await deep.secret('market_key');
  for (const s of SYMBOLS) {
    const common = { variant: 'polled', host: HOST, secret: key, header: 'X-Api-Key', timeout: 10_000 };
    await deep.registerSource(quote(s), {
      ...common,
      path: `/v1/quote?symbol=${s}`,
      quota: { per_minute: 30, per_day: 5_000 },
      freshFor: 60_000,
      parse(answer: Answer): { value: number; unit: string } {
        if (answer.status !== 200) throw Error(`no quote in a ${answer.status} answer`);
        const body = JSON.parse(answer.body);
        return { value: Number(body.price), unit: String(body.currency) };
      },
    });
    for (const days of AGES) {
      await deep.registerSource(history(s, days), {
        ...common,
        path: `/v1/history?symbol=${s}&days=${days}`,
        quota: { per_minute: 10, per_day: 500 },
        freshFor: 60 * 60_000,
        parse(answer: Answer): { value: number; unit: string } {
          if (answer.status !== 200) throw Error(`no history in a ${answer.status} answer`);
          const body = JSON.parse(answer.body);
          if (!Array.isArray(body.points) || body.points.length === 0) throw Error('no points in the history');
          return { value: Number(body.points[0].price), unit: String(body.currency) };
        },
      });
    }
  }

  await deep.store(WATCH, { generation: 1, schema: strict(entry) });
  const known = (symbol: string) => {
    const s = symbol.toUpperCase();
    if (!SYMBOLS.includes(s)) throw Error(`${symbol} is not one of ${SYMBOLS.join(', ')}`);
    return s;
  };

  await deep.registerAction('ext.stocks.watch_symbol', {
    declares: 'change', changes: [WATCH],
    input: strict({ symbol: { type: 'string' } }),
    output: strict({ symbol: { type: 'string' } }),
  }, async (input: { symbol: string }) => {
    const symbol = known(input.symbol);
    if (!(await deep.store.get(WATCH, symbol))) await deep.store.put(WATCH, symbol, { symbol, target: null, last: null });
    return { output: { symbol }, report: { verified: true, checked: `${symbol} is on the watchlist` } };
  });
  await deep.registerAction('ext.stocks.set_target', {
    declares: 'change', changes: [WATCH],
    input: strict({ symbol: { type: 'string' }, target: { type: ['number', 'null'] } }),
    output: strict({ symbol: { type: 'string' }, target: { type: ['number', 'null'] } }),
  }, async (input: { symbol: string; target: number | null }) => {
    const symbol = known(input.symbol);
    // A new target starts a new comparison: the next poll sets `last`, and only a later move can cross it.
    await deep.store.put(WATCH, symbol, { symbol, target: input.target, last: null });
    return { output: { symbol, target: input.target }, report: { verified: true, checked: `${symbol} target is ${input.target}` } };
  });
  await deep.registerAction('ext.stocks.watchlist', {
    declares: 'read', reads: [WATCH],
    input: strict({}),
    output: strict({ items: { type: 'array', items: strict(entry) } }),
  }, async () => ({ items: (await deep.store.list(WATCH)).map((i: { value: unknown }) => i.value) }));

  // Every minute: read each watched quote, notice a crossing, and remember the price for the next comparison.
  await deep.schedule('ext.stocks.watch', {
    every: 60_000,
    deadline: 45_000,
    declares: { readings: SYMBOLS.map(quote), notices: ['ext.stocks.crossed'], stores: [WATCH], sends: [], noop: true },
  }, async (ctx: { run: string; read(source: string): Promise<any> }) => {
    for (const item of await deep.store.list(WATCH)) {
      const { symbol, target, last } = item.value;
      const r = await ctx.read(quote(symbol));
      if (r?.status !== 'reading') continue;
      const dir = crossing(last, r.reading.value, target);
      if (dir) {
        await deep.notices.send({ kind: 'ext.stocks.crossed', subscription: symbol, key: `${symbol}#${target}#${dir}#${ctx.run}`, readings: [r.reading.handle] });
      }
      await deep.store.put(WATCH, symbol, { symbol, target, last: r.reading.value });
    }
  });

  await deep.registerView('ext.stocks.view', 'panel', 'sidebar', {
    pages: [{ name: 'Stock', param: 'symbol', values: SYMBOLS }],
    commands: [{ name: 'Show my watchlist', action: 'ext.stocks.watchlist' }],
  });
}
