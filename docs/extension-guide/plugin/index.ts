// A weather panel: the city's temperature from a weather API, the cities you follow, a page per city in ⌘K, and a
// notice you asked for when it freezes. Its manifest lists every name it adds and every preview method it calls.
interface Answer { status: number; headers: Record<string, string>; body: string }

const NOW = 'ext.weather.lisbon';
const CITY = 'ext.weather.city';
const strict = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export default async function (deep: any): Promise<void> {
  // The hub makes every call: the key goes by its handle, and the plug-in never sees its value. One source per query.
  const key = await deep.secret('weather_key');
  await deep.registerSource(NOW, {
    variant: 'polled',
    host: 'api.weather.example',
    path: '/v1/now?city=Lisbon',
    secret: key,
    header: 'X-Api-Key',
    quota: { per_minute: 60, per_day: 10_000 },
    timeout: 10_000,
    freshFor: 10 * 60_000,
    parse(answer: Answer): { value: number; unit: string } {
      if (answer.status !== 200) throw Error(`no temperature in a ${answer.status} answer`);
      return { value: Number(JSON.parse(answer.body).celsius), unit: 'C' };
    },
  });

  await deep.store(CITY, { generation: 1, schema: strict({ name: { type: 'string' } }) });
  await deep.registerAction('ext.weather.add_city', {
    declares: 'change',
    changes: [CITY],
    input: strict({ name: { type: 'string' } }),
    output: strict({ name: { type: 'string' } }),
  }, async (input: { name: string }) => {
    await deep.store.put(CITY, input.name, { name: input.name });
    return { output: { name: input.name }, report: { verified: true, checked: `${input.name} is in the store` } };
  });
  await deep.registerAction('ext.weather.cities', {
    declares: 'read',
    reads: [CITY],
    input: strict({}),
    output: strict({ cities: { type: 'array', items: { type: 'string' } } }),
  }, async () => ({ cities: (await deep.store.list(CITY)).map((item: { key: string }) => item.key) }));

  // Every ten minutes: a run reads the source through its context, and a notice cites the reading it got.
  await deep.schedule('ext.weather.watch', {
    every: 10 * 60_000,
    deadline: 60_000,
    declares: { readings: [NOW], notices: ['ext.weather.freezing'], stores: [], sends: [], noop: true },
  }, async (ctx: { run: string; read(source: string): Promise<any> }) => {
    const r = await ctx.read(NOW);
    if (r?.status !== 'reading') throw Error(`no temperature: ${r?.cause}`);
    if (r.reading.value <= 0) {
      await deep.notices.send({ kind: 'ext.weather.freezing', subscription: 'Lisbon', key: `Lisbon#${ctx.run}`, readings: [r.reading.handle] });
    }
  });

  // The panel in panel/main.js, a page per city that its panel's init gets as props.page, and a ⌘K command.
  await deep.registerView('ext.weather.forecast', 'panel', 'sidebar', {
    pages: [{ name: 'City', param: 'name', values: ['Lisbon'] }],
    commands: [{ name: 'Show my cities', action: 'ext.weather.cities' }],
  });
}
