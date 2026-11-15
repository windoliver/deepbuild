// #1968's budgets, the `code-film` mode of benchmarks/canvas.mjs (task `canvas-code-film`), criterion 2: a release
// deep-show presents five documents by the agent's session and reads `frames`, one warm-up and five runs, each a fresh
// process.
// - tokens_2000_lines_ms: a 2,000-line code item's tokens mapped to runs as a change to it maps them, its display form,
//   its tokens' spans and their runs in the look (`frames`' `timings`: `tokens[].ms`); the median of five frames.
// - diff_400_lines_ms: two 400-line versions under a text_diff, read and aligned as the check aligns them (`aligns[].ms`),
//   edits spread from the first line to the last; the median of five frames.
// - seek_10_min_ms: a board whose cell grid plays a ten-minute terminal recording, one frame at each of five times out of
//   order, each a seek; the slowest frame's scheduler time.
// - still_code_steps: a film with a dot moving every frame, with a still code item and without it: the nodes frames 2 to
//   6 run with it beyond those they run without it (a count, judged on any machine).
// Every text is ASCII with no digit, so honest numbers counts nothing.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FLICKS = 705_600_000;
const DOCS = ['tokens', 'diff', 'seek', 'still', 'bare'];
const DOC = (name) => `01JB1968B${String(DOCS.indexOf(name) + 1).padStart(17, '0')}`;
const SESSIONS = { s1: { thread: 'thread-1968', name: 'Claude Code: code film', process: { pid: 4100, start: 1_000 } } };
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
const SEEKS = [570, 135, 465, 50, 305];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** A number as a word: its digits as syllables. */
const SYLLABLES = ['ka', 'lo', 'mi', 'nu', 'pe', 'ra', 'si', 'tu', 'vo', 'ze'];
const word = (n) => String(n).split('').map((d) => SYLLABLES[Number(d)]).join('');
const KEYWORDS = new Set(['def', 'if', 'is', 'or', 'return', 'None']);
/** One token per word, string, comment, operator or punctuation mark, classed. */
const tokensOf = (raw) => [...raw.matchAll(/#[^\n]*|"[^"\n]*"|[A-Za-z_]+|[=+]|[^\sA-Za-z_]/g)].map((m) => {
  const s = m[0];
  const cls = s.startsWith('#') ? 'comment' : s.startsWith('"') ? 'string' : KEYWORDS.has(s) ? 'keyword'
    : /^[A-Za-z_]/.test(s) ? (raw[m.index + s.length] === '(' ? 'function' : 'variable') : /^[=+]$/.test(s) ? 'operator' : 'punctuation';
  return { from: m.index, to: m.index + s.length, class: cls };
});
/** Function k: eight lines. */
const fn = (k) => [
  `def handle_${word(k)}(request, context):`,
  `    # answer a request for ${word(k)}`,
  `    value = request.get("${word(k)}") or context.default`,
  '    if value is None:',
  '        return context.fallback(request)',
  '    total = value + context.offset',
  '    context.log("handled", total)',
  '    return total',
];
const lines = (n) => Array.from({ length: n / 8 }, (_, k) => fn(k)).flat();
/** The 400 lines edited from the first to the last: a renamed local in every fifth function, a line inserted in every
 * seventh, a comment deleted in every ninth. */
function edited(source) {
  const out = [];
  source.forEach((line, i) => {
    const [k, j] = [Math.floor(i / 8), i % 8];
    if (k % 9 === 4 && j === 1) return;
    out.push(k % 5 === 0 ? line.replace(/total/g, 'amount') : line);
    if (k % 7 === 3 && j === 3) out.push('        context.trace(request)');
  });
  return out;
}
const code = (id, text, pos, o = {}) => ({
  id, kind: 'text@1', name: `Code ${id}`, order: `c${id}`, at: { pos: [...pos, 0] },
  params: { font: 'mono', size: o.size ?? 12, paint: { fill: { role: 'ink' } }, raw: text,
    code: { language: 'python', tokens: tokensOf(text), ...(o.numbers === false ? { numbers: false } : {}), ...(o.highlight ? { highlight: [{ lines: o.highlight }] } : {}) } },
});
const cam = (size) => ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } });
const film = (id, title, items, extra = {}) => ({
  format: 1, id, profile: 'film', title, description: `${title}: a fixture of the code film's budgets.`, size: [640, 360], camera: 'cam', transport: { span: '2s' },
  items: Object.fromEntries([cam([640, 360]), ...items].map((i) => [i.id, i])), ...extra,
});

/** A ten-minute test run as a terminal recording (#1967's format): the size, then a line every quarter second. */
function recording() {
  const out = [JSON.stringify({ cols: 80, rows: 24 })];
  for (let k = 1; k < 600 * 4; k++) {
    const text = k % 40 === 0 ? `\u001b[1;32mpassed ${word(k)}\u001b[0m\r\n` : `test_${word(k)} \u001b[32mPASSED\u001b[0m\r\n`;
    out.push(JSON.stringify({ at: Math.round((k * FLICKS) / 4), text }));
  }
  return Buffer.from(`${out.join('\n')}\n`, 'utf8');
}
const TERMINAL_ROLES = ['', 'bright_'].flatMap((b) => ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].map((c) => `term_${b}${c}`));
const board = (sha) => ({
  format: 1, id: 'code-film-seek', profile: 'board', title: 'A long test run', description: 'A test run replayed from a long terminal recording.',
  size: [640, 400], transport: { span: '600s', frame_rate: [30, 1] }, requires: { modules: { cells: '^1' } },
  items: {
    run: { id: 'run', kind: 'cells@1', name: 'Test run', order: 'a1', at: { pos: [0, 8, 0] },
      params: { size: { cols: 80, rows: 24, cell: [8, 16] }, font: { family: 'mono', size: 13, fallback: [], ligatures: false },
        palette: { fg: 'ink', bg: 'ground', ansi: TERMINAL_ROLES, truecolor: true }, play: { asset: sha, start: '0s', in: 0, rate: [1, 1] } } },
  },
  assets: { rec: { sha256: sha, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Benchmark fixture made by benchmarks/code-film.mjs.' } } },
});

/** The still code item: a function in eight token roles, its lines numbered, lines 3 to 5 highlighted. */
const SHOWN = [
  'def greet(names: list, loud: bool) -> None:',
  '    # say hello to every name',
  '    for name in names:',
  '        line = "hello, " + name',
  '        if loud:',
  '            line = line.upper()',
  '        print(line)',
].join('\n') + '\n';
function still(withCode) {
  const dot = { id: 'dot', kind: 'rect@1', name: 'Dot', order: 'b0', params: { box: [0, 0, 12, 12], paint: { fill: { role: 'ink' } } }, at: { pos: [20, 330, 0] } };
  const key = (t, x) => ({ t, value: [x, 330, 0], interp: 'linear' });
  return film(withCode ? 'still-code' : 'no-code', withCode ? 'A still function beside a moving dot' : 'A moving dot', [dot, ...(withCode ? [code('shown', SHOWN, [60, 60], { size: 18, highlight: [3, 5] })] : [])], {
    channels: { slide: { target: 'items/dot/at/pos', type: 'vec3', keys: { k0: key('0s', 20), k1: key('2s', 600) } } },
  });
}

/** The scenario of one run, its recording put in the evidence store `dir`. */
export function scenario(dir) {
  const bytes = recording();
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(dir, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(dir, sha.slice(0, 2), sha.slice(2)), bytes);
  const source = lines(400);
  const documents = {
    tokens: { format: 1, id: 'code-film-tokens', profile: 'board', title: 'A long file', description: 'A long file as a code item.', size: [1280, 720],
      items: { file: code('file', `${lines(2000).join('\n')}\n`, [20, 20]) } },
    diff: film('code-film-diff', 'A file before and after', [code('old', `${source.join('\n')}\n`, [20, 20], { numbers: false }), code('new', `${edited(source).join('\n')}\n`, [20, 20], { numbers: false })],
      { transitions: { edit: { from: 'old', to: 'new', kind: 'text_diff', at: '1s', span: '1s', progress: 'linear' } } }),
    seek: board(sha), still: still(true), bare: still(false),
  };
  const show = (name) => ({ call: 'deep_show', session: 's1', doc: DOC(name), document: documents[name] });
  const frames = (name, o) => ({ call: 'frames', doc: DOC(name), ...o });
  const calls = {
    ...Object.fromEntries(DOCS.map((d) => [`shown:${d}`, show(d)])),
    tokens: frames('tokens', { count: 5, timings: true }), aligns: frames('diff', { count: 5, timings: true }),
    // The board plays from 0 s first, so each frame after it is a seek of a playing grid.
    warm: frames('seek', { count: 1 }), ...Object.fromEntries(SEEKS.map((s) => [`seek:${s}`, frames('seek', { from: `${s}s`, count: 1 })])),
    still: frames('still', { count: 6, step: '1f' }), bare: frames('bare', { count: 6, step: '1f' }),
  };
  const panels = Object.fromEntries(DOCS.map((d, i) => [`p${i + 1}`, { rect: [0, 0, 1280, 720] }]));
  const docs = Object.fromEntries(DOCS.map((d, i) => [DOC(d), { panel: `p${i + 1}` }]));
  return { evidence: dir, sessions: SESSIONS, processes: PROCESSES, panels, docs, calls: ORDER.map((name) => calls[name]) };
}
/** The calls of a run, in order. */
const ORDER = ['shown:tokens', 'tokens', 'shown:diff', 'aligns', 'shown:seek', 'warm', ...SEEKS.map((s) => `seek:${s}`), 'shown:still', 'still', 'shown:bare', 'bare'];

/** One run's readings from its answer. */
export function readings(answer) {
  const reply = (name) => answer.replies?.[ORDER.indexOf(name)] ?? {};
  if (answer.ok !== true || DOCS.some((d) => reply(`shown:${d}`).outcome !== 'presented')) throw Error(`deep-show answered ${JSON.stringify(answer).slice(0, 2000)}`);
  const frames = (name) => reply(name).frames ?? [];
  const tokens = frames('tokens').map((f) => f.tokens?.[0]?.ms);
  const aligns = frames('aligns').map((f) => f.aligns?.[0]?.ms);
  const seeks = SEEKS.map((s) => frames(`seek:${s}`)[0]?.scheduler_ms);
  const [withCode, without] = [frames('still'), frames('bare')].map((fs) => fs.map((f) => f.ran));
  const readable = [...tokens, ...aligns, ...seeks].every(Number.isFinite) && withCode.length === 6 && without.length === 6;
  if (!readable) throw Error(`a reading is missing: ${JSON.stringify({ tokens, aligns, seeks, withCode, without })}`);
  return {
    tokens_2000_lines_ms: median(tokens), diff_400_lines_ms: median(aligns), seek_10_min_ms: Math.max(...seeks),
    still_code_steps: withCode.slice(1).reduce((n, ran, k) => n + Math.max(0, ran - without[k + 1]), 0),
    tokens_ms: tokens, aligns_ms: aligns, seeks_ms: seeks, still_ran: { with: withCode, without },
  };
}

export function codeFilm({ release, once, runs }) {
  const fingerprint = release('deep-show', 'deep-show');
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const measured = runs(() => readings(once('deep-show', ['run'], scenario(dir))));
    console.log(JSON.stringify({ task: 'canvas-code-film', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
