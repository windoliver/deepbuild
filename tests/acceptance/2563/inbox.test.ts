// #2563: every option ID an ask may carry answers it when typed back as `deep inbox` printed it, and an ID it may not
// carry is refused when the ask is raised, naming the ID and why. Against a live hub (README).
// AC1 #2563.644f8f08 (one test per kind of ID), AC2 #2563.1937a1ef.
import { afterAll, describe, expect, test } from 'vitest';
import { blockOf } from '../2199/helpers.ts';
import {
  allEventsOf, answerTyped, CASES, cleanup, deep, givesOption, ID, jsonRows, makeWorld, printedForms, probe, refusalFailures, sessionsOf, shArgs, shown, shownOf,
  type AskSpec, type Raised, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

let probed: ReturnType<typeof probe> | undefined;
/** Which of the fixture's asks the asks core lets be raised, and what it told the others. */
const raised = (): ReturnType<typeof probe> => (probed ??= probe());
let made: Promise<World> | undefined;
/** One world holding an open ask for every case the asks core lets be raised. */
const world = (): Promise<World> => (made ??= raised().then((p) => makeWorld(sessionsOf(CASES.filter((c) => p.cases.get(c.id)?.carried).map((c) => c.spec)))));
const specOf = (question: string): AskSpec => CASES.find((c) => c.spec.question === question)!.spec;
const said = (r: Raised | undefined): string => (r === undefined ? 'never raised' : r.carried ? 'raised' : `refused: ${r.refusal.slice(0, 400)}`);

describe(ID.answers, () => {
  for (const c of CASES) {
    test(`${ID.answers}: an option ID that ${c.kind}, typed back into a shell as deep inbox printed it, answers its ask with that option`, async () => {
      const p = await raised();
      expect(p.control, 'the probe raises an ask whose IDs every reading allows (serif, sans); otherwise it proves nothing').toEqual({ carried: true });
      const r = p.cases.get(c.id)!;
      if (!r.carried) {
        // An ID the ask may not carry is out of this criterion; it counts only if its refusal is criterion 2's.
        console.log(`${JSON.stringify(c.id)} is refused when the ask is raised: ${r.refusal}`);
        expect(refusalFailures(r.refusal, c.id), `the asks core refuses an ask with the option ID ${JSON.stringify(c.id)}, so it may not carry it; then the refusal must name the ID and why`).toEqual([]);
        return;
      }
      const w = await world();
      const ask = w.asks.find((a) => a.question === c.spec.question)!;
      // The Given: the ask is open in the hub with this option (`deep inbox --json` holds it in its row's actions).
      const row = (await jsonRows(w, 'inbox')).rows.find((x) => x.id === ask.handle);
      expect(row, `the fixture ask ${ask.handle} ("${ask.question}") is open: deep inbox --json has its row`).toBeDefined();
      const actions = JSON.stringify(row!.actions);
      expect(actions.includes(JSON.stringify(c.id)), `the fixture ask ${ask.handle} has the option ${JSON.stringify(c.id)}: its --json row's actions are ${actions}`).toBe(true);

      const listed = await deep(w, ['inbox']);
      console.log(`deep inbox:\n${listed.stdout}`);
      expect(listed.code, `deep inbox exits 0: ${shown(listed)}`).toBe(0);
      const all = w.asks.map((a) => shownOf(a.handle, specOf(a.question)));
      const mine = shownOf(ask.handle, c.spec);
      const forms = printedForms(listed.stdout, mine, all, c.id);
      expect(forms, `deep inbox prints, with ${ask.handle} ("${ask.question}"), no run of characters that a POSIX shell reads as its option ${JSON.stringify(c.id)}; what it prints with the ask: ${JSON.stringify(blockOf(listed.stdout, mine, all))}`).not.toEqual([]);

      const tried: string[] = [];
      for (const typed of forms) {
        const argv = await shArgs(typed);
        if (!givesOption(argv, c.id)) throw Error(`BLOCKED: this suite's shell model reads ${JSON.stringify(typed)} as the option ${JSON.stringify(c.id)}, and /bin/sh reads it as ${JSON.stringify(argv)}`);
        const ran = await answerTyped(w.home, ask.handle, typed);
        const answered = (await allEventsOf(w)).filter((e) => e.subject === ask.handle && e.kind === 'ask.answered');
        if (!answered.length) { tried.push(`deep inbox answer ${ask.handle} ${typed}  →  ${shown(ran)}`); continue; }
        console.log(`answered by: deep inbox answer ${ask.handle} ${typed}`);
        expect(answered.map((e) => e.data.answer), `the hub's record holds ${ask.handle} answered once, with the option ${JSON.stringify(c.id)}, after \`deep inbox answer ${ask.handle} ${typed}\`: ${shown(ran)}`).toEqual([c.id]);
        expect(ran.code, `deep inbox answer ${ask.handle} ${typed} exits 0, once the OS confirms you: ${shown(ran)}`).toBe(0);
        const after = await deep(w, ['inbox']);
        expect(after.stdout.includes(ask.handle), `${ask.handle} leaves deep inbox once answered: ${after.stdout}`).toBe(false);
        return;
      }
      expect.fail(`no form deep inbox printed of the option ${JSON.stringify(c.id)} answers ${ask.handle} when typed back; each was refused and the ask is still open:\n${tried.join('\n')}`);
    }, 300_000);
  }
});

describe(ID.refused, () => {
  test(`${ID.refused}: an option ID an ask may not carry is refused when the ask is raised, naming the ID and why`, async () => {
    const p = await raised();
    expect(p.control, 'the probe raises an ask whose IDs every reading allows (serif, sans); otherwise a refusal could be of anything').toEqual({ carried: true });
    console.log(CASES.map((c) => `${JSON.stringify(c.id)} (${c.kind}): ${said(p.cases.get(c.id))}`).join('\n'));
    // An ID raised is one the ask may carry: criterion 1 holds it to answering. Each refused one must say what and why.
    const failures = CASES.flatMap((c) => {
      const r = p.cases.get(c.id);
      if (!r) return [`${JSON.stringify(c.id)} (${c.kind}) was never raised`];
      return r.carried ? [] : refusalFailures(r.refusal, c.id).map((f) => `${JSON.stringify(c.id)} (${c.kind}): ${f}`);
    });
    expect(failures, 'each option ID the asks core refuses when the ask is raised').toEqual([]);
  }, 120_000);
});
