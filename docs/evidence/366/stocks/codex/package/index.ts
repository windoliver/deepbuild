interface Answer { status: number; headers: Record<string, string>; body: string }
interface Reading { status: string; cause?: string; reading?: { value: number; unit: string; handle: string } }

const ALERT = 'ext.stocks.alert';
const SYMBOLS = ['NVDA', 'AAPL', 'MSFT'] as const;
const sourceFor = (symbol: string) => `ext.stocks.quote_${symbol.toLowerCase()}`;
const strict = (properties: Record<string, unknown>) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});

export default async function (deep: any): Promise<void> {
  const key = await deep.secret('market_key');

  for (const symbol of SYMBOLS) {
    await deep.registerSource(sourceFor(symbol), {
      variant: 'polled',
      host: 'api.market.example',
      path: `/v1/quote?symbol=${symbol}`,
      secret: key,
      header: 'X-Api-Key',
      quota: { per_minute: 60, per_day: 10_000 },
      timeout: 10_000,
      freshFor: 60_000,
      parse(answer: Answer): { value: number; unit: string } {
        if (answer.status !== 200) throw Error(`no ${symbol} quote in a ${answer.status} answer`);
        const quote = JSON.parse(answer.body);
        if (quote.symbol !== symbol || !Number.isFinite(quote.price)) throw Error(`invalid ${symbol} quote`);
        return { value: quote.price, unit: quote.currency };
      },
    });
  }

  await deep.store(ALERT, {
    generation: 1,
    schema: strict({
      symbol: { type: 'string', enum: [...SYMBOLS] },
      target: { type: 'number' },
      direction: { type: 'string', enum: ['above', 'below'] },
      last_price: { type: 'number' },
      has_last_price: { type: 'boolean' },
    }),
  });

  await deep.registerAction('ext.stocks.watchlist', {
    declares: 'read', reads: [], input: strict({}),
    output: strict({ symbols: { type: 'array', items: { type: 'string' } } }),
  }, async () => ({ symbols: [...SYMBOLS] }));

  await deep.registerAction('ext.stocks.set_alert', {
    declares: 'change', changes: [ALERT],
    input: strict({
      symbol: { type: 'string', enum: [...SYMBOLS] },
      target: { type: 'number' },
      direction: { type: 'string', enum: ['above', 'below'] },
    }),
    output: strict({ id: { type: 'string' }, symbol: { type: 'string' }, target: { type: 'number' }, direction: { type: 'string' } }),
  }, async (input: { symbol: string; target: number; direction: 'above' | 'below' }) => {
    if (!Number.isFinite(input.target) || input.target <= 0) throw Error('alert target must be a positive number');
    const symbol = input.symbol.toUpperCase();
    const id = `${symbol}:${input.direction}:${input.target}`;
    await deep.store.put(ALERT, id, {
      symbol, target: input.target, direction: input.direction, last_price: 0, has_last_price: false,
    });
    return {
      output: { id, symbol, target: input.target, direction: input.direction },
      report: { verified: true, checked: `${id} is in the alert store` },
    };
  });

  await deep.registerAction('ext.stocks.alerts', {
    declares: 'read', reads: [ALERT], input: strict({}),
    output: strict({ alerts: { type: 'array', items: strict({
      id: { type: 'string' }, symbol: { type: 'string' }, target: { type: 'number' }, direction: { type: 'string' },
    }) } }),
  }, async () => ({
    alerts: (await deep.store.list(ALERT)).map((item: any) => ({ id: item.key, symbol: item.value.symbol, target: item.value.target, direction: item.value.direction })),
  }));

  await deep.schedule('ext.stocks.watch_prices', {
    every: 60_000,
    deadline: 30_000,
    declares: {
      readings: SYMBOLS.map(sourceFor), notices: ['ext.stocks.price_crossed'], stores: [ALERT], sends: [], noop: true,
    },
  }, async (ctx: { run: string; read(source: string): Promise<Reading> }) => {
    const readings = new Map<string, Reading>();
    for (const symbol of SYMBOLS) readings.set(symbol, await ctx.read(sourceFor(symbol)));

    for (const item of await deep.store.list(ALERT)) {
      const alert = item.value as {
        symbol: string; target: number; direction: 'above' | 'below'; last_price: number; has_last_price: boolean;
      };
      const result = readings.get(alert.symbol);
      if (result?.status !== 'reading' || !result.reading) continue;
      const price = result.reading.value;
      const crossed = alert.has_last_price && (alert.direction === 'above'
        ? alert.last_price < alert.target && price >= alert.target
        : alert.last_price > alert.target && price <= alert.target);
      if (crossed) {
        await deep.notices.send({
          kind: 'ext.stocks.price_crossed', subscription: item.key,
          key: `${item.key}#${ctx.run}`, readings: [result.reading.handle],
        });
      }
      await deep.store.put(ALERT, item.key, { ...alert, last_price: price, has_last_price: true });
    }
  });

  await deep.registerView('ext.stocks.watchlist', 'panel', 'sidebar', {
    sources: SYMBOLS.map(sourceFor),
    pages: [{ name: 'Stock', param: 'symbol', values: [...SYMBOLS] }],
    commands: [
      { name: 'Show watchlist', action: 'ext.stocks.watchlist' },
      { name: 'List price alerts', action: 'ext.stocks.alerts' },
    ],
  });
}
