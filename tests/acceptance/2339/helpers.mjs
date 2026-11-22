// Helpers for #2339's acceptance tests: a reading of the design's "Principles" section and of AGENTS.md's four
// invariants, a scratch copy of the checkout with a fake `gh` on PATH, the planted section and its planted faults, and a
// run of the design links lane's commands as the copy's own scripts/lanes.mjs lists them.
// The approach follows tests/acceptance/1329/helpers.mjs and tests/acceptance/910/helpers.mjs (copied here, never
// imported). README: The surface.
import { spawnSync } from 'node:child_process';
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const DESIGN = 'docs/technical-design.md';
export const CANVAS = 'docs/canvas-primitives.md';
export const BLOB = 'https://github.com/windoliver/deepbuild/blob/main/';
export const NEXT_HEADING = 'What version 0 builds, and what waits';
export const CONVENTIONS = 'Conventions every primitive uses';

// The design links lane, as #910's and #1329's suites pick it: the one entry of `checks` whose name matches this and not
// /catalogue|drift/i. At the base it is `design links and names`.
export const LINKS_LANE = { match: /\blinks?\b/i, not: /catalogue|drift/i };

// ---------------------------------------------------------------------------------------------------------------
// Reading markdown

// The lines outside fenced code, numbered from 1.
function* prose(text) {
  let fence;
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
    } else if (mark) fence = mark[1];
    else yield { number: i + 1, line };
  }
}

/** A line's text as it renders: no list marker, links and images by their label, code spans by their text, no tags or emphasis, white space collapsed. */
export function render(raw) {
  const codes = [];
  let text = raw.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/, '').replace(/(`+)(.+?)\1/g, (_, __, code) => `\u0000${codes.push(code.trim()) - 1}\u0000`);
  text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/\*\*|__|(?<![\w\\])[*_](?=\S)|(?<=\S)[*_](?!\w)/g, '');
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]).replace(/\s+/g, ' ').trim();
}

/**
 * Sentence ends in a line's rendered text, code spans left out: a `.`, `!` or `?` (with any closing quote or bracket)
 * followed by white space or the end of the line. "One sentence" is at most one of them.
 */
export function sentenceEnds(raw) {
  const text = render(raw.replace(/(`+)(.+?)\1/g, 'code'));
  return [...text.matchAll(/[.!?]+["'’”)\]]*(?=\s|$)/g)].length;
}

/** The characters a line counts toward its 160: its rendered text's code points. */
export const length = (raw) => [...render(raw)].length;

const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');

/** A doc's headings, in order: their file line, level, rendered text, slug (GitHub's, with the -1, -2 rule), and the <a id>s right before each. */
export function headings(text) {
  const found = [];
  const slugs = new Set();
  let waiting = [];
  for (const { number, line } of prose(text)) {
    const ids = [...line.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/);
    if (heading) {
      const title = render(heading[2]);
      let id = slug(title);
      for (let n = 1; slugs.has(id); n++) id = `${slug(title)}-${n}`;
      slugs.add(id);
      found.push({ number, level: heading[1].length, title, slug: id, ids: [...waiting, ...ids] });
      waiting = [];
    } else if (ids.length && !line.replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '').trim()) waiting.push(...ids);
    else if (line.trim()) waiting = [];
  }
  return found;
}

const ITEM = /^\s{0,3}(?:[-*+]|\d+[.)])\s+/;

/**
 * The design's "Principles" section: its heading (a level-2 heading whose text is "Principles"), the headings before
 * and after it, and its lines: each list item, with any continuation line joined to it, and the file line it starts on.
 * Null when the doc has no such heading.
 */
export function principles(text) {
  const all = headings(text);
  const at = all.findIndex((h) => h.level === 2 && /^principles$/i.test(h.title));
  if (at < 0) return null;
  const heading = all[at];
  const end = all[at + 1]?.number ?? Infinity;
  const lines = [];
  let open = false;
  for (const { number, line } of prose(text)) {
    if (number <= heading.number || number >= end) continue;
    if (ITEM.test(line)) {
      lines.push({ number, raw: line.trim() });
      open = true;
    } else if (!line.trim()) open = false;
    else if (open) lines.at(-1).raw += ` ${line.trim()}`;
  }
  for (const line of lines) line.text = render(line.raw);
  return { heading, before: all.slice(0, at), after: all[at + 1], lines, anchors: [heading.slug, ...heading.ids] };
}

/** AGENTS.md's four invariants: the numbered items under "The four invariants", with their file line and rendered text. */
export function invariants(text) {
  const all = headings(text);
  const at = all.find((h) => /four invariants/i.test(h.title));
  if (!at) return [];
  const end = all.find((h) => h.number > at.number)?.number ?? Infinity;
  const found = [];
  for (const { number, line } of prose(text)) {
    if (number > at.number && number < end && /^\s{0,3}\d+[.)]\s+/.test(line)) found.push({ number, raw: line.trim().replace(ITEM, ''), text: render(line) });
  }
  return found;
}

// Link targets on a line outside code spans: markdown links' targets and bare links into this repo.
function targets(raw) {
  const text = raw.replace(/(`+).+?\1/g, '');
  const linked = [...text.matchAll(/\]\(\s*<?([^\s)>]+)/g)].map((m) => m[1]);
  const bare = text.replace(/\]\(\s*<?[^\s)>]+/g, '').split(BLOB).slice(1).map((rest) => BLOB + rest.match(/^[^\s)>\]"'`]*/)[0].replace(/[.,:;!?*_~]+$/, ''));
  return [...linked, ...bare];
}

/** Where a target on a line of `from` (a repo path) points: the repo path and anchor, or null for a link outside the repo. */
export function resolveTarget(target, from) {
  const [, path, anchor = ''] = target.match(/^([^#?]*)(?:\?[^#]*)?(?:#(.*))?$/);
  let file;
  if (path.startsWith(BLOB)) file = path.slice(BLOB.length);
  else if (/^[a-z][\w+.-]*:/i.test(path)) return null;
  else file = path ? posix.normalize(posix.join(posix.dirname(from), path)) : from;
  let id = anchor;
  try { id = decodeURIComponent(anchor); } catch { /* compared as written */ }
  return { file, id };
}

/** A line's links into the design: to docs/technical-design.md or docs/canvas-primitives.md, with an anchor. */
export const designLinks = (raw, from = DESIGN) => targets(raw).map((t) => resolveTarget(t, from)).filter((l) => l && [DESIGN, CANVAS].includes(l.file) && l.id);

/**
 * The checks a line names: each code span whose first word is a path under scripts/, each link to a path under
 * scripts/, and each code span whose whole text is a lane name `lanes` holds.
 */
export function namedChecks(raw, lanes, from = DESIGN) {
  const spans = [...raw.matchAll(/(`+)(.+?)\1/g)].map((m) => m[2].trim());
  const scripts = new Set([
    ...spans.map((s) => s.split(/\s+/)[0].replace(/^\.\//, '')).filter((s) => s.startsWith('scripts/')),
    ...targets(raw).map((t) => resolveTarget(t, from)?.file).filter((f) => f?.startsWith('scripts/')),
  ]);
  return { scripts: [...scripts], lanes: spans.filter((s) => lanes.includes(s)) };
}

/** The names of the lanes in the list `scripts/lanes.mjs` exports as `checks`, read in a child process at `repo`. */
export function laneNames(repo = CHECKOUT) {
  const program = `const { checks } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)}); console.log(JSON.stringify(checks.map((l) => l.name)));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not read the lanes scripts/lanes.mjs lists: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').at(-1));
}

/** True when `path` (repo-relative) is a file in `repo`. */
export const isFile = (repo, path) => existsSync(join(repo, path)) && statSync(join(repo, path)).isFile();

// ---------------------------------------------------------------------------------------------------------------
// The planted section

// Each non-invariant line of the planted section: one sentence, a link into the design, a check that exists. Line 7
// names a lane (`unit`, in `checks` at the base); the rest name files under scripts/.
const MORE = [
  'Agents and plug-ins write data, not code ([Rules every primitive follows](#prim-rules), `scripts/canvas-lint.mjs`).',
  'A mistake is refused with its fix and never only warned about ([Built to be hard to get wrong](#built-to-be-hard-to-get-wrong), `scripts/repo-rules.mjs`).',
  'The same input gives the same bytes ([Decided](#decided), `unit`).',
  'A test counts only if it fails on a wrong program ([How runs become one of five verdicts](#how-runs-become-one-of-five-verdicts), `scripts/proof-change.mjs`).',
  'Every wait has a budget a test holds ([Decided](#decided), `scripts/wait-ratchet.mjs`).',
  'A decision is written with what would reopen it ([Cut, or deferred](#cut-or-deferred), `scripts/design-links.mjs`).',
];
// The link and check each invariant's line carries after the invariant's own words.
const HOLDS = [
  '([How runs become one of five verdicts](#how-runs-become-one-of-five-verdicts), `scripts/proof.mjs`)',
  '([How runs become one of five verdicts](#how-runs-become-one-of-five-verdicts), `scripts/proof.mjs`)',
  '([Built to be hard to get wrong](#built-to-be-hard-to-get-wrong), `scripts/proof-change.mjs`)',
  '([Decided](#decided), `scripts/proof.mjs`)',
];

/**
 * The planted section's ten lines, numbered 1. to 10.: the copy's own four invariants word for word (as its AGENTS.md
 * has them), each with a link and a check, then six lines. `replace` swaps line n (1-based) for the text given.
 */
export function plantedLines(agents, replace = {}) {
  const four = invariants(agents);
  if (four.length !== 4) throw new Error(`AGENTS.md has ${four.length} invariants under "The four invariants", not 4`);
  const lines = [...four.map((inv, i) => `${inv.raw} ${HOLDS[i]}`), ...MORE];
  for (const [n, text] of Object.entries(replace)) lines[Number(n) - 1] = text;
  return lines.map((line, i) => `${i + 1}. ${line}`);
}

/**
 * Puts the planted section into a design doc's text: in place of its "Principles" section when it has one (the heading
 * and its body, up to the next heading's <a id>s), else right before "What version 0 builds, and what waits" and the
 * <a id>s above it. Returns the new text.
 */
export function plantSection(text, lines) {
  const block = ['## Principles', '', ...lines, ''];
  const rows = text.split('\n');
  const all = headings(text);
  const startOf = (h) => {
    let i = h.number - 1;
    while (i > 0 && (!rows[i - 1].trim() || /^\s*(?:<a\s[^>]*>(?:\s*<\/a>)?\s*)+$/i.test(rows[i - 1]))) i--;
    return i;
  };
  const at = all.findIndex((h) => h.level === 2 && /^principles$/i.test(h.title));
  if (at >= 0) {
    const end = all[at + 1] ? startOf(all[at + 1]) : rows.length;
    rows.splice(at >= 0 ? all[at].number - 1 : 0, end - (all[at].number - 1), ...block);
  } else {
    const next = all.find((h) => h.level === 2 && h.title === NEXT_HEADING);
    if (!next) throw new Error(`the design has no "## ${NEXT_HEADING}" heading`);
    rows.splice(startOf(next), 0, ...block);
  }
  return rows.join('\n');
}

/**
 * Puts `opening` (lines, maybe none) as the whole opening of the canvas reference's "Conventions every primitive uses":
 * between its heading and its first subheading, in place of what is there.
 */
export function plantConventionsOpening(text, opening) {
  const rows = text.split('\n');
  const all = headings(text);
  const at = all.findIndex((h) => h.title === CONVENTIONS);
  if (at < 0) throw new Error(`the canvas reference has no "${CONVENTIONS}" heading`);
  let end = all[at + 1].number - 1;
  while (end > all[at].number && /^\s*(?:<a\s[^>]*>(?:\s*<\/a>)?\s*)+$/i.test(rows[end - 1])) end--;
  rows.splice(all[at].number, end - all[at].number, '', ...opening.flatMap((line) => [line, '']));
  return rows.join('\n');
}

/** The opening link the planted canvas reference carries: one link to the planted section. */
export const CANVAS_LINK = 'The ideas these conventions follow are stated once, in the design\'s [Principles](technical-design.md#principles).';

// ---------------------------------------------------------------------------------------------------------------
// The scratch copy, gh and the lane

/**
 * A sandbox under the OS temp folder, removed after the test. `repo/` is a copy of this checkout's working tree (tracked
 * files and untracked files git doesn't ignore), node_modules linked when the checkout has one,
 * an empty planned-names list (the checkout's names real issues the fake tracker doesn't hold), and a fake `gh`.
 */
export function makeCopy(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2339-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const r = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  for (const file of r.stdout.split('\0').filter(Boolean)) {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  if (existsSync(join(CHECKOUT, 'node_modules'))) symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  writeFileSync(join(repo, 'scripts', 'planned-names.txt'), '# Emptied by #2339\'s acceptance tests: the fake tracker plans no names.\n');
  for (const dir of ['home', 'tmp', 'cache', 'config', 'bin']) mkdirSync(join(sandbox, dir));
  fakeGh(sandbox);
  return { sandbox, repo, env: sandboxEnv(sandbox) };
}

/** Reads or writes a file of the copy. */
export const readRepo = (repo, path) => readFileSync(join(repo, path), 'utf8');
export const writeRepo = (repo, path, text) => writeFileSync(join(repo, path), text);

// Three clean open issues, each linking a real heading of the base's design and naming no `deep` command or tool.
const ISSUES = [
  { number: 9903, title: 'Fixture issue 9903', body: `A clean fixture issue for #2339's tests.\n\n**Design:** [Decided](${BLOB}docs/technical-design.md#decided)` },
  { number: 9902, title: 'Fixture issue 9902', body: `A clean fixture issue for #2339's tests.\n\n**Design:** [Rules every primitive follows](${BLOB}docs/technical-design.md#prim-rules)` },
  { number: 9901, title: 'Fixture issue 9901', body: `A clean fixture issue for #2339's tests.\n\n**Design:** [The conventions](${BLOB}docs/canvas-primitives.md#conventions)` },
];

// A fake `gh` first on PATH: `gh issue list … --json <fields>` from ISSUES (cut to --limit/-L, 30 without), `gh auth
// status` and `gh --version`; anything else fails.
function fakeGh(sandbox) {
  const data = join(sandbox, 'gh-issues.json');
  writeFileSync(data, JSON.stringify(ISSUES));
  const script = `#!${process.execPath}
const { readFileSync } = require('node:fs');
const args = process.argv.slice(2);
const value = (...names) => { for (let i = 0; i < args.length; i++) for (const n of names) { if (args[i] === n) return args[i + 1]; if (args[i].startsWith(n + '=')) return args[i].slice(n.length + 1); } };
if (args[0] === '--version') { console.log('gh version 2.99.0 (fake, #2339 acceptance tests)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log('github.com\\n  Logged in to github.com (fake)'); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'list' && value('--json')) {
  const keep = value('--json').split(',').map((f) => f.trim());
  const issues = JSON.parse(readFileSync(${JSON.stringify(data)}, 'utf8')).slice(0, Number(value('--limit', '-L') ?? 30));
  console.log(JSON.stringify(issues.map((i) => Object.fromEntries(keep.filter((k) => k in i).map((k) => [k, i[k]])))));
  process.exit(0);
}
console.error('fake gh: unsupported command: gh ' + args.join(' '));
process.exit(1);
`;
  writeFileSync(join(sandbox, 'bin', 'gh'), script);
  chmodSync(join(sandbox, 'bin', 'gh'), 0o755);
}

// HOME, TMPDIR and the XDG folders in the sandbox, no GitHub token or host, no cached open issues, the local preflight.
function sandboxEnv(sandbox) {
  const env = { ...process.env };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_OPEN_ISSUES', 'DEEP_PREFLIGHT', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];
  return {
    ...env,
    PATH: [join(sandbox, 'bin'), dirname(process.execPath), env.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
  };
}

export const TIMEOUT_MS = 300_000;

/**
 * Runs the design links lane in `repo`: the copy's own scripts/lanes.mjs is imported in a child process to find the
 * lane (the one entry of `checks` LINKS_LANE picks), and each of its commands then runs in order with cwd at `repo`, as
 * `runLanes` runs them, without the machine's throttle and lease (README: The lane), stopping at the first that exits
 * non-zero. DEEP_OPEN_ISSUES names a file in the sandbox not yet written, as runLanes names one per run.
 * Returns the lane's name, each command's exit status, the output and its lines.
 */
export function runLinksLane(repo, env) {
  const program = `
const { checks } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const found = checks.filter((l) => ${LINKS_LANE.match}.test(l.name) && !${LINKS_LANE.not}.test(l.name));
console.log(JSON.stringify({ found: found.map((l) => ({ name: l.name, commands: l.commands })), names: checks.map((l) => l.name) }));
`;
  const listed = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (listed.status !== 0) return { name: undefined, statuses: [], output: `NO LANE: scripts/lanes.mjs didn't load:\n${listed.stderr}`, lines: [] };
  const { found, names } = JSON.parse(listed.stdout.trim().split('\n').at(-1));
  if (found.length !== 1) {
    const output = `NO LANE: scripts/lanes.mjs checks has ${found.length} design links lanes, of ${JSON.stringify(names)}`;
    return { name: undefined, statuses: [], output, lines: [output] };
  }
  const [{ name, commands }] = found;
  const issues = join(mkdtempSync(join(env.TMPDIR, 'open-issues-')), 'open-issues.json');
  let output = `LANE ${name}\n`;
  const statuses = [];
  for (const [command, ...args] of commands) {
    output += `$ ${[command, ...args].join(' ')}\n`;
    const r = spawnSync(command, args, { cwd: repo, env: { ...env, DEEP_OPEN_ISSUES: issues }, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 1 << 28 });
    output += `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}${r.signal ? `\nSTOPPED: the command didn't finish in ${TIMEOUT_MS / 1000} s and was stopped (${r.signal})` : ''}\n`;
    statuses.push(r.status);
    if (r.status !== 0) break;
  }
  output += `EXIT ${statuses.join(' ')}`;
  return { name, statuses, output, lines: output.split('\n') };
}

const STATE = /^\s*(FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/;
/** True when the run is the lane's PASS: it ran, and every command exited 0. */
export const passed = (run) => Boolean(run.name) && run.statuses.length > 0 && run.statuses.every((s) => s === 0);
/**
 * True when the run is the lane's FAIL: a command exited non-zero and the first output line naming a state, as
 * runLanes reads one, is FAIL (none of BLOCKED, INVALID or INCONCLUSIVE before it).
 */
export const failed = (run) => Boolean(run.name) && run.statuses.some((s) => s !== 0 && s !== null)
  && run.lines.find((l) => STATE.test(l))?.match(STATE)[1] === 'FAIL';

/**
 * An output line naming a line of the section: its file line as `technical-design.md:<n>` (or `… line <n>`), its place
 * in the section as `line <k>` beside the word "Principles", or the first 30 characters of its rendered text. With
 * `also`, the same output line must hold that text too.
 */
export function namesLine(run, { number, k, text }, also) {
  const forms = [
    (l) => new RegExp(`technical-design\\.md(?::|,? line )(?:\\d+[,\\s]+)*${number}(?!\\d)`).test(l),
    (l) => /principles/i.test(l) && new RegExp(`\\bline\\s+${k}(?!\\d)`, 'i').test(l),
    (l) => l.includes(text.slice(0, 30)),
  ];
  return run.lines.find((l) => forms.some((f) => f(l)) && (!also || l.includes(also)));
}

/** An output line naming invariant n: `invariant <n>` (or `#<n>`), `AGENTS.md:<line>`, or the first 30 characters of its text. */
export const namesInvariant = (run, { n, line, text }) => run.lines.find((l) => new RegExp(`invariant\\s*#?${n}(?!\\d)`, 'i').test(l)
  || new RegExp(`AGENTS\\.md(?::|,? line )${line}(?!\\d)`).test(l) || l.includes(text.slice(0, 30)));

/** An output line naming the canvas heading: its text, its slug, its <a id> or `canvas-primitives.md:<line>`. */
export const namesHeading = (run, heading) => run.lines.find((l) => l.includes(heading.title) || l.includes(`#${heading.slug}`)
  || heading.ids.some((id) => new RegExp(`#${id}(?![\\w-])`).test(l)) || new RegExp(`canvas-primitives\\.md(?::|,? line )${heading.number}(?!\\d)`).test(l));

/** The section's line k (1-based) in a doc's text, with its file line, place and rendered text. */
export function sectionLine(text, k) {
  const line = principles(text)?.lines[k - 1];
  if (!line) throw new Error(`the planted section has no line ${k}`);
  return { ...line, k };
}
