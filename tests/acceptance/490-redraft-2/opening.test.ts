// #490 criterion 2 (comparison half), a blind redraft: "Opening the eases as ease@1 leaves every content key, golden
// and corpus snapshot of the shipped fixtures byte for byte the same, and deep://registries lists ease@1 with since,
// digest, fill, each entry's origin and its kit result; a planted opening that renumbers the entries changes the key
// of a channel keyed with in_out_cubic and fails, naming the ease and the item"
//
// asserts (README: Criterion to tests): the shipped build (`full`) opens ease@1, the core's, holding in_out_cubic as a
// first-party entry; then every shipped fixture (every fixture the merge base's `full` manifest lists) and this
// suite's eased.json give, in the candidate's `full` build, what they give in the merge base's `full` build: each
// `golden` reply's verdict, reason and digest (vello_cpu and gpu), each `deep show` presentation's outcome, issues,
// snapshot at 0 s, 0.5 s and 1.5 s, every `eval` node's content key and written bytes at those times, and
// each `corpus_record` file's document, times, values and snapshots. The planted build `full,test-ease-renumbered`
// (ease@1 opened with its entries renumbered) fails that same check, with a failure that names in_out_cubic, the item
// eased-box and a changed content key. Where the base can't draw a fixture on this machine (a GPU snapshot, a gpu
// golden), a third test skips as INCONCLUSIVE, naming each, after the first test compared everything else.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const TIMEOUT = 1_800_000;
const EASE = 'ease@1';
const EASED_ITEM = 'eased-box';
/** The times every document is drawn and evaluated at: the start, and inside both channels' eased segments. */
const TIMES = ['0s', '0.5s', '1.5s'];
const CANDIDATE = ['full'];
const PLANTED = ['full', 'test-ease-renumbered'];
const EASED = JSON.parse(readFileSync(join(HERE, 'fixtures', 'eased.json'), 'utf8')) as JsonObject;

// ---------------------------------------------------------------------------------------------------
// JSON

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1200) ?? 'undefined';
/** One text per JSON value, keys sorted at every depth, so "byte for byte the same" is one string comparison. */
function canon(v: JsonValue | undefined): string {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const pick = (o: JsonObject, keys: readonly string[]): JsonObject => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]!]));
function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show --no-default-features --features <set>`, copied out under its own name.

const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const exe = (n: string): string => (process.platform === 'win32' ? `${n}.exe` : n);
function buildTo(root: string, features: string[], to: string, env: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', features.join(',')];
  const all = { ...process.env, ...CARGO_ENV, ...env };
  const r = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: all });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n')}`;
  const target = all['CARGO_TARGET_DIR'] ? resolve(root, all['CARGO_TARGET_DIR']) : join(root, 'target');
  copyFileSync(join(target, 'debug', exe('deep-show')), to);
  return '';
}

let bins = '';
let work = '';
const made = new Map<string, { bin: string; error: string }>();
beforeAll(() => {
  bins = mkdtempSync(join(tmpdir(), 'deep-490r2-bins-'));
  work = mkdtempSync(join(tmpdir(), 'deep-490r2-'));
  for (const set of [CANDIDATE, PLANTED]) {
    const bin = join(bins, `deep-show-${set.join('+')}`);
    made.set(set.join(','), { bin, error: buildTo(REPO, set, bin) });
  }
}, 7_200_000);
afterAll(() => {
  for (const d of [bins, work]) if (d) rmSync(d, { recursive: true, force: true });
});
function bin(set: string[]): string {
  const m = made.get(set.join(','))!;
  expect(m.error, `deep-show builds with features ${set.join(',')}`).toBe('');
  return m.bin;
}

/** The merge base, exported whole by `git archive` into the (git-ignored) target folder and built there in `full`. */
let baseBin = '';
function base(): { sha: string; bin: string } {
  const sha = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  const dir = join(REPO, 'target', 'acceptance-490-redraft-2-base', sha.slice(0, 12));
  if (!existsSync(join(dir, '.exported'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = `${dir}.tar`;
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(join(dir, '.exported'), sha);
  }
  if (!baseBin) {
    const to = join(dir, 'deep-show-full');
    expect(buildTo(dir, ['full'], to, { CARGO_TARGET_DIR: join(dir, 'target') }), `the merge base ${sha.slice(0, 12)} builds in ${dir}`).toBe('');
    baseBin = to;
  }
  return { sha, bin: baseBin };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario in, one answer out (#393).

const DOC = '01JB490R200000000000000001';
const YOU = { pid: 3002, start: 3_000 };
function run(binary: string, calls: JsonObject[], extra: JsonObject = {}): JsonObject[] {
  const evidence = mkdtempSync(join(work, 'ev-'));
  const sc = {
    evidence, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: YOU.pid, ppid: 1, start: YOU.start }],
    panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'main' } }, goldens: join(evidence, 'goldens'), ...extra, calls,
  };
  const r = spawnSync(binary, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(r.status, `deep-show run exits 0; stdout ${r.stdout?.slice(0, 800)}; stderr ${r.stderr?.slice(-800)}`).toBe(0);
  const out = JSON.parse(r.stdout.split('\n').filter((l) => l !== '')[0] ?? 'null') as JsonValue;
  expect(isObject(out) && out['ok'], `deep-show run took the scenario: ${show(out)}`).toBe(true);
  const replies = (out as JsonObject)['replies'] as JsonObject[];
  expect(replies.length, 'one reply per call').toBe(calls.length);
  return replies;
}

/** deep://registries: the registry `name`, or a sentence saying why it isn't there as the criterion needs. */
function easeOpenedFailures(binary: string): string[] {
  const [reply] = run(binary, [{ call: 'registries' }]);
  const list = Array.isArray(reply!['registries']) ? reply!['registries'] : [];
  const reg = list.find((l) => isObject(l) && l['kind'] === 'registry' && l['name'] === EASE) as JsonObject | undefined;
  if (!reg) return [`deep://registries lists no ${EASE}; it lists ${list.map((l) => (isObject(l) ? String(l['name']) : '?')).join(', ')}`];
  const failures: string[] = [];
  if (reg['owner'] !== 'core') failures.push(`${EASE} is owned by ${show(reg['owner'])}, not the core`);
  const entries = Array.isArray(reg['entries']) ? reg['entries'] : [];
  const e = entries.find((x) => isObject(x) && x['name'] === 'in_out_cubic') as JsonObject | undefined;
  if (!e) failures.push(`${EASE} holds no entry in_out_cubic: ${show(entries)}`);
  else if (e['origin'] !== 'first_party') failures.push(`${EASE}'s in_out_cubic has origin ${show(e['origin'])}, not first_party`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// What one build makes of the fixtures.

interface Fixture { name: string; document: JsonObject | null; record: JsonValue | undefined }
interface Drawn {
  golden: Record<string, string>;                       // backend → canonical golden reply
  shows: string[];                                      // per time: canonical presentation
  snapshotted: boolean[];                               // per time: whether the presentation held a snapshot
  nodes: Map<string, { key: string; result: string }>[]; // per time: `operator|item` → key and bytes
  evalCodes: string[];                                  // per time: an eval refusal's code, else ''
  corpus: { head: string; values: JsonObject; snapshots: JsonObject } | null;
}
interface Captured { fixtures: Map<string, Fixture>; drawn: Map<string, Drawn> }

const BACKENDS = ['vello_cpu', 'gpu'];
const GOLDEN_FIELDS = ['verdict', 'reason', 'digest', 'probe', 'environment', 'fingerprint'];
const issueRows = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v : []).map((i) => canon(isObject(i) ? pick(i, ['code', 'severity', 'path', 'ids']) : i)).sort();

/** The build's shipped fixtures: its `full` manifest, each module fixture's record taken from the `fixtures` call. */
function fixturesOf(binary: string): Map<string, Fixture> {
  const [manifest, fixtures] = run(binary, [{ call: 'manifest' }, { call: 'fixtures' }]);
  const records = (Array.isArray(fixtures!['fixtures']) ? fixtures!['fixtures'] : []).filter(isObject);
  const out = new Map<string, Fixture>();
  for (const f of (Array.isArray(manifest!['fixtures']) ? manifest!['fixtures'] : []).filter(isObject)) {
    const doc = isObject(f['document']) ? f['document'] : {};
    // A scene is a scenario of calls: its document, when it holds one, is what can be presented.
    const document = f['profile'] === 'scene' ? (isObject(doc['document']) ? doc['document'] : null) : doc;
    const own = records.find((r) => r['module'] === f['module'] && canon(r['document']) === canon(doc));
    out.set(String(f['name']), { name: String(f['name']), document, record: own?.['record'] });
  }
  return out;
}

function draw(binary: string, f: Fixture, goldenNames: Set<string>): Drawn {
  const golden: Record<string, string> = {};
  if (goldenNames.has(f.name)) {
    const replies = run(binary, BACKENDS.map((backend) => ({ call: 'golden', fixture: f.name, backend })));
    BACKENDS.forEach((b, i) => { golden[b] = canon(pick(replies[i]!, GOLDEN_FIELDS)); });
  }
  const d: Drawn = { golden, shows: [], snapshotted: [], nodes: [], evalCodes: [], corpus: null };
  if (!f.document) return d;
  const corpusDir = mkdtempSync(join(work, 'corpus-'));
  const calls: JsonObject[] = [];
  for (const t of TIMES) {
    calls.push({ call: 'deep show', peer: YOU, doc: DOC, document: f.document, include: ['issues', 'pixels'], size: [320, 180], t });
    calls.push({ call: 'eval', doc: DOC, t });
  }
  calls.push({ call: 'corpus_record', corpus: corpusDir, name: 'fixture', document: f.document, times: TIMES });
  const replies = run(binary, calls, f.record !== undefined ? { record: f.record } : {});
  TIMES.forEach((_, i) => {
    const s = replies[2 * i]!;
    const e = replies[2 * i + 1]!;
    const snaps = (Array.isArray(s['snapshots']) ? s['snapshots'] : []).map((x) => (isObject(x) ? x['sha256'] ?? null : null));
    d.shows.push(canon({ outcome: s['outcome'] ?? null, reason: s['reason'] ?? null, code: s['code'] ?? null, issues: issueRows(s['issues']), snapshots: snaps }));
    d.snapshotted.push(snaps.length > 0);
    const nodes = new Map<string, { key: string; result: string }>();
    for (const n of (Array.isArray(e['nodes']) ? e['nodes'] : []).filter(isObject)) {
      nodes.set(`${String(n['operator'])}|${n['item'] === null || n['item'] === undefined ? '-' : String(n['item'])}`, { key: String(n['key']), result: String(n['result']) });
    }
    d.nodes.push(nodes);
    d.evalCodes.push(typeof e['code'] === 'string' ? e['code'] : '');
  });
  const c = replies[replies.length - 1]!;
  if (typeof c['file'] === 'string') {
    const file = JSON.parse(readFileSync(c['file'], 'utf8')) as JsonObject;
    d.corpus = {
      head: canon(pick(file, ['document', 'times', 'accepted'])),
      values: isObject(file['values']) ? file['values'] : {},
      snapshots: isObject(file['snapshots']) ? file['snapshots'] : {},
    };
  }
  return d;
}

/** Every shipped fixture of the merge base's manifest, and this suite's eased.json, drawn in one build. */
function capture(binary: string, names: readonly string[] | null): Captured {
  const fixtures = fixturesOf(binary);
  const goldenNames = new Set(fixtures.keys());
  fixtures.set('suite/eased.json', { name: 'suite/eased.json', document: EASED, record: undefined });
  const drawn = new Map<string, Drawn>();
  for (const name of names ?? [...fixtures.keys()]) {
    const f = fixtures.get(name);
    if (f) drawn.set(name, draw(binary, f, goldenNames));
  }
  return { fixtures, drawn };
}

let baseCaptured: Captured | null = null;
function baseCapture(): Captured {
  if (!baseCaptured) {
    baseCaptured = capture(base().bin, null);
    expect(baseCaptured.drawn.size, 'the merge base lists shipped fixtures').toBeGreaterThan(10);
  }
  return baseCaptured;
}

// ---------------------------------------------------------------------------------------------------
// The check: nothing the merge base made of a fixture differs after the opening.

/** The eases each item's channel keys name, by item ID, from a document's `channels`. */
function easesByItem(doc: JsonObject | null): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const channels = doc && isObject(doc['channels']) ? doc['channels'] : {};
  for (const ch of Object.values(channels)) {
    if (!isObject(ch) || typeof ch['target'] !== 'string') continue;
    const m = /^items\/([^/]+)\//.exec(ch['target']);
    if (!m) continue;
    for (const k of Object.values(isObject(ch['keys']) ? ch['keys'] : {})) {
      const interp = isObject(k) ? k['interp'] : undefined;
      const ease = isObject(interp) ? interp['ease'] : undefined;
      const name = typeof ease === 'string' ? ease : isObject(ease) && typeof ease['name'] === 'string' ? ease['name'] : null;
      if (name) out.set(m[1]!, (out.get(m[1]!) ?? new Set()).add(name));
    }
  }
  return out;
}

function openingFailures(before: Captured, after: Captured): string[] {
  const failures: string[] = [];
  for (const [name, b] of before.drawn) {
    const a = after.drawn.get(name);
    const fb = before.fixtures.get(name)!;
    const fa = after.fixtures.get(name);
    if (!a || !fa) { failures.push(`${name}: the fixture is gone after the opening`); continue; }
    if (canon(fb.document) !== canon(fa.document)) { failures.push(`${name}: the fixture's document changed`); continue; }
    const eases = easesByItem(fb.document);
    const at = (item: string): string => (eases.has(item) ? `ease ${[...eases.get(item)!].sort().join(', ')}: item ${item}: ` : `item ${item}: `);
    for (const backend of Object.keys(b.golden)) {
      if (a.golden[backend] !== b.golden[backend]) failures.push(`${name}: the ${backend} golden changed (${b.golden[backend]} → ${a.golden[backend]})`);
    }
    if (!fb.document) continue; // a kit scene holding only `about`: its goldens are all it has (README)
    TIMES.forEach((t, i) => {
      if (a.shows[i] !== b.shows[i]) failures.push(`${name} at ${t}: the presentation or its snapshot changed (${b.shows[i]} → ${a.shows[i]})`);
      if (a.evalCodes[i] !== b.evalCodes[i]) failures.push(`${name} at ${t}: eval answered ${a.evalCodes[i] || 'nodes'}, not ${b.evalCodes[i] || 'nodes'}`);
      for (const [node, nb] of b.nodes[i]!) {
        const item = node.split('|')[1]!;
        const na = a.nodes[i]!.get(node);
        if (!na) failures.push(`${name} at ${t}: ${at(item)}node ${node} is gone`);
        else if (na.key !== nb.key) failures.push(`${name} at ${t}: ${at(item)}node ${node}'s content key changed from ${nb.key} to ${na.key}`);
        else if (na.result !== nb.result) failures.push(`${name} at ${t}: ${at(item)}node ${node} wrote other bytes (${nb.result} → ${na.result})`);
      }
    });
    if (!b.corpus || !a.corpus) {
      if (b.corpus !== a.corpus) failures.push(`${name}: corpus_record wrote ${a.corpus ? 'a file' : 'no file'}, the merge base ${b.corpus ? 'a file' : 'none'}`);
      continue;
    }
    if (a.corpus.head !== b.corpus.head) failures.push(`${name}: the corpus file's saved document or times changed`);
    for (const [t, snap] of Object.entries(b.corpus.snapshots)) {
      if (canon(a.corpus.snapshots[t]) !== canon(snap)) failures.push(`${name}: the corpus snapshot at ${t} changed (${show(snap)} → ${show(a.corpus.snapshots[t])})`);
    }
    for (const [t, items] of Object.entries(b.corpus.values)) {
      const later = isObject(a.corpus.values[t]) ? a.corpus.values[t] : {};
      for (const [item, v] of Object.entries(isObject(items) ? items : {})) {
        if (canon(later[item]) !== canon(v)) failures.push(`${name}: ${at(item)}the corpus value at ${t} changed`);
      }
    }
  }
  return failures;
}

describe('#490 AC2 (redraft) opening the eases as ease@1 leaves the shipped fixtures byte for byte the same', () => {
  it('AC2 every content key, golden and corpus snapshot of the shipped fixtures, and of a channel keyed with in_out_cubic, is the merge base\'s after the opening', () => {
    // The eases are open here first: a candidate without ease@1 never reaches the merge base's build.
    none(easeOpenedFailures(bin(CANDIDATE)), `the shipped build opens ${EASE}`);
    const before = baseCapture();
    const names = [...before.drawn.keys()];
    const here = capture(bin(CANDIDATE), names);
    none(openingFailures(before, here), `the opening against the merge base ${base().sha.slice(0, 12)}`);
  }, TIMEOUT);

  it('AC2 a planted opening that renumbers the entries changes the key of a channel keyed with in_out_cubic and fails, naming the ease and the item', () => {
    none(easeOpenedFailures(bin(PLANTED)), `the planted build also opens ${EASE}`);
    const before = baseCapture();
    const failures = openingFailures(before, capture(bin(PLANTED), [...before.drawn.keys()]));
    expect(failures.length, 'the renumbering opening fails the check, but it found nothing wrong').toBeGreaterThan(0);
    expect(
      failures.some((f) => f.includes('in_out_cubic') && f.includes(`item ${EASED_ITEM}`) && f.includes('content key changed')),
      `a failure names in_out_cubic, the item ${EASED_ITEM} and its changed content key; the failures were:\n  ${failures.join('\n  ')}`,
    ).toBe(true);
  }, TIMEOUT);

  it('AC2 the snapshots and goldens only a GPU draws were compared too (INCONCLUSIVE where the merge base can\'t draw them here)', (ctx) => {
    none(easeOpenedFailures(bin(CANDIDATE)), `the shipped build opens ${EASE}`);
    const before = baseCapture();
    const unrun: string[] = [];
    for (const [name, d] of before.drawn) {
      if (before.fixtures.get(name)!.document && d.shows.some((s, i) => !d.snapshotted[i] && s.includes('"not_presented"'))) unrun.push(`${name}: its presentation (not_presented)`);
      if (d.golden['gpu']?.includes('"reason":"probe"')) unrun.push(`${name}: its gpu golden (BLOCKED, probe)`);
    }
    if (unrun.length) ctx.skip(`INCONCLUSIVE: the merge base can't draw these on this machine, so they weren't compared: ${unrun.join('; ')}`);
  }, TIMEOUT);
});
