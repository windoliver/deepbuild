// #1938 on film: each loop fixture the blind suites judge (tests/acceptance/1938/helpers.ts and the contrast redraft's),
// its planted fault and clean twin judged by `verdict` and drawn by render-back, the product's own snapshot; then the
// fix the check names, sent back as the working agent's patch, drawn and judged again. Writes PNGs and verdicts.json.
// `node render.mjs <deep-show> <out dir>`
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as first from '../../../tests/acceptance/1938/helpers.ts';
import * as redraft from '../../../tests/acceptance/1938-redraft-contrast/helpers.ts';

const [bin, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SESSION = 'sess-alpha';
const ulid = (p, n) => `${p}${String(n).padStart(26 - p.length, '0')}`;
const FRAME = 705_600_000 / 60;

/** A copy render-back can draw, and you can see: a mark with no paint and no material takes the accent role (the
 * checks read none), a scene with no camera item the suite's camera, and a scene with no light a sun at π lx, since
 * under the fixtures' sky with no ambient a surface no light reaches draws black (unlit materials are unchanged). What
 * it adds is listed with each picture. */
function drawable(doc) {
  const d = structuredClone(doc);
  const added = [];
  if (d.camera && !d.items?.[d.camera]) {
    d.items[d.camera] = { id: d.camera, name: d.camera, order: 'a', layer: 'alpha-main', ...first.CAM };
    added.push("the suite's camera");
  }
  let painted = false;
  for (const item of Object.values(d.items ?? {})) {
    if (String(item.kind ?? '').startsWith('mark.') && !item.material && !item.params?.paint) {
      item.params = { ...item.params, paint: { fill: { role: 'accent' } } };
      painted = true;
    }
  }
  if (painted) added.push('the accent role on marks that name no paint');
  const is3d = Object.values(d.items ?? {}).some((i) => String(i.kind ?? '').includes('.') && !String(i.kind).startsWith('text@'));
  const lit = Object.values(d.items ?? {}).some((i) => String(i.kind ?? '').startsWith('light.'));
  if (is3d && !lit && d.camera) {
    d.items['display-sun'] = { id: 'display-sun', name: 'display-sun', order: 'zz', layer: 'alpha-main', kind: 'light.sun@1', params: { illuminance: Math.PI, shadow: false }, at: { rot: [-60, 30, 0] } };
    added.push('a sun at π lx');
  }
  return { doc: d, added };
}
const needsPaint = (doc) => drawable(doc).added.length > 0;

function scenario(evidence, docs, claims, calls) {
  return first.scenarioOf(evidence, docs, claims, calls);
}
function runOnce(evidence, docs, claims, calls) {
  const r = spawnSync(bin, ['run'], { input: `${JSON.stringify(scenario(evidence, docs, claims, calls))}\n`, encoding: 'utf8', maxBuffer: 1 << 28 });
  const answer = JSON.parse(r.stdout.trim().split('\n')[0]);
  if (!answer.ok) throw Error(JSON.stringify(answer).slice(0, 2000));
  return answer.replies;
}
function keep(evidence, reply, name) {
  const sha = reply?.snapshots?.[0]?.sha256;
  if (!sha) return { name, refused: reply };
  copyFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), join(out, `${name}.png`));
  return { name, png: `${name}.png` };
}
/** The fix ops of the row's issue of `kind`. */
function opsOf(row, kind) {
  for (const i of row.issues ?? []) if ((i.check === kind) && i.severity === 'error') {
    const ops = Array.isArray(i.fix_ops) ? i.fix_ops : Array.isArray(i.fix) ? i.fix : null;
    if (ops?.length) return { issue: i, ops };
  }
  return null;
}
const rowOf = (reply) => reply.requirements[0];

/** One pair: verdicts and renders of both, then the planted document patched with its fix, rendered and judged again. */
function pair(name, p, opts = {}) {
  const evidence = mkdtempSync(join(tmpdir(), `ev-1938-${name}-`));
  for (const b of p.both ?? []) first.putEvidence(evidence, b);
  const twinEvidence = p.twinOnly ? mkdtempSync(join(tmpdir(), `ev-1938-${name}-twin-`)) : evidence;
  for (const b of p.twinOnly ?? []) first.putEvidence(twinEvidence, b);
  for (const b of p.both ?? []) first.putEvidence(twinEvidence, b);
  const kind = p.check.kind;
  const [P, T, PD, TD] = ['P', 'T', 'PD', 'TD'].map((s, k) => first.docId(k + 1));
  const paint = needsPaint(p.planted);
  const shownP = paint ? PD : P;
  const shownT = paint ? TD : T;
  const at = opts.at ?? [0];
  const judge = (ev, doc, docs, n) => {
    const claims = { [first.claimId(n)]: first.claimOf(doc, first.reqId(n), p.check) };
    return { claims, call: first.verdict(first.claimId(n)) };
  };
  const renders = (doc, rev, tag) => at.map((t) => ({ call: 'render_back', session: SESSION, doc, t: Math.round(t), rev, tag }));
  // The planted document, in its own store.
  const docsP = { [P]: p.planted, ...(paint ? { [PD]: drawable(p.planted).doc } : {}) };
  const jp = judge(evidence, P, docsP, 1);
  const callsP = [jp.call, ...renders(shownP, 0)];
  const repP = runOnce(evidence, docsP, jp.claims, callsP.map(({ tag, ...c }) => c));
  const plantedRow = rowOf(repP[0]);
  const plantedPngs = repP.slice(1).map((r, k) => keep(evidence, r, `${name}-planted${at.length > 1 ? `-${k}` : ''}`));
  // The twin, in its store.
  const docsT = { [T]: p.twin, ...(paint ? { [TD]: drawable(p.twin).doc } : {}) };
  const jt = judge(twinEvidence, T, docsT, 2);
  const repT = runOnce(twinEvidence, docsT, jt.claims, [jt.call, ...renders(shownT, 0).map(({ tag, ...c }) => c)]);
  const twinRow = rowOf(repT[0]);
  const twinPngs = repT.slice(1).map((r, k) => keep(twinEvidence, r, `${name}-twin${at.length > 1 ? `-${k}` : ''}`));
  // The fix, applied as the working agent's patch, then drawn and judged again.
  const fix = opsOf(plantedRow, kind);
  let fixed = null;
  if (fix) {
    const patchOf = (doc, n) => ({ call: 'deep_show', session: SESSION, doc, patch: { patch: ulid('01JB1938P', n), doc, base: 0, reason: `the fix ${kind} names`, ops: fix.ops } });
    const calls = [patchOf(P, 1), ...(paint ? [patchOf(PD, 2)] : []), jp.call, ...renders(shownP, 1).map(({ tag, ...c }) => c)];
    const rep = runOnce(evidence, docsP, jp.claims, calls);
    const k = paint ? 2 : 1;
    fixed = {
      patch: rep[0].outcome ?? rep[0],
      row: rowOf(rep[k]),
      pngs: rep.slice(k + 1).map((r, j) => keep(evidence, r, `${name}-fixed${at.length > 1 ? `-${j}` : ''}`)),
    };
  }
  return { name, kind, check: p.check, painted: paint, added: drawable(p.planted).added, planted: { row: plantedRow, pngs: plantedPngs }, twin: { row: twinRow, pngs: twinPngs }, fix: fix?.ops ?? null, fixed };
}

const results = [
  pair('framing', first.framingPair()),
  pair('exposure', first.exposurePair()),
  pair('contrast', { planted: redraft.captionBoard(redraft.UNDER), twin: redraft.captionBoard(redraft.CLEAR), check: { kind: 'render.contrast' } }),
  pair('overlap', first.overlapPair()),
  pair('floating', first.floatingPair()),
  pair('door', first.scalePair()),
  pair('texture', first.texturePair()),
  pair('noise', first.noisePair(), { at: Array.from({ length: 24 }, (_, k) => k * FRAME) }),
  pair('overclass', first.overClassPair()),
];
writeFileSync(join(out, 'verdicts.json'), `${JSON.stringify(results, null, 2)}\n`);
for (const r of results) {
  const res = (x) => x?.row?.result ?? '—';
  console.log(`${r.name.padEnd(10)} planted ${res(r.planted)}  twin ${res(r.twin)}  fix ${r.fix ? `${r.fix.length} op(s), patch ${JSON.stringify(r.fixed?.patch).slice(0, 40)}, after ${res(r.fixed)}` : 'none'}  ${[...r.planted.pngs, ...r.twin.pngs].filter((p) => p.refused).map((p) => `${p.name} refused ${JSON.stringify(p.refused).slice(0, 120)}`).join(' ')}`);
}
