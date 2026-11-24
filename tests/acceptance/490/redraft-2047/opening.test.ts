// #490.ac6f64d6: "Opening the eases as ease@1 leaves every content key, golden and corpus snapshot of the shipped
// fixtures byte for byte the same, and deep://registries lists ease@1 with since, digest, fill, each entry's origin and
// its kit result; a planted opening that renumbers the entries changes the key of a channel keyed with in_out_cubic and
// fails, naming the ease and the item"
//
// Through `deep-show run`, in the checkout's `full` build, its planted `full,test-ease-renumbered` build (ease@1 opened
// with its entries renumbered) and the merge base's `full` build (`git merge-base HEAD origin/main`, exported with `git
// archive` into the git-ignored target folder and built there apart, as #200's and the earlier redraft's suites do).
// The listing comes first: the earlier blind suite's check (tests/acceptance/490/opening.test.ts), with the test pack
// `test/epack` installed so a pack's ease table is listed with origin pack. Then the comparison of the earlier blind
// redraft (tests/acceptance/490-redraft-2/opening.test.ts): every fixture of the merge base's shipped manifest, plus
// that redraft's eased board (`eased-box` driven by a channel keyed with in_out_cubic), at 0, 0.5 and 1.5 s: each
// `eval` node's content key and the bytes it wrote, each presentation's outcome and issues, each fixture's `golden` on
// Vello CPU and each `corpus_record` file's document, times, values and snapshots, against the merge base's. The planted
// opening must fail the same comparison with a failure naming in_out_cubic, the item eased-box and a changed content key.
//
// The GPU half: goldens on the `gpu` backend are drawn by the GPU, which counts only on a reference Mac. There they are
// compared too; anywhere else the test ends INCONCLUSIVE (skipped with the reason) after everything else was compared and
// held, never a pass. No presentation here asks for pixels.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DIGEST, EASES, FIXTURES, REPO, TIMEOUT, isObject, none, referenceMacProblem, runShow, scenario, show, theRegistry, useEvidence,
  type JsonObject, type JsonValue, type PackFixture,
} from './helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const EASED = JSON.parse(readFileSync(join(HERE, '..', '..', '490-redraft-2', 'fixtures', 'eased.json'), 'utf8')) as JsonObject;
const EASED_ITEM = 'eased-box';
const EPACK: PackFixture = { id: 'test/epack', version: '1.0.0', dir: join(FIXTURES, 'packs', 'epack-1.0.0') };
/** The times every document is evaluated at: the start, and inside both eased channels' segments. */
const TIMES = ['0s', '0.5s', '1.5s'];
const CANDIDATE = 'full';
const PLANTED = 'full,test-ease-renumbered';
const GPU_OFF = referenceMacProblem();
/** Vello CPU everywhere; the GPU backend only on a reference Mac. */
const BACKENDS = GPU_OFF ? ['vello_cpu'] : ['vello_cpu', 'gpu'];
const GOLDEN_FIELDS = ['verdict', 'reason', 'digest', 'probe', 'environment', 'fingerprint'];
const evidence = useEvidence();

// ---------------------------------------------------------------------------------------------------
// JSON

/** One text per JSON value, keys sorted at every depth, so "byte for byte the same" is one string comparison. */
function canon(v: JsonValue | undefined): string {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const pick = (o: JsonObject, keys: readonly string[]): JsonObject => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]!]));

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show --no-default-features --features <set>`, copied out under its own name.

const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const exe = (n: string): string => (process.platform === 'win32' ? `${n}.exe` : n);
function buildTo(root: string, features: string, to: string, env: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', features];
  const all = { ...process.env, ...CARGO_ENV, ...env };
  const r = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: all });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n')}`;
  const target = all['CARGO_TARGET_DIR'] ? resolve(root, all['CARGO_TARGET_DIR']) : join(root, 'target');
  copyFileSync(join(target, 'debug', exe('deep-show')), to);
  return '';
}

let work = '';
const made = new Map<string, { bin: string; error: string }>();
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'deep-490r2047-'));
  for (const set of [CANDIDATE, PLANTED]) {
    const bin = join(work, `deep-show-${set.replace(/[^a-z0-9.-]/g, '_')}`);
    made.set(set, { bin, error: buildTo(REPO, set, bin) });
  }
}, 7_200_000);
afterAll(() => { if (work) rmSync(work, { recursive: true, force: true }); });
function bin(set: string): string {
  const m = made.get(set)!;
  expect(m.error, `deep-show builds with features ${set}`).toBe('');
  return m.bin;
}

/** The merge base, exported whole by `git archive` into the (git-ignored) target folder and built there in `full`. */
let baseBin = '';
function base(): { sha: string; bin: string } {
  const sha = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  const dir = join(REPO, 'target', 'acceptance-490-redraft-2047-base', sha.slice(0, 12));
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
    const to = join(work, 'deep-show-base-full');
    expect(buildTo(dir, 'full', to, { CARGO_TARGET_DIR: join(dir, 'target') }), `the merge base ${sha.slice(0, 12)} builds in ${dir}`).toBe('');
    baseBin = to;
  }
  return { sha, bin: baseBin };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` with the scenario a fixture needs (its record, a scratch golden store).

const DOC = '01JB490S204700000000000001';
const YOU = { pid: 3002, start: 3_000 };
function run(binary: string, calls: JsonObject[], extra: JsonObject = {}): JsonObject[] {
  const ev = mkdtempSync(join(work, 'ev-'));
  const sc = {
    evidence: ev, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: YOU.pid, ppid: 1, start: YOU.start }],
    panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'main' } }, goldens: join(ev, 'goldens'), ...extra, calls,
  };
  const r = spawnSync(binary, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  try {
    expect(r.status, `deep-show run exits 0; stdout ${r.stdout?.slice(0, 800)}; stderr ${r.stderr?.slice(-800)}`).toBe(0);
    const out = JSON.parse(r.stdout.split('\n').filter((l) => l !== '')[0] ?? 'null') as JsonValue;
    expect(isObject(out) && out['ok'], `deep-show run took the scenario: ${show(out)}`).toBe(true);
    const replies = (out as JsonObject)['replies'] as JsonObject[];
    expect(replies.length, 'one reply per call').toBe(calls.length);
    return replies;
  } finally {
    rmSync(ev, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The listing (deep://registries)

function listingFailures(binary: string): string[] {
  const r = theRegistry(runShow(binary, scenario(evidence(), [{ call: 'registries' }], [EPACK]))[0]!, 'ease@1');
  const failures: string[] = [];
  if (r.owner !== 'core') failures.push(`ease@1 is declared by ${r.owner}, not the core`);
  if (!/^R\d+$/.test(r.since)) failures.push(`ease@1 has no since: ${show(r.raw)}`);
  if (!DIGEST.test(r.digest)) failures.push(`ease@1 has no digest: ${show(r.raw)}`);
  if (!r.fill.includes('pack')) failures.push(`ease@1's fill ${JSON.stringify(r.fill)} doesn't let packs fill it`);
  for (const name of EASES) {
    const e = r.entries.find((x) => x.name === name);
    if (!e) { failures.push(`ease@1 holds no entry ${name}`); continue; }
    if (e.origin !== 'first_party') failures.push(`${name}'s origin is ${e.origin}, not first_party`);
    if (e.module !== 'core') failures.push(`${name} is filled by ${e.module ?? 'nothing'}, not the core`);
    if (!/^R\d+$/.test(e.since)) failures.push(`${name} has no since: ${show(e.raw)}`);
    if (!DIGEST.test(e.digest)) failures.push(`${name} has no digest: ${show(e.raw)}`);
    if (e.kit.verdict !== 'PASS') failures.push(`${name} fails ease@1's kit: ${show(e.kit.raw)}`);
    for (const rule of r.kit) if (!e.kit.rules.some((x) => x.rule === rule.rule && x.verdict === 'PASS')) failures.push(`${name}'s kit result has no PASS for the rule ${rule.rule}`);
  }
  const dip = r.entries.find((x) => x.name === 'epack.dip');
  if (!dip) failures.push('ease@1 lists no entry epack.dip from the installed pack test/epack');
  else {
    if (dip.origin !== 'pack') failures.push(`epack.dip's origin is ${dip.origin}, not pack`);
    if (dip.kit.verdict !== 'PASS') failures.push(`epack.dip fails ease@1's kit: ${show(dip.kit.raw)}`);
  }
  if (r.planted.length === 0) failures.push('ease@1 declares no planted wrong entry');
  for (const p of r.planted) if (p.result.verdict !== 'FAIL') failures.push(`ease@1's kit admits its planted entry ${p.name}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// What one build makes of the fixtures.

interface Fixture { name: string; document: JsonObject | null; record: JsonValue | undefined }
interface Drawn {
  golden: Record<string, string>;                        // backend → canonical golden reply
  shows: string[];                                       // per time: canonical presentation (outcome, issues)
  nodes: Map<string, { key: string; result: string }>[]; // per time: `operator|item` → key and bytes
  evalCodes: string[];                                   // per time: an eval refusal's code, else ''
  corpus: { head: string; values: JsonObject; snapshots: JsonObject } | null;
}
interface Captured { fixtures: Map<string, Fixture>; drawn: Map<string, Drawn> }

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
  const d: Drawn = { golden, shows: [], nodes: [], evalCodes: [], corpus: null };
  if (!f.document) return d;
  const corpusDir = mkdtempSync(join(work, 'corpus-'));
  try {
    const calls: JsonObject[] = [];
    for (const t of TIMES) {
      calls.push({ call: 'deep show', peer: YOU, doc: DOC, document: f.document, include: ['issues'], t });
      calls.push({ call: 'eval', doc: DOC, t });
    }
    calls.push({ call: 'corpus_record', corpus: corpusDir, name: 'fixture', document: f.document, times: TIMES });
    const replies = run(binary, calls, f.record !== undefined ? { record: f.record } : {});
    TIMES.forEach((_, i) => {
      const s = replies[2 * i]!;
      const e = replies[2 * i + 1]!;
      d.shows.push(canon({ outcome: s['outcome'] ?? null, reason: s['reason'] ?? null, code: s['code'] ?? null, issues: issueRows(s['issues']) }));
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
  } finally {
    rmSync(corpusDir, { recursive: true, force: true });
  }
  return d;
}

/** Every shipped fixture of the merge base's manifest (or `names`), and the eased board, drawn in one build. */
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

/** The comparison: nothing the merge base made of a fixture differs after the opening. Each failure names the fixture, the time, the eases and the item. */
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
    if (!fb.document) continue; // a kit scene holding only `about`: its goldens are all it has
    TIMES.forEach((t, i) => {
      if (a.shows[i] !== b.shows[i]) failures.push(`${name} at ${t}: the presentation changed (${b.shows[i]} → ${a.shows[i]})`);
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

describe('#490.ac6f64d6 opening the eases as ease@1 leaves the shipped fixtures byte for byte the same, and deep://registries lists it', () => {
  it('#490.ac6f64d6 deep://registries lists ease@1 with since, digest, fill, each entry\'s origin and kit result; every content key, golden and corpus snapshot of the shipped fixtures and of a channel keyed with in_out_cubic is the merge base\'s; and a planted opening that renumbers the entries changes that channel\'s key and fails, naming the ease and the item', (ctx) => {
    none(listingFailures(bin(CANDIDATE)), 'the listing of ease@1');

    const before = baseCapture();
    const names = [...before.drawn.keys()];
    none(openingFailures(before, capture(bin(CANDIDATE), names)), `the opening against the merge base ${base().sha.slice(0, 12)}`);

    const planted = openingFailures(before, capture(bin(PLANTED), names));
    expect(planted.length, 'the renumbering opening fails the comparison, but it found nothing wrong').toBeGreaterThan(0);
    expect(
      planted.some((f) => f.includes('in_out_cubic') && f.includes(`item ${EASED_ITEM}`) && f.includes('content key changed')),
      `a failure names in_out_cubic, the item ${EASED_ITEM} and its changed content key; the failures were:\n  ${planted.slice(0, 20).join('\n  ')}`,
    ).toBe(true);

    if (GPU_OFF) ctx.skip(`INCONCLUSIVE: every fixture's gpu golden is drawn by the GPU, which counts only on a reference Mac (${GPU_OFF}); everything else was compared and held`);
  }, TIMEOUT);
});
