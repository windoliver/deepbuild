// The shipped parity suite's lane runners (issue #458), which scripts/parity-suite.json names: one process per run of
// a lane, a request per stdin line, `{lane, fixture, twin}`, and a reply per line in the order asked (README of
// tests/acceptance/458/suite: A lane's runner). It decides no verdict of the suite's: it draws and reports.
//
//   node scripts/parity-runner.mjs quick
//
// The quick lane runs the canvas kit's fixtures through the built `deep-show run`, on Vello CPU and wgpu's noop
// backend, with no GPU: each fixture's own cases, then its planted-fault twins. A twin is one of three kinds: a
// comparison's planted mismatch, which the kit runs inside the comparison (`comparison`, with the sidecar's `path` and
// `value`); a planted fault in the document (`path` and `value`), judged as the fixture is; or a planted program
// (`planted`, with the kit `part` it breaks), for a scene one of the kit's own parts runs. A binary that isn't built
// answers BLOCKED for every request.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [lane] = process.argv.slice(2);
if (lane !== 'quick') {
  console.error('usage: node scripts/parity-runner.mjs quick');
  process.exit(2);
}
const requests = readFileSync(0, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
const reply = (answers) => process.stdout.write(answers.map((a) => `${JSON.stringify(a)}\n`).join(''));
const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The scenes the kit's own parts run, by the part. */
const PART_SCENES = { 'parity/kernel/clean-rebuild-fuzz.scene': 'clean_rebuild', 'parity/kernel/patch-fuzz.scene': 'patch_fuzz', 'parity/framework/repair-loop.scene': 'repair_loop' };
const BACKEND = 'vello_cpu';
const worst = (verdicts) => ['FAIL', 'INVALID', 'BLOCKED', 'PASS'].find((v) => verdicts.includes(v)) ?? 'BLOCKED';

// One scenario per line: the fixtures' own run; each round of document twins, a twin per fixture; each planted program.
const own = requests.filter((r) => !r.twin);
const rounds = [];
const planted = new Map();
const nth = new Map();
for (const r of requests.filter((x) => x.twin)) {
  if (r.twin.planted) planted.set(r.twin.planted, r.twin.part);
  else if (!r.twin.comparison) {
    const round = nth.get(r.fixture) ?? 0;
    nth.set(r.fixture, round + 1);
    (rounds[round] ??= {})[r.fixture] = { path: r.twin.path, value: r.twin.value };
    r.round = round;
  }
}
const evidence = mkdtempSync(join(tmpdir(), 'deep-parity-quick-'));
let answers;
try {
  const scenarios = [
    // The scenes the kit's own parts run are the core's fixtures, so their own run is those parts on the core.
    { evidence, calls: [{ call: 'manifest' }, { call: 'kit', parts: ['fixtures'] }, { call: 'kit', modules: ['core'], parts: [...new Set(Object.values(PART_SCENES))] }] },
    ...rounds.map((twins) => ({ evidence, calls: [{ call: 'kit', parts: ['fixtures'], twins }] })),
    ...[...planted].map(([name, part]) => ({ evidence, planted: name, calls: [{ call: 'kit', modules: ['core'], parts: [part] }] })),
  ];
  const run = spawnSync(join(root, process.env.CARGO_TARGET_DIR ?? 'target', 'debug', 'deep-show'), ['run'], { cwd: root, input: scenarios.map((s) => `${JSON.stringify(s)}\n`).join(''), encoding: 'utf8', maxBuffer: 2 ** 30 });
  answers = (run.stdout ?? '').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (run.error || answers.length !== scenarios.length || answers.some((a) => a.ok !== true)) {
    const reason = `deep-show didn't run the kit (${run.error?.message ?? answers.find((a) => a.ok !== true)?.code ?? `status ${run.status}`}); build it with cargo build --locked --bin deep-show`;
    reply(requests.map(() => ({ verdict: 'BLOCKED', reason })));
    process.exit(0);
  }
} finally {
  rmSync(evidence, { recursive: true, force: true });
}

/** A kit reply's cases by fixture, and each part's verdict over the modules it ran on. */
function read(kit) {
  const cases = new Map(), parts = new Map();
  for (const module of kit.modules) {
    for (const part of module.parts) {
      parts.set(part.part, [...parts.get(part.part) ?? [], part.verdict]);
      for (const c of part.cases ?? []) if (c.fixture) cases.set(c.fixture, [...cases.get(c.fixture) ?? [], c]);
    }
  }
  return { cases, parts };
}
/** A fixture's verdict from its cases: a case BLOCKED on one backend and proved on another is proved. */
function judged(cases) {
  if (!cases?.length) return { verdict: 'BLOCKED', reason: 'the kit ran no case of this fixture' };
  const open = cases.filter((c) => !(c.verdict === 'BLOCKED' && c.backend && cases.some((o) => o.case === c.case && o.backend !== c.backend && o.verdict === 'PASS')));
  const verdict = worst(open.map((c) => c.verdict));
  const first = open.find((c) => c.verdict === verdict);
  const reason = verdict === 'PASS' ? undefined : first.failure?.code ?? first.probe ?? first.case;
  // The runner's words are PASS, FAIL and BLOCKED: a case the kit reads INVALID didn't hold.
  return { verdict: verdict === 'INVALID' ? 'FAIL' : verdict, ...(reason ? { reason } : {}) };
}
const digestOf = (cases) => sha256((cases ?? []).map((c) => [c.case, c.backend ?? null, c.verdict, c.compared?.actual ?? null, c.raised_codes ?? null]));
/** The comparisons a fixture's cases made, each with its own verdict and its planted mismatch's. */
const compared = (cases) => (cases ?? []).filter((c) => c.compared && c.twin).map((c) => ({ name: 'snapshot', verdict: c.verdict === 'PASS' ? 'PASS' : 'FAIL', twin: c.twin.verdict }));

const [manifest, kit, core] = answers[0].replies;
const sidecars = new Map(manifest.fixtures.map((f) => [f.name, f.sidecar]));
const first = { cases: read(kit).cases, parts: read(core).parts };
const twinRuns = rounds.map((_, i) => read(answers[1 + i].replies[0]));
const plantedRuns = new Map([...planted.keys()].map((name, i) => [name, read(answers[1 + rounds.length + i].replies[0])]));

reply(requests.map((r) => {
  const cases = first.cases.get(r.fixture);
  const part = PART_SCENES[r.fixture];
  if (!sidecars.has(r.fixture)) return { verdict: 'BLOCKED', reason: 'the kit\'s manifest lists no such fixture' };
  if (!r.twin) {
    const comparisons = compared(cases).map(({ name, verdict }) => ({ name, verdict }));
    if (part) {
      const verdict = worst(first.parts.get(part) ?? []);
      return { verdict: verdict === 'INVALID' ? 'FAIL' : verdict, digest: sha256([part, first.parts.get(part)]), backend: BACKEND, ...(verdict === 'PASS' ? {} : { reason: part }) };
    }
    return { ...judged(cases), digest: digestOf(cases), backend: BACKEND, ...(comparisons.length ? { comparisons } : {}) };
  }
  if (r.twin.planted) {
    // The planted program must break the part it names: the part's PASS under it is the twin passing.
    const verdicts = plantedRuns.get(r.twin.planted).parts.get(r.twin.part) ?? [];
    const cases = plantedRuns.get(r.twin.planted).cases.get(r.fixture);
    const verdict = part ? worst(verdicts) : judged(cases).verdict;
    return { verdict: verdict === 'PASS' ? 'PASS' : verdict === 'BLOCKED' ? 'BLOCKED' : 'FAIL', digest: sha256([r.twin.planted, verdicts, digestOf(cases)]), backend: BACKEND };
  }
  if (r.twin.comparison) {
    // The kit runs a comparison's planted mismatch inside the comparison, from the fixture's sidecar.
    const twin = sidecars.get(r.fixture).twin;
    const made = compared(cases);
    if (!twin || JSON.stringify([twin.path, twin.value]) !== JSON.stringify([r.twin.path, r.twin.value]) || !made.length) return { verdict: 'BLOCKED', reason: 'the fixture\'s sidecar holds no such planted mismatch' };
    const comparisons = made.map(({ name, twin: verdict }) => ({ name, verdict }));
    return { verdict: comparisons.every((c) => c.verdict === 'PASS') ? 'PASS' : 'FAIL', digest: sha256([r.twin, comparisons]), backend: BACKEND, comparisons };
  }
  const twinned = twinRuns[r.round].cases.get(r.fixture);
  return { ...judged(twinned), digest: digestOf(twinned), backend: BACKEND };
}));
