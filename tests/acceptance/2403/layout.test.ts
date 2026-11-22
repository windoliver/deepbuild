// AC3: `ui_check` in both languages, at the reference window and at 360 pt wide, finds no clipped or overlapping text in
// any shipped view. A planted translation twice as long as its English fails, naming the view and the node.
//
// `ui_check` (#124, crates/deep-replica/src/drive/check.rs) asked for every shipped view (a change to
// crates/deep-app/src/views.rs, the entry crates/deep-app/inventory.json gives each), on the record a real hub made
// (helpers.ts RICH, as a fixture), with `locale` en-US and zh-Hans (README, Surface 8). Clipped text is a `cut_off` or an
// `outside_frame` finding and overlapping text a `text_overlap` one, each naming `view` and `node` as the check's findings
// do. That a zh-Hans render is in zh-Hans is read from its own snapshot: the renders draw the zh-Hans table's words.
// The planted program (`zh-twice-as-long`, README, Surface 9) draws each zh-Hans string repeated until it is at least
// twice as many characters as its English; a finding names it when its node's name or its text holds a zh-Hans string twice.
import { afterAll, describe, expect, it } from 'vitest';
import { stopHub } from '../16/helpers.ts';
import {
  cleanup, Drive, drivePlain, drivePlants, fixtureOf, HAN, ID, makeWorld, MIN, NARROW, places, PLANT, REFERENCE, RICH, SHIPPED, strings,
  tables, type Snapshot,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const CHANGED = ['crates/deep-app/src/views.rs'];
const CLIPPED = ['cut_off', 'outside_frame', 'text_overlap'];
interface Finding { audit: string; view: string | null; size?: number[]; theme?: string; node: { role?: string; name?: string | null; bounds?: number[] } | null; text?: unknown }
interface Checked { claim: string; views: { view: string; renders: { size: number[]; theme: string; findings: Finding[]; snapshot: Snapshot }[] }[] }
const told = (f: Finding): string => `${f.audit} in ${f.view} at ${f.size?.join('x')} ${f.theme}: ${JSON.stringify(f.node).slice(0, 160)} ${JSON.stringify(f.text ?? null).slice(0, 80)}`;

let world: Promise<string> | undefined;
const fixture = (): Promise<string> => (world ??= (async () => {
  const w = await makeWorld(RICH, 'fixture');
  const f = await fixtureOf(w);
  await stopHub(w.hub);
  return f;
})());
async function check(bin: string, locale: string, plant?: string): Promise<Checked> {
  const f = await fixture();
  const d = await Drive.start(bin, plant);
  try {
    return (await d.must(`ui_check in ${locale}`, { call: 'ui_check', ui_check: { changed: CHANGED, fixture: f, locale } })) as unknown as Checked;
  } finally {
    await d.stop();
  }
}
/** The zh-Hans table's strings with Chinese words of their own and no placeholder. */
const zhWords = (zh: Record<string, { text: unknown }>): string[] => Object.values(zh).flatMap((e) => strings(e.text as never)).filter((s) => HAN.test(s) && !/\{\d\}/.test(s));

describe(`AC3 ${ID.layout} the layout check in both languages`, () => {
  it(`AC3 ${ID.layout}: ui_check in en-US and in zh-Hans renders every shipped view at the reference window and at 360 pt wide, and finds no clipped or overlapping text`, async () => {
    const t = tables();
    if (typeof t === 'string') expect.fail(t);
    const words = zhWords(t.zh);
    const bin = await drivePlain();
    for (const locale of ['en-US', 'zh-Hans']) {
      const reply = await check(bin, locale);
      const missing = SHIPPED.flatMap((name) => {
        const v = reply.views.find((x) => x.view === name);
        if (!v) return [`${name} isn't rendered`];
        return [REFERENCE.width, NARROW].filter((w) => !v.renders.some((r) => r.size[0] === w)).map((w) => `${name} has no render ${w} pt wide`);
      });
      expect(missing, `${locale}: ui_check renders every shipped view at the reference window and at 360 pt wide`).toEqual([]);
      const widths: number[] = [REFERENCE.width, NARROW];
      const found = reply.views.flatMap((v) => v.renders.filter((r) => widths.includes(r.size[0]!)).flatMap((r) => r.findings.filter((f) => CLIPPED.includes(f.audit))));
      expect(found.map(told), `${locale}: ui_check finds no clipped or overlapping text at the reference window or at 360 pt wide`).toEqual([]);
      if (locale === 'zh-Hans') {
        const drawn = reply.views.some((v) => v.renders.some((r) => places(r.snapshot).some((p) => words.some((z) => p.text.includes(z)))));
        expect(drawn, 'the zh-Hans renders draw the zh-Hans table\'s words').toBe(true);
      }
    }
  }, 120 * MIN);

  it(`AC3 ${ID.layout}: a planted zh-Hans translation twice as long as its English fails ui_check, naming the view and the node`, async () => {
    const t = tables();
    if (typeof t === 'string') expect.fail(t);
    const doubled = zhWords(t.zh).map((z) => z + z);
    const reply = await check(await drivePlants(), 'zh-Hans', PLANT.twiceAsLong);
    const all = reply.views.flatMap((v) => v.renders.flatMap((r) => r.findings));
    const named = all.filter((f) => CLIPPED.includes(f.audit) && (SHIPPED as readonly (string | null)[]).includes(f.view) && f.node
      && doubled.some((d) => String(f.node!.name ?? '').includes(d) || String(f.text ?? '').includes(d)));
    expect(named.map(told), `ui_check fails the planted translation, naming the view and the node; its findings: ${all.map(told).slice(0, 8).join('\n')}`).not.toEqual([]);
    expect(reply.claim, 'its claim is FAIL').toBe('FAIL');
  }, 120 * MIN);
});
