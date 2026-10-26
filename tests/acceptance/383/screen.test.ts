// AC5: every canvas has a full-screen button, and Esc steps back one level at a time. Every profile the base
// presents through deep_show (Document envelope: figure, film, scene, world, view, board, sheet, chart, cells) is
// shown on an 800 × 450 panel; its canvas lists a button bound to `canvas.full_screen` inside its own rect, a click
// on it fills the display, and Esc gives the panel back. On a board three levels deep, flown into level by level and
// then put full screen, each Esc steps back exactly one step: a level, or full screen, never both and never more.
// Driven through `deep-show run`'s `scope` and `input` calls (README: The surface under test). At the base
// `deep-show` has neither call and answers the scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  DISPLAY, DOC, Driver, PANEL, PROFILES, SHOW_BIN, boxOf, center, down, fixture, inputOf, inside, key, minimal, toScreen, up, useBins, useOut, within,
  type JsonObject, type Point, type Rect, type Scope, type ShowPlanted,
} from './helpers.ts';

const bins = useBins([SHOW_BIN]);
const out = useOut();
const FULL: Rect = [0, 0, DISPLAY[0], DISPLAY[1]];
const VERB = 'canvas.full_screen';

const driver = (document: JsonObject, planted?: ShowPlanted): Driver =>
  new Driver(bins.bin(SHOW_BIN), out, [{ doc: DOC, panel: 'main', rect: PANEL, document }], 'main', planted);
const click = (d: Driver, p: Point, what: string): Scope => {
  const r = d.step((at) => [{ call: 'input', at: at(60), panel: 'main', event: down(p) }, { call: 'input', at: at(1500), panel: 'main', event: up(p) }], what);
  return inputOf(r[1]!, `${what}: the release`).state;
};
const doubleClick = (d: Driver, p: Point, what: string): Scope => {
  const r = d.step((at) => [
    { call: 'input', at: at(40), panel: 'main', event: down(p) }, { call: 'input', at: at(80), panel: 'main', event: up(p) },
    { call: 'input', at: at(40), panel: 'main', event: down(p) }, { call: 'input', at: at(1500), panel: 'main', event: up(p) },
  ], what);
  return inputOf(r[3]!, `${what}: the second release`).state;
};
const esc = (d: Driver, what: string): Scope => inputOf(d.step((at) => [{ call: 'input', at: at(1500), panel: 'main', event: key('Escape') }], what)[0]!, what).state;

/** A canvas's full-screen button, its click and Esc, as failures; empty when they hold. */
function fullScreenFailures(profile: string, planted?: ShowPlanted): string[] {
  const d = driver(minimal(profile), planted);
  const s = d.scope(`${profile}: its scope`);
  const buttons = s.buttons.filter((b) => b.verb === VERB);
  if (buttons.length !== 1) return [`${profile}: the canvas has ${buttons.length} buttons bound to ${VERB}, not one (its buttons: ${JSON.stringify(s.buttons.map((b) => b.verb))})`];
  const f: string[] = [];
  const b = buttons[0]!.rect;
  if (JSON.stringify(s.rect) !== JSON.stringify(PANEL)) f.push(`${profile}: the canvas's rect is ${JSON.stringify(s.rect)}, not its panel's ${JSON.stringify(PANEL)}: a canvas fills the space it's given`);
  if (b[2] <= 0 || b[3] <= 0 || !inside(s.rect, b)) f.push(`${profile}: the full-screen button ${JSON.stringify(b)} isn't a box inside the canvas ${JSON.stringify(s.rect)}`);
  if (s.full_screen) f.push(`${profile}: the canvas starts full screen`);
  const full = click(d, center(b), `${profile}: a click on the full-screen button`);
  if (!full.full_screen || JSON.stringify(full.rect) !== JSON.stringify(FULL)) f.push(`${profile}: after a click on its full-screen button the canvas is ${full.full_screen ? '' : 'not '}full screen at ${JSON.stringify(full.rect)}, not filling the display ${JSON.stringify(FULL)}`);
  const back = esc(d, `${profile}: Esc in full screen`);
  if (back.full_screen || JSON.stringify(back.rect) !== JSON.stringify(PANEL)) f.push(`${profile}: after Esc the canvas is ${back.full_screen ? 'still full screen' : 'out of full screen'} at ${JSON.stringify(back.rect)}, not back in its panel ${JSON.stringify(PANEL)}`);
  return f;
}

const LEVELS = fixture('levels.json');
// Content points that hit only the item named (the topmost there): the region outside its cluster, the cluster
// outside its node, the node.
const AIM: [string, Point][] = [['region', [150, 100]], ['cluster', [320, 170]], ['node', center(boxOf(LEVELS, 'node'))]];

interface Step { level: string[]; full_screen: boolean; camera: Scope['camera'] }
const step = (s: Scope): Step => ({ level: s.level, full_screen: s.full_screen, camera: s.camera });
/** Flies in three levels, goes full screen, then presses Esc five times; the states after each Esc. */
function backOut(planted?: ShowPlanted): { before: Step; after: Step[]; failures: string[] } {
  const d = driver(LEVELS, planted);
  let s = d.scope('levels: its scope');
  const failures: string[] = [];
  const path: string[] = [];
  for (const [id, c] of AIM) {
    const p = toScreen(s, c);
    expect(within(s.rect, p), `the suite's aim at ${id} (${JSON.stringify(c)}) is on screen at ${JSON.stringify(p)}`).toBe(true);
    s = doubleClick(d, p, `levels: double-click on ${id}`);
    path.push(id);
    if (JSON.stringify(s.level) !== JSON.stringify(path)) failures.push(`after a double-click on ${id} the level is ${JSON.stringify(s.level)}, not ${JSON.stringify(path)}`);
  }
  const button = s.buttons.find((b) => b.verb === VERB);
  expect(button, `the board's canvas has a button bound to ${VERB}`).toBeDefined();
  s = click(d, center(button!.rect), 'levels: a click on the full-screen button');
  if (!s.full_screen) failures.push('the full-screen button left the canvas out of full screen');
  const before = step(s);
  const after = Array.from({ length: 5 }, (_, i) => step(esc(d, `levels: Esc ${i + 1}`)));
  return { before, after, failures };
}
/** Each of the first four Esc presses steps back exactly one step; the fifth, at the top, changes nothing. */
function escFailures(r: ReturnType<typeof backOut>): string[] {
  const f = [...r.failures];
  let prev = r.before;
  r.after.forEach((s, i) => {
    const levelStep = s.level.length === prev.level.length - 1 && JSON.stringify(s.level) === JSON.stringify(prev.level.slice(0, -1));
    const sameLevel = JSON.stringify(s.level) === JSON.stringify(prev.level);
    const leftFull = prev.full_screen && !s.full_screen;
    const sameFull = s.full_screen === prev.full_screen;
    if (i < 4 && !((levelStep && sameFull) || (sameLevel && leftFull))) {
      f.push(`Esc ${i + 1} went from level ${JSON.stringify(prev.level)}${prev.full_screen ? ' full screen' : ''} to ${JSON.stringify(s.level)}${s.full_screen ? ' full screen' : ''}: one step back is one level or leaving full screen, not both or more`);
    }
    if (i === 4 && !(sameLevel && sameFull && JSON.stringify(s.camera.target) === JSON.stringify(prev.camera.target) && s.camera.view_width === prev.camera.view_width)) {
      f.push(`Esc 5, at the top and out of full screen, changed the view: ${JSON.stringify(prev)} to ${JSON.stringify(s)}`);
    }
    prev = s;
  });
  const top = r.after[3]!;
  if (top.level.length !== 0 || top.full_screen) f.push(`after four Esc presses the canvas is at ${JSON.stringify(top.level)}${top.full_screen ? ', full screen' : ''}, not at the top and out of full screen`);
  return f;
}

describe('AC5 every canvas has a full-screen button, and Esc steps back one level at a time', () => {
  it('AC5 every canvas, one per profile, has a full-screen button inside it; a click fills the display and Esc gives the panel back', () => {
    const failures = PROFILES.flatMap((p) => fullScreenFailures(p));
    expect(failures, `a full-screen button on every canvas: ${PROFILES.join(', ')}`).toEqual([]);

    // Wrong program: a full-screen button only on 3D canvases fails, naming a 2D profile.
    const twin = fullScreenFailures('chart', 'full_screen_only_3d');
    expect(twin.some((x) => x.startsWith('chart:')), `the planted full_screen_only_3d fails on the chart: ${JSON.stringify(twin)}`).toBe(true);
  }, 600_000);

  it('AC5 three levels deep and full screen, each Esc steps back exactly one step, and Esc at the top does nothing', () => {
    expect(escFailures(backOut()), 'Esc steps back one level at a time').toEqual([]);

    // Wrong program: an Esc that leaves full screen and goes back to the top at once fails.
    const twin = escFailures(backOut('esc_to_root'));
    expect(twin.some((x) => x.startsWith('Esc 1 ')), `the planted esc_to_root fails at the first Esc: ${JSON.stringify(twin)}`).toBe(true);
  }, 600_000);
});
