// #2645 AC3: for every transcript of #20's fixtures and of the corpus's recorded sessions, with the newest call placed
// in the first block, the last block and across a block's edge, the list and the readings are the merge base's; and a
// planted reader that drops a line cut by a block's edge fails that check, naming the line (the twins listed for AC3
// in twins.json, and the untagged test below).
//
// Each transcript gets this suite's newest TodoWrite call (Codex: update_plan, and a goal call) in each of the three
// places (helpers.ts, `variant`), and is read as the hub reads it (`compare`): whole by a reader that never read it, and
// written in steps, the newest goal record and the newest call each half written first, by one reader at each step. The
// list is what a claim leaves open with every item counted open (OpenItems.atClaim); the readings are codexReadings'
// whole answer. The merge base's are merge-base.ts's on the same bytes.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { removeTemps as removeTwentyTemps } from '../20/helpers.ts';
import { compare, corpusSources, fmt, hubReaders, must, PLACEMENTS, plantedReaders, removeTemps, tempDir, twentySources, variant, type Source } from './helpers.ts';

const AC3 = 'AC3 #2645.b55ba6ee';

afterAll(() => {
  removeTemps();
  removeTwentyTemps();
});

describe(`${AC3} the list and the readings are the merge base's, the newest call in the first block, the last block and across a block's edge`, () => {
  it(`${AC3} every transcript of #20's fixtures and the corpus's recorded sessions, read whole and as it is written: the hub's list and readings equal the merge base's`, async () => {
    const dir = tempDir('same');
    const sources = [...twentySources(join(dir, 'home')), ...corpusSources()];
    const kinds = new Set(sources.map((s) => s.agent));
    if (!kinds.has('claude-code') || !kinds.has('codex') || sources.length < 50) throw new Error(`BLOCKED: ${AC3} expected #20's four fixtures and the corpus's Claude Code and Codex transcripts, found ${sources.length}: ${sources.map((s) => s.label).join(', ')}`);
    const hub = hubReaders(join(dir, 'repo'));
    let checked = 0;
    const differ: string[] = [];
    for (const src of sources) {
      for (const placement of PLACEMENTS) {
        const r = await compare(src, variant(src, placement), hub, join(dir, 'files'), join(dir, 'repo'));
        checked += r.checked;
        differ.push(...r.differ);
        rmSync(join(dir, 'files'), { recursive: true, force: true });
      }
    }
    must(differ.length === 0, `${AC3} ${fmt(differ.length)} of ${fmt(checked)} reads of ${sources.length} transcripts differ from the merge base's:\n${differ.slice(0, 8).join('\n')}${differ.length > 8 ? `\n… and ${fmt(differ.length - 8)} more` : ''}`);
  }, 1_800_000);
});

// Not a criterion's test, so it carries no tag: it checks this suite's own check, which passes or fails the same on any
// program under test. The issue's planted reader is the twins list-drops-cut-line and readings-drops-cut-line
// (twins.json), on which the test above fails at its assertion; this one holds the check to the issue's "fails, naming
// the line", with the same wrong reader in test code (planted.ts) at four block sizes.
describe("the check names the line a planted reader drops", () => {
  it("a reader that drops a line cut by a block's edge, at blocks of 4 KiB to 2 MB, fails the check above with a message naming the newest call's line, and a rollout's goal record's", async () => {
    const dir = tempDir('planted');
    const corpus = corpusSources();
    const pick = (label: string): Source => {
      const src = corpus.find((s) => s.label === label);
      if (!src) throw new Error(`BLOCKED: the corpus has no ${label}`);
      return src;
    };
    const sources = [pick('corpus claude-code/2.1.308/tools'), pick('corpus codex/0.160.0/goal')];
    for (const block of [4096, 65_536, 1_048_576, 2_000_000]) {
      for (const src of sources) {
        const v = variant(src, "across a block's edge");
        const r = await compare(src, v, plantedReaders(block, join(dir, 'repo')), join(dir, 'files'), join(dir, 'repo'));
        rmSync(join(dir, 'files'), { recursive: true, force: true });
        const said = r.differ.join('\n');
        must(r.differ.length > 0, `the planted reader with blocks of ${fmt(block)} bytes must fail the check on ${src.label}, its newest call ${fmt(Buffer.byteLength(v.lines[v.at]!))} bytes long: it passed all ${r.checked} reads`);
        must(r.differ.some((d) => d.includes(`the list is not the merge base's`) && d.includes(`on line ${v.at + 1} (${v.callId}`)), `the planted reader's failure on ${src.label} must name the line its blocks cut, line ${v.at + 1} (${v.callId}); it said:\n${said.slice(0, 3000)}`);
        if (v.goalAt !== undefined) must(r.differ.some((d) => d.includes(`the readings are not the merge base's`) && d.includes(`goal record is line ${v.goalAt! + 1} `)), `the planted reader's failure on ${src.label}'s readings must name the goal record its blocks cut, line ${v.goalAt + 1}; it said:\n${said.slice(0, 3000)}`);
      }
    }
  }, 900_000);
});
