// #1003 AC3's last clause: "a program that sets its own true-color text at 1.5:1 is drawn exactly as sent". The
// program's bytes go to a terminal through `deep-show run` (#402's surface: `terminal_open` with a recorded `feed`, then
// `cell`, which answers one cell as drawn, after the status rule; README: The surface). These are the bytes, the
// scenario and the judge of the cells' answers; cells.test.mjs runs them, wrong.test.mjs feeds the judge made-up answers.
import { contrast, distance, parseColor } from './common.mjs';

/**
 * The colors the program sends, each pair 1.5:1 (foreground on its own background), dark and far (OKLab ≥ 0.19) from the
 * base's status colors, so the status rule on a session's page has no reason to move them; cells.test.mjs checks they
 * keep 0.1 from the shipped clean look's status colors too.
 */
export const PAIRS = [
  { fg: '#2c2c2c', bg: '#000000' }, // gray on black
  { fg: '#2a2c66', bg: '#0c0c2a' }, // navy on deep navy
];

const sgr = (h, layer) => {
  const [r, g, b] = parseColor(h).rgb;
  return `\u001b[${layer};2;${r};${g};${b}m`;
};
/** Row y: `XY` in the pair's true colors, then a reset. */
export const bytesFor = (pair) => `${sgr(pair.fg, 38)}${sgr(pair.bg, 48)}XY\u001b[0m`;

/** The pairs' contrast as sent (the suite's own check that they are 1.5:1). */
export const pairRatios = () => PAIRS.map((p) => contrast(parseColor(p.fg).rgb, parseColor(p.bg).rgb));

// #400/#401/#402's scenario constants (tests/acceptance/401/helpers.ts, 402/helpers.ts), restated in JavaScript.
const FLICKS = 705_600_000;
const MS = FLICKS / 1000;
const A = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
const B = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: billing', process: { pid: 4100, start: 1_000 } };
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];

/**
 * One scenario: a terminal on a session's page (where status shows) and one in a plug-in's panel (where it doesn't),
 * each fed the pairs on rows 0 and 1, then each cell asked as drawn. Replies: [install, open, open, then per home
 * and pair the cells x=0 and x=1].
 */
export function scenario(evidence) {
  const feed = [{ at: 10 * MS, text: PAIRS.map(bytesFor).join('\r\n') }];
  const calls = [
    { call: 'install', at: 1, plugin: 'terminals', manifest: { panels: { term: { raw_input: true, tree: [{ id: 'screen', component: 'cells', terminal: 't-panel' }] } } } },
    { call: 'terminal_open', at: 2 * MS, terminal: 't-session', session: ALPHA.id, cols: 20, rows: 4, feed },
    { call: 'terminal_open', at: 3 * MS, terminal: 't-panel', panel: 'term', cols: 20, rows: 4, feed },
  ];
  const asked = [];
  let t = 200 * MS;
  for (const home of ['session', 'panel']) {
    PAIRS.forEach((pair, y) => {
      for (const x of [0, 1]) {
        calls.push({ call: 'cell', at: t, terminal: `t-${home}`, x, y });
        asked.push({ home, pair, x, y });
        t += MS;
      }
    });
  }
  return {
    scenario: {
      evidence, sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } }, processes: PROCESSES,
      clock: { lead: 2 * MS, check: MS / 2 }, displays: [A, B], window: [1200, 700], panels: { term: { rect: [0, 0, 400, 350] } }, calls,
    },
    asked,
  };
}

/** The cells' answers (`replies` after the three set-up calls) judged against what was sent; one line per miss. */
export function judgeCells(asked, replies) {
  const failures = [];
  asked.forEach(({ home, pair, x, y }, i) => {
    const got = replies[i];
    const where = `the ${home === 'session' ? "session page's" : "panel's"} terminal, cell (${x}, ${y})`;
    if (!got || typeof got.fg !== 'string') {
      failures.push(`${where}: no cell answer: ${String(JSON.stringify(got)).slice(0, 200)}`);
      return;
    }
    if (got.g !== 'XY'[x]) failures.push(`${where}: holds ${JSON.stringify(got.g)}, not ${'XY'[x]}`);
    if (got.fg.toLowerCase() !== pair.fg || got.bg.toLowerCase() !== pair.bg) {
      failures.push(`${where}: sent ${pair.fg} on ${pair.bg} (1.5:1), drawn ${got.fg} on ${got.bg}`);
    }
  });
  return failures;
}

/** The pairs' distance from a status map (the suite's own check, run on each shipped look's statuses). */
export const nearestStatus = (status) => Math.min(...PAIRS.flatMap((p) => [p.fg, p.bg]).flatMap((h) => Object.values(status).map((s) => distance(parseColor(h).rgb, parseColor(s).rgb))));
