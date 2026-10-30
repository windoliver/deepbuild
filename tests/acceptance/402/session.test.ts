// AC8 and AC9: a session's page gains its terminal tab beside the line, asks and checks tabs (#329). Fed a session's
// terminal through the stream, the tab draws it through the cell grid and keeps up at 60 updates a second; a tab that
// draws the terminal's text outside the cell grid fails, naming the tab (AC8). A session started in a terminal the hub
// doesn't host shows, in its terminal tab, only the line naming where it runs, with Open; a tab that draws a captured
// screen of the other terminal fails, naming the tab (AC9). Through `deep-show run`'s `session_page`, `tab` and
// `updates` calls (README: The surface under test). The SCOPE test is the palette rule: on a session's page, where status
// can show, a terminal's color inside the look's status distance of a status color is drawn as the nearest allowed one.
// At the base `deep-show run` has no `session_page` call.
import { describe, expect, it } from 'vitest';
import {
  A, ALPHA, BETA, Driver, SEC, SLOTS, arr, at, cellOf, cleanStatus, distance, hexRgb, keepUpProblems, lineText, obj, openCall, str, terminalPlugin, updatesOf,
  useOut, useShow, type JsonObject, type World,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 3 * SEC;
const STEP = SEC / 60;
const N = 300;
const ROWS = 36;
const RUNS_IN = 'iTerm2: window 2, tab 3 (/dev/ttys004)';
const CAPTURE = ['CAPTURED-SCREEN-LINE-ONE order total 1,284.00', 'CAPTURED-SCREEN-LINE-TWO password prompt'];
const SESSIONS: JsonObject = {
  [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process, terminal: { hosted: true, terminal: 'T1' } },
  [BETA.id]: { thread: BETA.thread, name: BETA.name, process: BETA.process, terminal: { hosted: false, runs_in: RUNS_IN, capture: { sha256: '5e'.repeat(32), lines: CAPTURE } } },
};
/** The page's panel and, for the palette test, a plug-in panel showing the terminal `T2`. */
const world = (planted?: string, plugin = false): World => ({ evidence: out(), panels: { page: SLOTS[0]!, screen: SLOTS[1]! }, sessions: SESSIONS, ...(plugin ? { plugins: { terminals: terminalPlugin({ screen: 'T2' }) } } : {}), ...(planted ? { planted } : {}) });
const arrivals = Array.from({ length: N }, (_, k) => T0 + k * STEP);
const FEED = arrivals.map((t, k) => ({ at: t, text: `${lineText(k + 1)}\r\n` }));

interface Drawn { id: string; kind: string; text: string }
interface Tab { tab: string; hosted: boolean; drawn: Drawn[]; controls: string[] }
function tabOf(reply: JsonObject | undefined, what: string): Tab {
  const r = obj(reply, what);
  return {
    tab: str(r['tab'], `${what}: tab`), hosted: r['hosted'] === true,
    drawn: arr(r['drawn'], `${what}: drawn (every item the tab draws, with its kind and its text)`).map((v, i) => { const d = obj(v, `${what}: drawn[${i}]`); return { id: str(d['id'], 'id'), kind: str(d['kind'], 'kind'), text: str(d['text'] ?? '', 'text') }; }),
    controls: arr(r['controls'], `${what}: controls`).map((v, i) => str(obj(v, `${what}: controls[${i}]`)['label'], 'label')),
  };
}
function tabsOf(reply: JsonObject | undefined, what: string): string[] {
  return arr(obj(reply, what)['tabs'], `${what}: tabs`).map((v, i) => str(obj(v, `${what}: tabs[${i}]`)['tab'], 'tab'));
}

/** The session page of alpha at t, its terminal tab, and the updates the tab made, from a 60/s feed into alpha's terminal. */
function hosted(bin: string, planted?: string): { tabs: string[]; tab: Tab; updates: ReturnType<typeof updatesOf> } {
  const d = new Driver(bin, world(planted));
  const end = T0 + N * STEP + SEC;
  const r = d.step([
    openCall(SEC, 'T1', { session: ALPHA.id, cols: 120, rows: ROWS, feed: FEED }),
    at('session_page', 2 * SEC, { session: ALPHA.id, panel: 'page' }),
    at('tab', end, { session: ALPHA.id, tab: 'terminal' }),
    at('updates', end, { session: ALPHA.id, tab: 'terminal' }),
  ], `alpha's terminal tab${planted ? ` (planted ${planted})` : ''}`);
  return { tabs: tabsOf(r[1], 'the session page'), tab: tabOf(r[2], 'the terminal tab'), updates: updatesOf(r[3], 'the tab\'s updates') };
}

/** "The tab draws the terminal through the cell grid": the last lines show in a `cells@1` item and in no other kind. */
function throughGridProblems(tab: Tab): string[] {
  const f: string[] = [];
  const last = [lineText(N), lineText(N - 1), lineText(N - 5)];
  const inGrid = tab.drawn.filter((x) => x.kind === 'cells@1');
  if (!inGrid.length) f.push(`the ${tab.tab} tab draws no cell grid`);
  for (const l of last) if (!inGrid.some((x) => x.text.includes(l))) f.push(`the ${tab.tab} tab's cell grid doesn't show ${l}`);
  for (const x of tab.drawn.filter((y) => y.kind !== 'cells@1')) {
    const leaked = last.find((l) => x.text.includes(l)) ?? (/L\d{8} /.test(x.text) ? 'a numbered line' : null);
    if (leaked) f.push(`the ${tab.tab} tab draws the terminal's text (${leaked}) outside the cell grid, in the ${x.kind} item ${x.id}`);
  }
  return f;
}

describe('AC8 the session page\'s terminal tab draws the terminal through the cell grid and keeps up at 60 updates a second', () => {
  it('AC8 the page has its line, asks and checks tabs and, with them, a terminal tab', () => {
    const { tabs } = hosted(show());
    expect(tabs.filter((t) => t === 'terminal'), 'one terminal tab').toHaveLength(1);
    const shipped = tabs.filter((t) => ['line', 'asks', 'checks'].includes(t));
    expect(shipped, 'the line, asks and checks tabs R1 ships stay, in their order').toEqual(['line', 'asks', 'checks']);
  }, 600_000);

  it('AC8 fed a 60 a second terminal stream, the tab draws it in a cell grid (the last lines show there and in no other kind of item) and presents each update within its frame; a tab that draws the text outside the grid fails, naming the tab; one that redraws at 30 a second fails, naming the update', () => {
    const run = hosted(show());
    expect(run.tab.tab, 'the tab is the terminal tab').toBe('terminal');
    expect(run.tab.hosted, 'a hosted terminal').toBe(true);
    expect(throughGridProblems(run.tab), 'drawn through the cell grid, nowhere else').toEqual([]);
    expect(keepUpProblems(run.updates, arrivals, A, 'the terminal tab'), 'every update presented in its frame').toEqual([]);
    const text = throughGridProblems(hosted(show(), 'tab_draws_text').tab);
    expect(text.some((m) => m.startsWith('the terminal tab draws the terminal\'s text')), `the planted tab_draws_text fails, naming the tab: ${JSON.stringify(text.slice(0, 2))}`).toBe(true);
    const slow = keepUpProblems(hosted(show(), 'tab_redraws_at_30hz').updates, arrivals, A, 'the terminal tab');
    expect(slow.some((m) => m.startsWith('the terminal tab: update ')), `the planted tab_redraws_at_30hz fails, naming the update: ${JSON.stringify(slow.slice(0, 2))}`).toBe(true);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------------

/** "Only the line naming where it runs, with Open": no grid, no image, none of the other terminal's screen. */
function notHostedProblems(tab: Tab): string[] {
  const f: string[] = [];
  const all = tab.drawn.map((x) => x.text).join('\n');
  if (!all.includes(RUNS_IN)) f.push(`the ${tab.tab} tab doesn't say where the session runs (${RUNS_IN})`);
  for (const x of tab.drawn) if (x.kind.startsWith('cells') || x.kind.startsWith('image') || x.kind.startsWith('screen')) f.push(`the ${tab.tab} tab draws a captured screen of the other terminal: ${x.kind} item ${x.id}`);
  for (const l of CAPTURE) if (all.includes(l.slice(0, 20))) f.push(`the ${tab.tab} tab draws a captured screen of the other terminal: its text "${l.slice(0, 20)}…" is on the tab`);
  if (!tab.controls.some((c) => c.trim().toLowerCase() === 'open')) f.push(`the ${tab.tab} tab has no Open (it has ${JSON.stringify(tab.controls)})`);
  if (tab.hosted) f.push(`the ${tab.tab} tab says the terminal is hosted`);
  return f;
}
function unhosted(bin: string, planted?: string): { tabs: string[]; tab: Tab } {
  const d = new Driver(bin, world(planted));
  const r = d.step([at('session_page', SEC, { session: BETA.id, panel: 'page' }), at('tab', 2 * SEC, { session: BETA.id, tab: 'terminal' })], `beta's terminal tab${planted ? ` (planted ${planted})` : ''}`);
  return { tabs: tabsOf(r[0], 'beta\'s page'), tab: tabOf(r[1], 'beta\'s terminal tab') };
}

describe('AC9 a session in a terminal the hub doesn\'t host shows only the line naming where it runs, with Open', () => {
  it('AC9 beta\'s terminal tab says where it runs and has Open, and draws no grid, no image and none of the other terminal\'s screen; a tab that draws the captured screen fails, naming the tab', () => {
    const r = unhosted(show());
    expect(r.tabs, 'the page still has the terminal tab for a session the hub doesn\'t host').toContain('terminal');
    expect(r.tab.tab, 'the tab is the terminal tab').toBe('terminal');
    expect(notHostedProblems(r.tab), 'only the line, with Open').toEqual([]);
    const twin = notHostedProblems(unhosted(show(), 'tab_draws_capture').tab);
    expect(twin.some((m) => m.startsWith('the terminal tab draws a captured screen of the other terminal')), `the planted tab_draws_capture fails, naming the tab: ${JSON.stringify(twin.slice(0, 2))}`).toBe(true);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------------
// SCOPE: the palette rule that keeps cells off the status colors

describe('SCOPE on a session\'s page a terminal\'s color inside the status distance becomes the nearest allowed one; in a plug-in\'s panel it is drawn as asked', () => {
  it('SCOPE the look\'s fail color, asked for in truecolor, is moved off the status colors in the tab (at least the look\'s min_distance from each, near the one asked) and drawn as asked in the plug-in\'s panel', () => {
    const { colors, min } = cleanStatus();
    const [r, g, b] = colors['fail']!;
    const feed = [{ at: T0, text: `\u001b[38;2;${r};${g};${b}mX\u001b[0m` }];
    const d = new Driver(show(), world(undefined, true));
    const t = T0 + SEC;
    const rep = d.step([
      openCall(SEC, 'T1', { session: ALPHA.id, cols: 40, rows: 10, feed }), openCall(SEC, 'T2', { panel: 'screen', cols: 40, rows: 10, feed }),
      at('cell', t, { session: ALPHA.id, tab: 'terminal', x: 0, y: 0 }), at('cell', t, { terminal: 'T2', x: 0, y: 0 }),
    ], 'a cell in the look\'s fail color');
    const onPage = cellOf(rep[2], 'the cell on the session\'s page'), inPanel = cellOf(rep[3], 'the cell in the plug-in\'s panel');
    expect(onPage.g).toBe('X');
    const shown = hexRgb(onPage.fg);
    for (const [name, c] of Object.entries(colors)) expect(distance(shown, c), `on the page the cell's color is at least ${min} from the ${name} color`).toBeGreaterThanOrEqual(min - 1e-3);
    expect(distance(shown, [r, g, b]), 'and it is the nearest allowed color, not a far one').toBeLessThanOrEqual(0.2);
    expect(inPanel.fg.toLowerCase(), 'in a plug-in\'s panel, where no status shows, the color is as the program asked').toBe(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  });
});

