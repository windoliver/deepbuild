// #416.0e66795c: "Budgets, on the reference Mac in the local preflight, compared with the merge base: an interface's
// fixtures run once per library hash in under 5 s; a 16 MiB asset validates once per hash in under 0.2 s; and a piece
// that names no interface or layout gains no work at check or per frame". This file is the criterion's layout half
// (the 16 MiB asset, and a piece that names no layout); tests/acceptance/416/interfaces/ holds its interface half.
//
// A 16 MiB asset: six 16 MiB weights files of six hashes in test/nnweights@1.0.0's layout, each validated once in one
// deep-show process: each admitted, its validator run once (`sandbox` runs + 6), and the same bytes again under another
// path run nothing; each verdict's `ms` (README: The surface) is its validator run's own time. The first is a warm-up;
// the other five are judged against 200 ms by the design's rule, only on a fit reference Mac (Mac15,7 or Mac15,12, Low
// Power Mode off, thermal state nominal, a 1-minute load at most the core count); elsewhere, or between the limit and
// the margin, the test fails INCONCLUSIVE, never passes. The merge base names no `ms`, so the limit is the issue's.
// No work for a piece naming no layout (counts, read on every Mac before the timing is judged): a board whose logic item
// names a data asset whose envelope entry names no layout, beside a moving rect, with the pack installed, on this build
// and on the merge base's (`git merge-base HEAD origin/main`, built in its own kept folder): its check adds the same
// sandbox counts, each of 60 frames runs as many nodes, and here no frame checks, rewrites or runs anything.
//
// Wrong programs it fails on: a verdict without its run's time, a validator run again for a hash it has run, a 16 MiB
// validation past 0.2 s, and a piece naming no layout that runs a validator or adds a node per frame.

import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASE_TIMEOUT, DOC, SANDBOX, arr, baseDeepShow, countsOf, deepShow, environmentProblem, frames, inconclusive, installPack, judgeRuns, minus, num, obj,
  presented, putEvidence, runShow, scenario, sha256, show, showDoc, sub, useTemp, validate, type JsonObject,
} from './helpers.ts';
import { COUNT_16_MIB, GOOD, LAYOUT, MIB, MOVING, board, checkFixtures, dataAsset, mover, program, readerItem, weights, weightsPack } from './fixtures.ts';

const ID = '#416.0e66795c';
const LIMIT_MS = 200;
const temp = useTemp();

describe(`${ID} budgets against the merge base: a 16 MiB asset validated once per hash in under 0.2 s, and no work for a piece naming no layout`, () => {
  it(`${ID} a 16 MiB asset validates once per hash in under ${LIMIT_MS} ms on the reference Mac (five assets after a warm-up), and a piece that names no layout gains no work at check or per frame against the merge base`, () => {
    if (process.platform !== 'darwin') inconclusive(`the budgets are the reference Mac's; this host is ${process.platform}/${process.arch}`);
    checkFixtures();
    const root = temp();
    const pack = weightsPack(sub(root, 'packs'));

    // A 16 MiB asset, once per hash.
    const files = sub(root, 'files');
    const assets = [1, 2, 3, 4, 5, 6].map((k) => {
      const bytes = weights(COUNT_16_MIB, { first: k });
      expect(bytes.length, 'a weights file of 16 MiB').toBe(16 * MIB);
      const path = join(files, `weights-${k}.nnw`);
      writeFileSync(path, bytes);
      return { path, sha: sha256(bytes) };
    });
    const again = join(files, 'weights-1-again.nnw');
    copyFileSync(assets[0]!.path, again);
    const r = runShow(deepShow(), scenario(sub(root, 'evidence-16'), [], [
      installPack(pack), SANDBOX, ...assets.map((a) => validate(LAYOUT, a.path)), SANDBOX, validate(LAYOUT, again), SANDBOX,
    ]));
    expect(r[0]!['outcome'], `test/nnweights@1.0.0 installs: ${show(r[0])}`).toBe('installed');
    const verdicts = r.slice(2, 2 + assets.length);
    verdicts.forEach((v, k) => {
      expect({ outcome: v['outcome'], asset: v['asset'], size: v['size'], layout: v['layout'] }, `16 MiB asset ${k + 1} is admitted: ${show(v)}`)
        .toEqual({ outcome: 'admitted', asset: assets[k]!.sha, size: 16 * MIB, layout: LAYOUT });
    });
    const ms = verdicts.map((v, k) => num(v['ms'], `16 MiB asset ${k + 1}: the verdict's ms, its validator run's own time (README: The surface)`));
    ms.forEach((m, k) => expect(m, `16 MiB asset ${k + 1}: its run takes some time`).toBeGreaterThan(0));
    const [c0, c1, c2] = [r[1]!, r[2 + assets.length]!, r[4 + assets.length]!].map((c, i) => countsOf(c, `sandbox ${i}`));
    expect(c1!.runs - c0!.runs, 'six assets of six hashes ran the validator six times, once each').toBe(assets.length);
    const repeat = r[3 + assets.length]!;
    expect({ outcome: repeat['outcome'], asset: repeat['asset'] }, `the first asset's bytes under another path keep their verdict: ${show(repeat)}`)
      .toEqual({ outcome: 'admitted', asset: assets[0]!.sha });
    expect(c2!.runs - c1!.runs, 'the same bytes again ran no validator: once per hash').toBe(0);

    // No work at check or per frame for a piece that names no layout, against the merge base.
    const doc = DOC(1);
    const piece = board('No layout', { reader: readerItem([sha256(GOOD)]), mover: mover() }, { ...MOVING, assets: { weights: dataAsset(GOOD) } });
    const calls: JsonObject[] = [installPack(pack), SANDBOX, showDoc(doc, piece), SANDBOX, frames(doc, 60), SANDBOX];
    const evidence = (name: string): string => {
      const e = sub(root, name);
      for (const b of [program.reader().bytes, GOOD]) putEvidence(e, b);
      return e;
    };
    const here = runShow(deepShow(), scenario(evidence('evidence-here'), [doc], calls));
    const base = baseDeepShow();
    const there = runShow(base.bin, scenario(evidence('evidence-base'), [doc], calls));
    const onBase = `on the merge base ${base.sha.slice(0, 12)}`;
    for (const [s, w] of [[here, 'here'], [there, onBase]] as const) {
      expect(s[0]!['outcome'], `test/nnweights@1.0.0 installs ${w}: ${show(s[0])}`).toBe('installed');
      presented(s[2]!, `the piece that names no layout ${w}`);
    }
    const added = (s: JsonObject[], w: string) => minus(countsOf(s[3]!, `sandbox after the check ${w}`), countsOf(s[1]!, `sandbox before the check ${w}`));
    expect(added(here, 'here'), `checking the piece adds the sandbox work it adds ${onBase}`).toEqual(added(there, onBase));
    const ran = (s: JsonObject[], w: string): number[] => arr(s[4]!['frames'], `frames ${w}`).map((f, i) => num(obj(f, `frames ${w}[${i}]`)['ran'], `frames ${w}[${i}].ran`));
    expect(ran(here, 'here'), `each of 60 frames runs as many nodes as ${onBase}`).toEqual(ran(there, onBase));
    expect(countsOf(here[5]!, 'sandbox after the frames'), 'no frame checked, rewrote or ran a program').toEqual(countsOf(here[3]!, 'sandbox before the frames'));

    // The 16 MiB validations' times, judged only on a fit reference Mac.
    const problem = environmentProblem();
    if (problem) inconclusive(`a 16 MiB asset validated in ${ms.slice(1).map((m) => m.toFixed(1)).join(', ')} ms, read off this machine: ${problem}`);
    const judged = judgeRuns(`${ID} a 16 MiB asset's validation (ms)`, ms.slice(1), LIMIT_MS);
    console.log(`${judged.status} ${judged.shown}`);
    expect(judged.status, judged.shown).not.toBe('FAIL');
    if (judged.status === 'INCONCLUSIVE') inconclusive(judged.shown);
  }, BASE_TIMEOUT);
});
