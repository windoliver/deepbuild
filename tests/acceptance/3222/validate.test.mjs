// This suite's own check (#3222): the validators the acceptance tests use must pass a well-formed spike and fail each
// planted fault, or those tests prove nothing. A synthetic spike in a temporary folder, the formats README.md gives;
// its list cites real lines of this checkout at the base commit the suite was written on. Carries no criterion: it
// passes on the base, where nothing of the spike exists.
// Run: node --test tests/acceptance/3222/validate.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  COUNTS, followUpProblems, heldBusyProblems, KINDS, listProblems, PATCHERS, percentile, plantedProblems, serviceOf, sha256, SPIKE, tableProblems, waitOf,
} from './validate.mjs';

const BASE = 'f8c6cff822b5b960d35312d75d44769616a95516';
const machine = { model: 'Mac15,12', cpus: 8, os: 'Darwin 27.2.0' };
const load = { start: [7.1, 9.2, 11.3], end: [8.4, 9.0, 11.1] };
const doc = (s, k = 0) => `01JB3222S${String(s).padStart(9, '0')}${String(k).padStart(8, '0')}`;
const row = (session, kind, d, t, wait, service, extra = {}) => ({ session, kind, doc: d, arrivedMs: t, startedMs: t + wait, repliedMs: t + wait + service, ...extra });

/** n sessions, each on a document of its own, each making the five kinds of call in turn. */
function mixed(n) {
  const calls = [];
  for (let s = 1; s <= n; s++) KINDS.forEach((kind, i) => calls.push(row(`s${s}`, kind, doc(s), 1e12 + 1000 * s + 100 * i, (s * 7 + i * 3) % 11, 5 + ((s + i) % 4))));
  return { date: '2026-11-23T10:00:00.000Z', machine, load, calls };
}
/** The 15 patching sessions, each showing its document then patching it, with or without the planted slow call. */
function patching(slow) {
  const calls = [];
  const t = 2e12;
  if (slow) calls.push(row('slow', 'render_back_3d', doc(99), t, 0, 9000, { planted: true }));
  for (let s = 1; s <= PATCHERS; s++) {
    calls.push(row(`p${s}`, 'revision', doc(s), t - 5000 + s, 1, 2));
    calls.push(row(`p${s}`, 'patch', doc(s), t + 10 * s, slow ? 9000 - 10 * s + s : s, 1));
  }
  return { date: '2026-11-23T11:00:00.000Z', machine, load, calls };
}
function table(out) {
  const kinds = {};
  for (const kind of [...new Set(out.calls.map((c) => c.kind))]) {
    const rows = out.calls.filter((c) => c.kind === kind);
    const q = (of) => { const s = rows.map(of).sort((a, b) => a - b); return { p50: percentile(s, 0.5), p95: percentile(s, 0.95) }; };
    kinds[kind] = { calls: rows.length, wait: q(waitOf), service: q(serviceOf) };
  }
  return kinds;
}
const cite = (file, line, text) => ({ file, line, text });
const CHAIN = cite('packages/hub/src/canvas.ts', 213, 'this.chain.then');
const WORLD = cite('packages/hub/src/canvas.ts', 218, 'this.send({ world: shaped })');
const EVIDENCE = cite('packages/hub/src/hub-canvas.ts', 385, 'this.options.evidence.stored(');
const KEPT = cite('crates/deep-show/src/canvas_side.rs', 153, 'self.calls.push(Value::Object(call));');

/** A well-formed spike: the record, its outputs and the README, as files under <dir>/docs/spikes/3222. */
function good() {
  const outs = { ...Object.fromEntries(COUNTS.map((n) => [`out/${n}.json`, mixed(n)])), 'out/slow.json': patching(true), 'out/without.json': patching(false) };
  const text = Object.fromEntries(Object.entries(outs).map(([k, v]) => [k, JSON.stringify(v)]));
  const heavy = JSON.stringify({ format: 1, profile: 'scene', title: 'Heavy', items: { a: { id: 'a', kind: 'mesh.box@1' } } });
  const record = {
    main: BASE,
    runs: Object.fromEntries(COUNTS.map((n) => [String(n), { command: `node docs/spikes/3222/harness.mjs --sessions ${n} --home <tmp> --out out/${n}.json`, out: `out/${n}.json`, sha256: sha256(text[`out/${n}.json`]), kinds: table(outs[`out/${n}.json`]) }])),
    planted: {
      fixture: { path: `${SPIKE}/heavy.json`, sha256: sha256(heavy) },
      slow: { command: 'node docs/spikes/3222/harness.mjs --sessions 15 --patches --slow --out out/slow.json', out: 'out/slow.json', sha256: sha256(text['out/slow.json']) },
      without: { command: 'node docs/spikes/3222/harness.mjs --sessions 15 --patches --out out/without.json', out: 'out/without.json', sha256: sha256(text['out/without.json']) },
      patches: Array.from({ length: PATCHERS }, (_, i) => {
        const [a, b] = ['out/slow.json', 'out/without.json'].map((f) => outs[f].calls.find((c) => c.session === `p${i + 1}` && c.kind === 'patch'));
        return { session: `p${i + 1}`, doc: doc(i + 1), slow: waitOf(a), without: waitOf(b) };
      }),
    },
    list: KINDS.map((kind) => ({
      kind,
      reads: [{ thing: 'world', ...WORLD }, { thing: 'document', ...KEPT }],
      writes: kind === 'check' ? [] : [{ thing: 'evidence', ...EVIDENCE }],
      follows: KINDS.map((k) => ({ kind: k, ...CHAIN })),
    })),
    followUp: { issue: 3300, title: 'Let one session\'s patch pass another\'s render-back', criteria: ['- [ ] A patch behind a 3D render-back of another document waits under a frame'] },
  };
  const readme = `# #3222\n\n| kind | p50 | p95 |\n${KINDS.map((k) => `| ${k} | 1 | 2 |`).join('\n')}\n\nFiled #3300.\n`;
  return { record, files: { ...text, 'README.md': readme }, heavy };
}
function spike(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'v3222-'));
  mkdirSync(join(dir, SPIKE, 'out'), { recursive: true });
  const { record, files, heavy } = good();
  const extra = { heavy };
  mutate(record, files, extra);
  for (const [name, body] of Object.entries(files)) if (body !== null) writeFileSync(join(dir, SPIKE, name), body);
  if (extra.heavy !== null) writeFileSync(join(dir, SPIKE, 'heavy.json'), extra.heavy);
  return { dir, record };
}
const run = (check, mutate) => { const { dir, record } = spike(mutate); try { return check(record, dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
/** Re-pins an output after a mutant changed it, so the mutant is caught by its substance, not its hash. */
const edit = (record, files, file, change, runOf) => {
  const out = JSON.parse(files[file]);
  change(out);
  files[file] = JSON.stringify(out);
  runOf(record).sha256 = sha256(files[file]);
};
const fails = (problems, pattern) => assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);

test('validator: a well-formed spike passes every check, with a follow-up or with the paragraph instead', () => {
  for (const check of [tableProblems, plantedProblems, listProblems, followUpProblems]) assert.deepEqual(run(check), [], check.name);
  const paragraph = 'The line stays: a patch waits behind another session\'s render-back only while one is in flight, which the readings show is rare.';
  assert.deepEqual(run(followUpProblems, (r, f) => { delete r.followUp; r.stays = paragraph; f['README.md'] += `\n${paragraph}\n`; }), []);
});

test('validator: criterion 1\'s check fails a table its kept output doesn\'t give', () => {
  fails(run(tableProblems, (r) => { r.runs['4'].kinds.patch.wait.p95 += 1; }), /runs\["4"\]: kinds\.patch\.wait\.p95/);
  fails(run(tableProblems, (r) => { delete r.runs['16']; }), /runs\["16"\]: the run with 16 sessions is missing/);
  fails(run(tableProblems, (r, f) => { f['out/1.json'] += ' '; }), /sha256 of out\/1\.json/);
  fails(run(tableProblems, (r, f) => edit(r, f, 'out/4.json', (o) => { o.calls = o.calls.filter((c) => c.kind !== 'render_back_3d'); }, (x) => x.runs['4'])), /runs\["4"\]: no render_back_3d call/);
  fails(run(tableProblems, (r, f) => edit(r, f, 'out/4.json', (o) => { o.calls[0].doc = doc(2); }, (x) => x.runs['4'])), /each session is on a document of its own/);
  fails(run(tableProblems, (r, f) => edit(r, f, 'out/16.json', (o) => { delete o.load; }, (x) => x.runs['16'])), /load\.start/);
  fails(run(tableProblems, (r, f) => edit(r, f, 'out/1.json', (o) => { delete o.machine.model; }, (x) => x.runs['1'])), /machine must name/);
  fails(run(tableProblems, (r) => { r.runs['4'].command = 'node docs/spikes/3222/harness.mjs --sessions 16'; }), /command doesn't run --sessions 4/);
  fails(run(tableProblems, (r) => { r.main = 'f'.repeat(40); }), /BLOCKED: main/);
});

test('validator: criterion 2\'s record check fails a slow-call run that isn\'t what the issue plants', () => {
  fails(run(plantedProblems, (r) => { r.planted.patches[3].slow += 5; }), /planted\.patches\[3\] \(p4\)\.slow/);
  fails(run(plantedProblems, (r, f) => edit(r, f, 'out/slow.json', (o) => { o.calls.find((c) => c.session === 'p2' && c.kind === 'patch').arrivedMs -= 1e6; }, (x) => x.planted.slow)), /p2's patch reached the hub at .* outside the slow call's flight/);
  fails(run(plantedProblems, (r, f) => edit(r, f, 'out/slow.json', (o) => { delete o.calls[0].planted; }, (x) => x.planted.slow)), /0 planted calls, not one/);
  fails(run(plantedProblems, (r, f) => edit(r, f, 'out/without.json', (o) => { o.calls = o.calls.filter((c) => c.session !== 'p7'); }, (x) => x.planted.without)), /14 patches, not 15/);
  fails(run(plantedProblems, (r, f, x) => { x.heavy = '{}'; }), /sha256 of docs\/spikes\/3222\/heavy\.json/);
  fails(run(plantedProblems, (r) => { r.planted.without.command += ' --slow'; }), /plants the slow call/);
});

test('validator: the held-busy check fails a harness that times each call from its start in the core, naming the call', () => {
  const held = { goAt: 1000, heldUntil: 7000, minWaitMs: 1000 };
  const right = { calls: [row('s1', 'revision', doc(1), 1200, 13000, 30), row('s1', 'patch', doc(1), 14300, 2, 10)] };
  assert.deepEqual(heldBusyProblems(right, held), []);
  const twin = { calls: right.calls.map((c) => ({ ...c, arrivedMs: c.startedMs })) };
  fails(heldBusyProblems(twin, held), new RegExp(`read a wait of 0 ms for session "s1"'s revision call on doc ${doc(1)}`));
  fails(heldBusyProblems({ calls: [row('s1', 'revision', doc(1), 1200, 100, 30)] }, held), /started in the core at 1300, before the calls held ahead of it could end/);
  fails(heldBusyProblems({ calls: [row('s1', 'revision', doc(1), 900, 13000, 30)] }, held), /before the go line/);
});

test('validator: criterion 3\'s check fails a list whose kinds, things or lines don\'t hold', () => {
  fails(run(listProblems, (r) => { r.list[0].reads[0].text = 'this text is not on that line'; }), /canvas\.ts:218 at main f8c6cff82 doesn't hold/);
  fails(run(listProblems, (r) => { r.list[0].reads[0].line = 99999; }), /has no line 99999/);
  fails(run(listProblems, (r) => { r.list = r.list.filter((x) => x.kind !== 'check'); }), /the kind check is not listed/);
  fails(run(listProblems, (r) => { r.list[1].follows.push({ kind: 'paint', ...CHAIN }); }), /"paint" is not a listed kind/);
  fails(run(listProblems, (r) => { r.list.find((x) => x.kind === 'patch').follows = []; }), /a patch doesn't follow a revision/);
  fails(run(listProblems, (r) => { r.list[2].writes = [{ thing: 'evidence', file: 'docs/technical-design.md', line: 1, text: 'DeepBuild technical design' }]; }), /is not a code path/);
  fails(run(listProblems, (r) => { r.list[3].reads = []; }), /reads nothing/);
});

test('validator: criterion 4\'s check fails neither, both, a follow-up with no criteria, and two paragraphs', () => {
  fails(run(followUpProblems, (r) => { delete r.followUp; }), /not both and not neither/);
  fails(run(followUpProblems, (r) => { r.stays = 'Stays.'; }), /not both and not neither/);
  fails(run(followUpProblems, (r) => { r.followUp.criteria = []; }), /its own acceptance criteria/);
  fails(run(followUpProblems, (r) => { r.followUp.issue = 3222; }), /filed apart from #3222/);
  fails(run(followUpProblems, (r, f) => { f['README.md'] = f['README.md'].replace('#3300', 'the follow-up'); }), /doesn't name the follow-up #3300/);
  fails(run(followUpProblems, (r, f) => { delete r.followUp; r.stays = 'One.\n\nTwo.'; f['README.md'] += '\nOne.\n\nTwo.\n'; }), /more than one paragraph/);
});
