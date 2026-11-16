// AC6 #1164.9ffde386: "logic.budget passes with the busiest step under half its fuel. A planted program that loops
// forever on a press of 9 traps with kind fuel at the same function and offset in two runs; the board keeps its last
// good values, logic.trap names the step, the function, the offset and the press, and the claim reads FAIL, never PASS"
//
// asserts: the game played with keys (README: The play); the claim's logic.budget row reads PASS; deep_query's fuel at
// every step of the 12 s is under half the item's fuel budget (1,000,000); no trap. Wrong program: the `loops_on_9`
// build, played twice, each in its own `deep-show run`: deep_query's `trap` (logic.trap) has kind fuel, the step of the
// press of 9 (step 210, 7 s), the same function and offset in both runs, and the press of 9 among its inputs;
// `rules.board` and `rules.winner` read [1, 1, 1, 2, 2, 0, 0, 0, 0] and 1 from that step on (the last good values);
// the claim reads FAIL; and AC6's judgement fails it, naming the criterion.
import { describe, expect, it } from 'vitest';
import {
  AC, FINAL, FUEL, REQ, STEPS, Script, TIMEOUT, failsNaming, findAll, game, int, isObject, keepProof, none, prebuild, program, putEvidence,
  queryCall, readOf, runShow, same, scalar, scenario, show, showBin, stepOf, playedOf, useDir, verdictCall, verdictOf, type Read, type Rules,
  type Verdict, type Entry,
} from './helpers.ts';

prebuild(() => { showBin(); program('rules'); program('loops_on_9'); });
const dir = useDir();
const ALL = Array.from({ length: STEPS }, (_, k) => k);

interface Played { entries: Entry[]; read: Read; verdict: Verdict }
function play(name: Rules, what: string): Played {
  const p = program(name);
  putEvidence(dir(), p.bytes);
  const s = new Script(game(p.sha));
  const q = s.add((at) => queryCall(at, ALL));
  const v = s.add(verdictCall);
  const r = runShow(scenario(dir(), s.calls), what);
  keepProof(`ac6-${what.replace(/\W+/g, '-')}.json`, { query: r[q], verdict: r[v] });
  return { entries: playedOf(r, s, what), read: readOf(r[q]!, `${what}: deep_query`), verdict: verdictOf(r[v]!, `${what}: the verdict`) };
}

/** AC6's judgement: logic.budget passes, the busiest step under half the fuel budget, no trap. */
function judge(g: Played): string[] {
  const out: string[] = [];
  const row = g.verdict.rows.get(REQ.budget);
  if (row?.['result'] !== 'PASS') out.push(`${AC[6]} logic.budget reads ${show(row?.['result'])}, not PASS: ${show(row ?? g.verdict.raw, 1200)}`);
  const fuel = ALL.map((k) => g.read.steps.get(k)?.fuel ?? null);
  const missing = fuel.findIndex((f) => f === null);
  if (missing >= 0) out.push(`${AC[6]} deep_query reads no fuel at step ${missing}`);
  const busiest = Math.max(...fuel.map((f) => f ?? 0));
  const k = fuel.indexOf(busiest);
  if (!(busiest < FUEL / 2)) out.push(`${AC[6]} the busiest step, ${k}, used ${busiest} fuel: not under half of ${FUEL}`);
  if (g.read.trap) out.push(`${AC[6]} rules trapped (logic.trap): ${show(g.read.trap)}`);
  return out;
}

describe(`${AC[6]} the budget, and a program that loops forever`, () => {
  it(`${AC[6]} logic.budget passes with the busiest step under half its fuel`, () => {
    none(judge(play('rules', 'AC6: the game')), 'AC6: logic.budget passes with the busiest step under half its fuel');
  }, TIMEOUT);

  it(`${AC[6]} wrong program: a program that loops forever on a press of 9 (loops_on_9) traps with kind fuel at the same function and offset in two runs, the board keeps its last good values, logic.trap names the step, the function, the offset and the press, and the claim reads FAIL`, () => {
    const runs = [play('loops_on_9', 'AC6: loops_on_9, run 1'), play('loops_on_9', 'AC6: loops_on_9, run 2')];
    const nine = runs[0]!.entries[6]!;
    const at = stepOf(nine.t);
    const traps = runs.map((g, i) => {
      const t = g.read.trap;
      expect(isObject(t), `AC6: run ${i + 1}: logic.trap is reported for rules: ${show(t)}`).toBe(true);
      return t!;
    });
    traps.forEach((t, i) => {
      expect(t['kind'], `AC6: run ${i + 1}: the trap's kind: ${show(t)}`).toBe('fuel');
      expect(t['step'], `AC6: run ${i + 1}: logic.trap names the step of the press of 9: ${show(t)}`).toBe(at);
      int(t['function'], `AC6: run ${i + 1}: logic.trap names the function`);
      int(t['offset'], `AC6: run ${i + 1}: logic.trap names the offset`);
      const inputs = findAll(t, 'inputs').flatMap((x) => (Array.isArray(x) ? x : []));
      expect(inputs.some((e) => isObject(e) && e['control'] === 'c9' && e['t'] === nine.t), `AC6: run ${i + 1}: logic.trap names the press of 9 (${show(nine.raw)}) among its inputs: ${show(t)}`).toBe(true);
    });
    expect([traps[1]!['function'], traps[1]!['offset']], 'AC6: the same function and offset in two runs').toEqual([traps[0]!['function'], traps[0]!['offset']]);
    runs.forEach((g, i) => {
      for (const k of [at - 1, at, STEPS - 1]) {
        const s = g.read.steps.get(k);
        expect(same(s?.board, FINAL) && same(scalar(s?.winner), 1), `AC6: run ${i + 1}: step ${k}: the board keeps its last good values ${show(FINAL)}, winner 1; got ${show(s)}`).toBe(true);
      }
      expect(g.verdict.result, `AC6: run ${i + 1}: the claim reads FAIL, never PASS: ${show(g.verdict.raw, 1500)}`).toBe('FAIL');
    });
    failsNaming(judge(runs[0]!), AC[6], [/logic\.budget|trap/], 'AC6: loops_on_9');
  }, TIMEOUT);
});
