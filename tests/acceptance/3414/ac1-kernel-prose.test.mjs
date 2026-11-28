import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { BASE, CANVAS, DESIGN, DOCS, baseFile, checksOf, commit, docRefs, failingLines, kernelWords, laneCommands, laneEnv, lineOf, makeCopy, namesLine, plantFile, plantParagraph, proseLines, readIn, runCommands, summary } from './helpers.mjs';

const ID = '#3414.9c056d2c';
const LAYER = 'The kernel keeps the record.';
const NINTH = "On Linux the kernel's out-of-memory killer picks the largest process to stop.";
const BASE_LAYER = [
  [DESIGN, 'Everything beyond the kernel and the trusted ring'],
  [DESIGN, 'The kernel is only a contract'],
  [DESIGN, 'The kernel owns only the contract group'],
  [DESIGN, 'The only state the kernel keeps'],
  [DESIGN, 'The kernel holds the document contract'],
  [CANVAS, 'The kernel holds only this contract'],
];
const cleanups = [];
after(() => { for (const clean of cleanups.reverse()) clean(); });
const cleanup = (fn) => cleanups.push(fn);

let planted;
function plantedRun() {
  planted ??= (async () => {
    const { sandbox, repo } = makeCopy(cleanup);
    const env = laneEnv(sandbox);
    const plants = [];
    for (const [i, doc] of DOCS.entries()) {
      const { text, line } = plantParagraph(readIn(repo, doc), LAYER, 2 + i);
      plantFile(repo, doc, text);
      plants.push({ doc, line, what: LAYER });
    }
    const design = plantParagraph(readIn(repo, DESIGN), NINTH, 40);
    plantFile(repo, DESIGN, design.text);
    for (const p of plants) if (p.doc === DESIGN && p.line > design.line - 2) p.line += 2;
    const ninth = { doc: DESIGN, line: lineOf(design.text, NINTH), what: NINTH };
    for (const p of plants) assert.equal(readIn(repo, p.doc).split('\n')[p.line - 1], p.what, `the plant in ${p.doc} is not at line ${p.line}`);
    commit(repo, 'change: planted kernel lines');
    const all = laneCommands(repo, env, 'lint');
    const runs = await runCommands(repo, env, all);
    const naming = (p) => failingLines(runs, (l) => namesLine(l, p.doc, p.line));
    const found = [...plants, ninth].flatMap(naming);
    return { plants, ninth, runs, naming, checks: checksOf(found) };
  })();
  return planted;
}

const noCheck = (runs) => `no lint lane command fails naming a planted kernel line, so no command of the lint lane reads kernel in the docs' prose\n${summary(runs)}`;

test(`${ID} AC1: a planted "${LAYER}" in the prose of each design doc and of docs/parallel-proof.md fails, naming the file and the line`, { timeout: 1_800_000 }, async () => {
  const { plants, runs, naming } = await plantedRun();
  const unnamed = plants.filter((p) => !naming(p).length).map((p) => `${p.doc}:${p.line}`);
  assert.deepEqual(unnamed, [], `no failing lint lane command names these planted lines:\n${unnamed.join('\n')}\n${summary(runs)}`);
});

test(`${ID} AC1: a planted ninth kernel of another kind, with no reason in the check, fails, naming it`, { timeout: 1_800_000 }, async () => {
  const { ninth, runs, naming } = await plantedRun();
  assert.ok(naming(ninth).length, `no failing lint lane command names the planted "${NINTH}" at ${ninth.doc}:${ninth.line}\n${summary(runs)}`);
});

test(`${ID} AC1: the docs as they are pass the check, with the places that name another kind of kernel still in them`, { timeout: 1_800_000 }, async () => {
  const { checks, runs } = await plantedRun();
  assert.ok(checks.length, noCheck(runs));
  const { sandbox, repo } = makeCopy(cleanup);
  commit(repo, 'change: nothing more');
  const real = await runCommands(repo, laneEnv(sandbox), checks);
  const failing = real.filter((r) => r.status !== 0);
  assert.deepEqual(failing.map((r) => r.name), [], `the check fails on the docs as they are:\n${summary(real)}`);
  const kept = DOCS.flatMap((doc) => proseLines(readIn(repo, doc)).filter(({ line }) => kernelWords(line)).map(({ index }) => `${doc}:${index + 1}`));
  assert.ok(kept.length >= 8, `the docs' prose names kernel on ${kept.length} lines, fewer than the 8 places of another kind the check lists: ${kept.join(', ')}`);
});

test(`${ID} AC1: on the merge base ${BASE} the check fails, naming each line that calls the core the kernel, and shows its count`, { timeout: 1_800_000 }, async () => {
  const { checks, runs } = await plantedRun();
  assert.ok(checks.length, noCheck(runs));
  const { sandbox, repo } = makeCopy(cleanup);
  const texts = Object.fromEntries(DOCS.map((doc) => [doc, baseFile(doc)]));
  for (const doc of DOCS) plantFile(repo, doc, texts[doc]);
  commit(repo, `change: the three docs as the merge base ${BASE} holds them`);
  const base = await runCommands(repo, laneEnv(sandbox), checks);
  assert.ok(base.some((r) => r.status !== 0), `the check passes on the merge base's docs:\n${summary(base)}`);
  const unnamed = BASE_LAYER.map(([doc, words]) => [doc, lineOf(texts[doc], words)])
    .filter(([doc, line]) => !failingLines(base, (l) => namesLine(l, doc, line)).length).map(([doc, line]) => `${doc}:${line}`);
  assert.deepEqual(unnamed, [], `on the merge base no failing check names these lines, which call the core the kernel:\n${unnamed.join('\n')}\n${summary(base)}`);
  const findings = failingLines(base, (l) => docRefs(l).length);
  const counts = new Set([new Set(findings.flatMap((f) => docRefs(f.line))).size, findings.length]);
  const others = failingLines(base, (l) => !docRefs(l).length).map((f) => f.line);
  const shown = others.some((l) => [...counts].some((n) => new RegExp(`(?<![\\d.:])${n}(?![\\d.])`).test(l)));
  assert.ok(shown, `the check's run on the merge base shows no count of its ${[...counts].join(' or ')} findings:\n${others.join('\n')}`);
});
