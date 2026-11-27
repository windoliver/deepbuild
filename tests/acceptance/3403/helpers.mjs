// Test-side fixtures for #3403: a scratch git repository whose main holds a design document shaped as the real one
// is (a Decisions section of three tables, last in the file), the planted edits of it, and this checkout's
// `node scripts/proof.mjs guard` run there with a clean environment. Nothing of the guard is imported: the tests read
// its exit status and what it prints. The clean environment, the fixture git and the security-key stand-in are
// #3166's, imported as they landed.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardware } from '../3166/authenticator.mjs';
import { LIST, commit, git, put, run } from '../3166/fixtures.mjs';

export { approve } from '../3166/authenticator.mjs';
export { git, note } from '../3166/fixtures.mjs';

// The checkout this suite sits in, so the guard that runs is that checkout's: the change, the merge base or a twin.
const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const DESIGN_PATH = 'docs/technical-design.md';
// Each test's own limit. A guard run in a scratch repository takes about a second, and #3166's `run` stops any
// process a test starts after 60 s.
export const LIMIT = { timeout: 120_000 };

export const WEEKS = 'Each week ends with a release that passed the preflight.';
export const SECTION = '## Decisions';
export const MADE_ANCHOR = '<a id="decisions-made"></a>';
export const WIP_ROW = '| Work-in-progress commits | An agent may make a local commit to set work aside, instead of a stash. | Your rules reserve every commit |';
export const DECIDED_LAST = '| Dispatching workflows | No dispatch without approval, for every user. | A repo marks more workflows as free |';
export const HOSTED = '### Decided for a hosted hub';
const HEADER = ['| Question | Decision | Reopens if |', '|---|---|---|'];
// No line of the document holds a digit, so a number the guard prints is never a line's text. The lines ahead of
// Decisions put its lines past 160: no count of commits or of seconds the guard prints comes near.
const AHEAD = [
  '# Technical design', '',
  '## The primitives, defined', '',
  ...Array.from({ length: 150 }, () => '- A primitive draws the same on every backend.'), '',
  '## Six weeks to the first version', '',
  '### What each week ships', '',
  WEEKS, '',
];
const DECISIONS = [
  SECTION, '',
  'One question is yours, only if you want it. Every other question is decided below with what would reopen it.', '',
  '<a id="decisions-yours"></a>', '',
  '### Yours', '',
  '| Question | Where it stands | When |',
  '|---|---|---|',
  '| A wall view for a big screen | Only if you want it, since it is a new screen. | Later, if wanted |', '',
  MADE_ANCHOR, '',
  '### Decided', '',
  ...HEADER,
  '| Requests that name an action | A request you type authorizes exactly what it names, in that thread. | You say a request should cover more, or less |',
  WIP_ROW,
  DECIDED_LAST, '',
  HOSTED, '',
  ...HEADER,
  '| Who runs a hub in the cloud | Our hosting, and the same image on your own account. | People who sign up mostly move to their own account |',
  '| Who pays for a hosted hub | You pay for what your machine uses. | Waking an idle machine takes too long |',
];
/** The design document on main: Decisions is its last section, and its last line is a row, as in the real file. */
export const DESIGN = `${[...AHEAD, ...DECISIONS].join('\n')}\n`;
export const GLOSSARY = '## Glossary';
/** The same with a section after Decisions. */
export const DESIGN_WITH_GLOSSARY = `${DESIGN}\n${GLOSSARY}\n\nA claim is an agent's statement that work is done.\n`;

// The planted lines. #3365's shape: a new heading and a table of new decisions, each with what would reopen it.
export const NEW_HEADING = '### Decided for what a project learns';
export const NEW_ROWS = [
  "| Who a project's audit asks | Each person, about what was decided for their own sessions. | People skip audits of sessions they did not start |",
  "| Whose answers make a project's rule | One person's, from answers that person gave. | The others overrule such rules more often than they stand |",
];
export const NEW_TABLE = [...HEADER, ...NEW_ROWS];
export const ADDED_ROW = '| Publishing a release | Only by your ask, each time. | A repo marks its releases as free |';
export const WIP_ROW_CHANGED = WIP_ROW.replace('| Your rules reserve every commit |', '| Never |');
export const SUB_HEADING = '#### Before the first hosted hub';
export const SUB_PARAGRAPH = 'Nothing below binds until a hosted hub ships, and each row is read again then.';
export const DEEP_HEADING = '##### Hosted hubs by region';

const at = (lines, line) => {
  const found = lines.indexOf(line);
  assert.ok(found >= 0 && lines.indexOf(line, found + 1) < 0, `BLOCKED: the fixture document must hold this line once: ${line}`);
  return found;
};
/** The 1-based number of the one line of `text` that is `line`. */
export const lineOf = (text, line) => at(text.split('\n'), line) + 1;
/** `text` with `added` put in on the lines right below its one line `line`. */
export function below(text, line, added) {
  const lines = text.split('\n');
  lines.splice(at(lines, line) + 1, 0, ...added);
  return lines.join('\n');
}
/** `text` with `added` put in on the lines right above its one line `line`. */
export function above(text, line, added) {
  const lines = text.split('\n');
  lines.splice(at(lines, line), 0, ...added);
  return lines.join('\n');
}
/** `text` with its one line `line` reading `now`. */
export function reworded(text, line, now) {
  const lines = text.split('\n');
  lines[at(lines, line)] = now;
  return lines.join('\n');
}
/** Criterion 1's edit: the new heading and its table of two rows, after the blank line that ends the Decided table. */
export const withNewTable = () => above(DESIGN, HOSTED, [NEW_HEADING, '', ...NEW_TABLE, '']);

/**
 * A repository whose main (origin/main, the merge base) holds the approvers list with one person's security key, the
 * design document and the proof lanes' marker; the change is on session/3403. `w.person` is that person's key.
 */
export function repository(t, design = DESIGN) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'd3403-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const w = { dir, home: join(dir, 'home'), repo: join(dir, 'repo'), person: hardware('maintainer') };
  mkdirSync(w.home);
  mkdirSync(w.repo);
  git(w, 'init', '-q', '-b', 'main');
  put(join(w.repo, LIST), w.person.line);
  put(join(w.repo, DESIGN_PATH), design);
  put(join(w.repo, 'scripts/proof-guard.mjs'), '// The proof lanes are on main.\n');
  commit(w, 'base');
  git(w, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(w, 'checkout', '-q', '-b', 'session/3403');
  return w;
}

/**
 * One commit on the checked-out branch that leaves the design document as `text`, with whatever else the worktree
 * holds; returns its full ID. No message names an issue, so none is fetched.
 */
export function edit(w, text, message) {
  put(join(w.repo, DESIGN_PATH), text);
  return commit(w, message);
}

/**
 * This checkout's guard lane, run in the scratch repository. Its output is pasted into the test's own, under what
 * `git diff -U0` gives the last commit's edit of the document as, which the issue quotes for #3365.
 */
export function guard(t, w, label) {
  const hunks = git(w, 'diff', '-U0', 'HEAD~1', 'HEAD', '--', DESIGN_PATH).split('\n').flatMap((line) => line.match(/^@@ [^@]+ @@/) ?? []).join(' ');
  const r = run(w, process.execPath, [join(ROOT, 'scripts/proof.mjs'), 'guard']);
  t.diagnostic(`${label}; git diff -U0 HEAD~1 HEAD -- ${DESIGN_PATH}: ${hunks || 'no change'}; exit ${r.status}\n${r.out}`);
  return r;
}

const said = (r, state) => r.stdout.split('\n').filter((line) => line.startsWith(`${state} guard:`));
/** The guard passed and said so: exit 0, a PASS guard line, and no line of any other state. */
export function passes(r, label) {
  assert.equal(r.status, 0, `${label}: the guard must pass\n${r.out}`);
  assert.ok(said(r, 'PASS').length, `${label}: a pass must be said, not silent\n${r.out}`);
  assert.doesNotMatch(r.stdout, /^(?:FAIL|BLOCKED|INVALID|INCONCLUSIVE) /m, `${label}: no line may read otherwise than PASS\n${r.out}`);
}
/** The guard refused by a FAIL guard line of its own that names the design document: not a pass, and not a crash. */
export function refuses(r, label) {
  assert.notEqual(r.status, 0, `${label}: the guard must fail\n${r.out}`);
  assert.ok(said(r, 'FAIL').some((line) => line.includes(DESIGN_PATH)), `${label}: a FAIL guard line must name ${DESIGN_PATH}\n${r.out}`);
}
/** What the guard printed holds one of `numbers` as a whole number: the line it names. */
export function namesLine(r, label, numbers) {
  const whole = (number) => new RegExp(`(?<![\\w.])${number}(?!\\w)`);
  assert.ok(numbers.some((number) => whole(number).test(r.stdout)), `${label}: the guard must name line ${numbers.join(' or ')} of ${DESIGN_PATH}\n${r.out}`);
}
