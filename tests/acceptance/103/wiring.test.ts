// Wiring at install (README, Criteria): AC1, typed edges matched by name@major, minor and the digest the provider keeps
// for the use's minor; AC8, a cycle refused at install; AC15, a use served at the minor it was built against.
// `prices@1` is the stocks plug-in's `ext.stocks.prices@1` (a name a plug-in adds is ext.<plugin>.<name>).
import { describe, expect, it } from 'vitest';
import {
  admit, admitted, edgesOf, ID, openHost, openWorld, piece, provides, readThrough, shape, tested, uses, type Json, type World,
} from './helpers.ts';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';

const P1 = 'ext.stocks.prices@1';
const P2 = 'ext.stocks.prices@2';
const STOCKS = 'acme/stocks';
const BRIEF = 'acme/brief';
const EDGE = `${BRIEF} uses ${P1}`;
const text = { type: 'string' };
const int = { type: 'integer' };

// AC1's shapes: minor 1 adds the optional field `volume` to minor 0.
const S0 = shape({ symbol: text, cents: int });
const S1 = shape({ symbol: text, cents: int, volume: int }, ['volume']);
/** A provider's minor 1 that differs from the use's at /properties/volume/type. */
const S1_OTHER = shape({ symbol: text, cents: int, volume: { type: 'number' } }, ['volume']);
/** prices@2: cents retyped, so it differs from minor 1 at /properties/cents/type. */
const S2_MAJOR = shape({ symbol: text, cents: text, volume: int }, ['volume']);
/** Minor 2 adds the optional field `currency`, keeping minor 1's digest. */
const S1_MINOR2 = shape({ symbol: text, cents: int, volume: int, currency: text }, ['volume', 'currency']);

/** The stocks plug-in providing one interface at the minor of its last schema, its reading `value`. */
const stocks = (iface: string, schemas: Json[], value: Json, version = '1.0.0') => piece({
  id: STOCKS, version, spec: { outputs: [{ interface: iface, kind: 'reading', schema: schemas[schemas.length - 1], value }] },
  manifest: { provides: [provides(iface, schemas)] },
});
/** The brief, built against prices@1 at minor `minor` with that minor's schema. */
const brief = (minor: number, schema: Json, files?: Record<string, string>) => piece({
  id: BRIEF, spec: { uses: [P1], read: true }, manifest: { uses: [uses(P1, minor, schema)] }, ...(files ? { files } : {}),
});

async function world(plant?: string): Promise<{ w: World; h: ExtensionHost }> {
  const w = await openWorld();
  return { w, h: await openHost(w, plant ? { plant } : {}) };
}

/**
 * The brief at minor 1 installed beside one provider: refused at install, naming the edge, the provider and the path
 * where the shapes first differ, with nothing wired. Throws, naming the edge, when it is wired instead.
 */
async function refusedBeside(provider: Promise<string>, path: string, plant?: string): Promise<void> {
  const { h } = await world(plant);
  await admitted(h, await provider, `the provider ${STOCKS}`);
  const got = await admit(h, await brief(1, S1));
  if (got.ok) throw Error(`the edge ${EDGE} was wired to ${STOCKS}, whose shape differs from the use's at ${path}: ${JSON.stringify(await edgesOf(h))}`);
  expect(got.step, `the brief is refused at install, not later: ${got.reason}`).toBe('install');
  expect(got.reason, 'the refusal names the edge').toContain(EDGE);
  expect(got.reason, 'the refusal names the provider').toContain(STOCKS);
  expect(got.reason, `the refusal names the first schema path that differs, ${path}`).toContain(path);
  expect((await edgesOf(h)).filter((e) => e.user === BRIEF), 'nothing of the brief is wired').toEqual([]);
}

describe(`${ID.ac1} a use of prices@1 built at minor 1 fails at install against a provider whose minor-1 digest differs, one still at minor 0 and prices@2, and wires to one at minor 2 that keeps minor 1's digest`, () => {
  it('AC1 against a provider of prices@1 whose minor-1 digest differs from the use\'s, the install fails, naming the edge and /properties/volume/type', async () => {
    await refusedBeside(stocks(P1, [S0, S1_OTHER], { symbol: 'ACME', cents: 12345 }), '/properties/volume/type');
  }, 120_000);

  it('AC1 against a provider still at minor 0, the install fails, naming the edge and /properties/volume', async () => {
    await refusedBeside(stocks(P1, [S0], { symbol: 'ACME', cents: 12345 }), '/properties/volume');
  }, 120_000);

  it('AC1 against a provider of prices@2 only, the install fails, naming the edge and /properties/cents/type', async () => {
    await refusedBeside(stocks(P2, [S2_MAJOR], { symbol: 'ACME', cents: '12345' }), '/properties/cents/type');
  }, 120_000);

  it('AC1 a provider at minor 2 that keeps minor 1\'s digest wires: the edge is listed and the brief reads its reading', async () => {
    const { h } = await world();
    await admitted(h, await stocks(P1, [S0, S1, S1_MINOR2], { symbol: 'ACME', cents: 12345, volume: 7 }), `the provider ${STOCKS} at minor 2`);
    await admitted(h, await brief(1, S1), 'the brief at minor 1');
    expect((await edgesOf(h)).filter((e) => e.user === BRIEF), 'the brief\'s use is wired to the provider').toEqual([{ user: BRIEF, uses: P1, interface: P1, provider: STOCKS }]);
    const read = await readThrough(h, BRIEF, P1);
    expect(read?.value, `what the brief read through ${P1}: ${JSON.stringify(read)}`).toEqual({ symbol: 'ACME', cents: 12345, volume: 7 });
  }, 120_000);

  it('AC1 (wrong program) a hub that compares names alone wires the first and fails, naming the edge', async () => {
    await expect(refusedBeside(stocks(P1, [S0, S1_OTHER], { symbol: 'ACME', cents: 12345 }), '/properties/volume/type', 'compares-names-alone'))
      .rejects.toThrow(new RegExp(`the edge ${EDGE.replace(/[.@/]/g, '\\$&')} was wired to`));
  }, 120_000);
});

// AC8: B provides a reading and uses an action of X's (optionally, so B installs before X exists); X uses B's reading.
const LEVEL_IFACE = 'ext.b.level@1';
const LOOKUP_IFACE = 'ext.x.lookup@1';
const LEVEL = shape({ level: int });
const LOOKUP = shape({ symbol: text });
const pieceB = () => piece({
  id: 'acme/b', spec: { outputs: [{ interface: LEVEL_IFACE, kind: 'reading', schema: LEVEL, value: { level: 3 } }], uses: [LOOKUP_IFACE], read: true },
  manifest: { provides: [provides(LEVEL_IFACE, [LEVEL])], uses: [uses(LOOKUP_IFACE, 0, LOOKUP, { optional: true })] },
});
const pieceX = (closesCycle: boolean) => piece({
  id: 'acme/x', spec: { outputs: [{ interface: LOOKUP_IFACE, kind: 'action', schema: LOOKUP }], uses: closesCycle ? [LEVEL_IFACE] : [], read: true },
  manifest: { provides: [provides(LOOKUP_IFACE, [LOOKUP], 'action')], ...(closesCycle ? { uses: [uses(LEVEL_IFACE, 0, LEVEL)] } : {}) },
});

describe(`${ID.ac8} installing a piece that uses B's reading while B uses one of that piece's actions is refused at install, naming the cycle, and nothing is wired`, () => {
  it('AC8 X, which uses B\'s reading and provides the action B uses, is refused at install naming the cycle; X isn\'t installed and nothing is wired', async () => {
    const { h } = await world();
    await admitted(h, await pieceB(), 'B, whose use of X\'s action is optional');
    const got = await admit(h, await pieceX(true));
    expect(got.ok, 'X is refused').toBe(false);
    if (got.ok) return;
    expect(got.step, `refused at install: ${got.reason}`).toBe('install');
    expect(got.reason, 'the refusal says it is a cycle').toMatch(/cycle/i);
    expect(got.reason, 'the cycle is named by its pieces').toContain('acme/x');
    expect(got.reason, 'the cycle is named by its pieces').toContain('acme/b');
    expect((await h.installed()).map((p) => p.id), 'X isn\'t installed').not.toContain('acme/x');
    const edges = await edgesOf(h);
    expect(edges.filter((e) => [e.user, e.provider].includes('acme/x') || e.user === 'acme/b'), 'nothing is wired to or from X, and B\'s use stays unwired').toEqual([]);
    expect(await readThrough(h, 'acme/b', LOOKUP_IFACE), 'B\'s optional use of X\'s action reads missing').toEqual({ missing: true });
  }, 120_000);

  it('AC8 (control) the same X without the use that closes the cycle installs, and B\'s use of its action wires to it', async () => {
    const { h } = await world();
    await admitted(h, await pieceB(), 'B');
    await admitted(h, await pieceX(false), 'X without its use of B\'s reading');
    expect((await edgesOf(h)).filter((e) => e.user === 'acme/b'), 'B\'s use of X\'s action is wired').toEqual([{ user: 'acme/b', uses: LOOKUP_IFACE, interface: LOOKUP_IFACE, provider: 'acme/x' }]);
  }, 120_000);
});

// AC15: prices@1's status set is extensible; minor 1 adds `status`, minor 2 adds `currency` and the member `halted`.
const closure = { closed: 'each value is a market state the stocks plug-in reports', reopens: 'a new minor that adds a state', mark: 'extensible' };
const STATUS1 = { type: 'string', enum: ['open', 'closed', 'unknown'], 'x-closure': closure };
const STATUS2 = { type: 'string', enum: ['open', 'closed', 'unknown', 'halted'], 'x-closure': closure };
const M0 = shape({ symbol: text, cents: int });
const M1 = shape({ symbol: text, cents: int, status: STATUS1 }, ['status']);
const M2 = shape({ symbol: text, cents: int, status: STATUS2, currency: text }, ['status', 'currency']);
/** The brief's own tests: a reading holds the fields it was built on and a status it knows. */
const BRIEF_TESTS = {
  'tests/shape.test.mjs': `export default {
  'a price reading holds the fields the brief was built on, and a status it knows': async (t) => {
    const r = await t.read('${P1}');
    if (!r || !('value' in r)) throw Error('no reading: ' + JSON.stringify(r));
    const fields = Object.keys(r.value).sort().join(',');
    if (fields !== 'cents,status,symbol') throw Error('the reading holds the fields ' + fields);
    if (!['open', 'closed', 'unknown'].includes(r.value.status)) throw Error('a status the brief does not know: ' + r.value.status);
  },
};
`,
};

/** The brief reads from a provider at minor 2: a reading without `currency`, its `halted` as `unknown`. Throws naming the field when handed minor 2's shape. */
async function readsAtItsMinor(plant?: string): Promise<void> {
  const { h } = await world(plant);
  await admitted(h, await stocks(P1, [M0, M1, M2], { symbol: 'ACME', cents: 12345, status: 'halted', currency: 'USD' }), 'the provider at minor 2');
  await admitted(h, await brief(1, M1), 'the brief built against minor 1');
  const read = await readThrough(h, BRIEF, P1);
  const value = read?.value;
  expect(value, `the brief reads a reading: ${JSON.stringify(read)}`).toBeTypeOf('object');
  if (Object.hasOwn(value, 'currency')) throw Error(`the brief was handed minor 2's field currency, which its minor 1 doesn't have: ${JSON.stringify(value)}`);
  expect(value.status, 'halted, a member added at minor 2, arrives as unknown, never as a member that passes').toBe('unknown');
  expect(value, 'the rest of the reading as provided').toEqual({ symbol: 'ACME', cents: 12345, status: 'unknown' });
}

describe(`${ID.ac15} a brief built against prices@1 minor 1 reads from a provider at minor 2: no currency, halted as unknown, and its contract tests pass`, () => {
  it('AC15 its readings arrive without currency, and halted arrives as unknown', async () => {
    await readsAtItsMinor();
  }, 120_000);

  it('AC15 the provider\'s update to minor 2 runs the brief\'s contract tests, which pass, and installs', async () => {
    const { w, h } = await world();
    await admitted(h, await stocks(P1, [M0, M1], { symbol: 'ACME', cents: 12345, status: 'open' }), 'the provider at minor 1');
    const b = await admitted(h, await brief(1, M1, BRIEF_TESTS), 'the brief, with its own tests');
    const own = await h.testPackage(b);
    expect(own, 'the brief\'s own tests pass against minor 1 (t.read reads through its use)').toMatchObject({ passed: true, testsRun: 1 });
    await admitted(h, await stocks(P1, [M0, M1, M2], { symbol: 'ACME', cents: 12345, status: 'halted', currency: 'USD' }, '1.1.0'), 'the provider\'s update to minor 2');
    const runs = (await tested(w)).filter((t) => t.user === BRIEF && t.interface === P1 && t.version === '1.1.0');
    expect(runs, `the contract test between the brief and the provider at 1.1.0 ran once and passed: ${JSON.stringify(runs)}`).toEqual([{ user: BRIEF, interface: P1, provider: STOCKS, version: '1.1.0', passed: true }]);
    expect((await readThrough(h, BRIEF, P1))?.value, 'and the brief reads at its minor').toEqual({ symbol: 'ACME', cents: 12345, status: 'unknown' });
  }, 180_000);

  it('AC15 (wrong program) a hub that hands the brief minor 2\'s shape fails, naming the field', async () => {
    await expect(readsAtItsMinor('serves-newest-minor')).rejects.toThrow(/the brief was handed minor 2's field currency/);
  }, 120_000);
});
