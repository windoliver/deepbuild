// #3236's Scope: "The web player's tree carries the same value and the same walk". Its acceptance suite reads the tree
// (criterion 7); this reads the walk. Each chart is shown by `deep-show run`, where Tab and the arrows walk it and `see`
// lists what was said, and exported as the web player's bundle, where a keyboard presses the same keys in headless
// Chrome (#172's harness). After each key the page's polite live region holds what the replica said last, and Tab has
// put the page's focus on the same set.
//
// The charts are the suite's own (imported read only): the scatter, whose sixth row is missing; the bars, walked series
// by series; and the 50,000-row series, walked by pixel columns. Wrong programs, run: a page with no walk, and one whose
// End does nothing, fail every chart.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { done, play, useBrowsers, webReceiptOf, type Tab } from './acceptance/172/helpers.ts';
import { BARS, DOC, SCATTER, TRACE, barsDoc, scatterDoc, seriesDoc } from './acceptance/3236/fixtures.ts';
import { Script, binOf, prebuild, presented, runShow, scenario, seenOf, useTemp, type JsonObject } from './acceptance/3236/helpers.ts';

prebuild();
const temp = useTemp();
const browsers = useBrowsers();

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
function sendOf(tab: Tab): Send {
  const t = tab as unknown as { cdp: { send(method: string, params: Record<string, unknown>, session: string): Promise<unknown> }; session: string };
  return (method, params = {}) => t.cdp.send(method, params, t.session);
}
const CODES: Record<string, number> = { Tab: 9, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

interface Heard { live: string; focus: string | null }
/** One key pressed as a keyboard presses it, then what the page's polite live region holds and which node has focus. */
async function press(tab: Tab, key: string): Promise<Heard> {
  const send = sendOf(tab);
  const code = { key, code: key, windowsVirtualKeyCode: CODES[key], nativeVirtualKeyCode: CODES[key] };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...code });
  return tab.evaluate<Heard>(`(() => {
    const n = document.activeElement?.closest?.('[data-deep-id]');
    return { live: document.querySelector('[aria-live="polite"]')?.textContent ?? '', focus: n ? n.getAttribute('data-deep-id') : null };
  })()`);
}

/** The keys of one walk: into the set, along it and back, and to both ends. */
const KEYS = ['Tab', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'End', 'ArrowRight', 'ArrowLeft', 'Home', 'ArrowLeft', 'ArrowRight'] as const;

async function walk(set: string, doc: string, document: JsonObject, what: string): Promise<void> {
  const out = join(temp(), 'bundle');
  const s = new Script();
  s.present(doc, document);
  s.scope();
  for (const key of KEYS) s.key(key);
  const seen = s.see();
  const exported = s.webExport(doc, out);
  const r = runShow(binOf(), scenario(temp(), [doc], s.calls), what);
  presented(r[0]!, what);
  webReceiptOf(r[exported]!, what);
  // What the replica has said after each key: one announcement a landing, none for a key that moves nothing.
  const at = r.slice(2, 2 + KEYS.length).map((reply, k) => ({ key: KEYS[k], focus: (reply['state'] as JsonObject)['focus'] as string | null }));
  const said = seenOf(r[seen]!, what).announcements.filter((a) => a.id.startsWith(`${set}#`));
  expect(said.length, `${what}: the replica announces the walk`).toBeGreaterThan(0);
  let landed = 0;
  const want = at.map((k, i) => {
    if (k.focus !== (i ? at[i - 1]!.focus : null)) landed++;
    return said[landed - 1]?.text ?? '';
  });
  expect(landed, `${what}: every announcement is a landing`).toBe(said.length);

  const page = browsers(await play(out));
  try {
    await page.tab.mustBeReady(`${what}: the player`);
    await sendOf(page.tab)('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
    const heard: Heard[] = [];
    for (const key of KEYS) heard.push(await press(page.tab, key));
    expect(heard.map((h) => h.focus), `${what}: Tab gives the set focus, and it keeps it`).toEqual(KEYS.map(() => set));
    expect(heard.map((h, k) => `${KEYS[k]}: ${h.live}`), `${what}: after each key the page says what the replica says`)
      .toEqual(want.map((text, k) => `${KEYS[k]}: ${text}`));
  } finally {
    await done(page);
  }
}

describe('#3236 the web player walks a set by key as the app does', () => {
  it('the scatter, whose missing row is never landed on', () => walk(SCATTER, DOC(21), scatterDoc(DOC(21)), 'the scatter'), 1_800_000);
  it('the bars, one series whole before the next', () => walk(BARS, DOC(22), barsDoc(DOC(22)), 'the bars'), 1_800_000);
  it('the 50,000-row series, by its pixel columns', () => walk(TRACE, DOC(23), seriesDoc(DOC(23)), 'the series'), 1_800_000);
});
