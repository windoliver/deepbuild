// #84 AC24: budgets, on the reference Mac in the local preflight, compared with the merge base: sorting a question takes
// under 20 ms with no model call in the common cases.
//
// A blind suite can't build and time the merge base beside the change, and the base has no sorter, so the reading is taken
// on the hub as it stands (README, Budgets): one hub, one session on item 95, green. Five rounds of four scheduled-task
// turns, each reading src/auth.js and stopping with nothing changed, so no check runs: one ending on plain words, the base
// line, and one each on the common cases, an in-scope question ("proceed"), an authority offer, and a question with
// nothing to key an ask from. What sorting adds is each case's median Stop hook time less the plain stops'.
//
// No model call: `claude` and `codex` on the hub's PATH are the world's stubs, which log their arguments, and the hub's
// ANTHROPIC_BASE_URL and OPENAI_BASE_URL point at a listener here that counts what reaches it. Neither may be used for a
// model during the rounds. A reading over budget while the machine is loaded past its cores is INCONCLUSIVE, never a
// fail. The harness is shown to fail on a planted reading.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { afterAll, describe, it } from 'vitest';
import {
  AC24, EXPIRED, Inconclusive, askDraft, blocked, claimsIn, cleanup, failureOf, handles, item, lastPos, listed, loadReading, loaded, makeWorld, must, replyText, runsFor, saysProceed,
  Session, settle, shown, startHub, startOnItem, verdict, type Ran,
} from './helpers.ts';

const LOOP = '/loop every 10 minutes: re-read the auth middleware';
const BUDGET_MS = 20;
const ROUNDS = 5;
const STOPS = {
  plain: (i: number) => `Re-read the auth middleware, round ${i + 1}.`,
  proceed: (i: number) => `Nothing changed. Want me to run ${['the tests', 'the linter', 'the typecheck', 'the e2e suite', 'the benchmarks'][i]}?`,
  authority: (i: number) => `Nothing changed. Want me to push ${['this branch', 'the fix branch', 'to main', 'the tag', 'the release branch'][i]}?`,
  unkeyed: (i: number) => `Should it be ${['blue', 'teal', 'green', 'amber', 'grey'][i]}?`,
} as const;
type Case = keyof typeof STOPS;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
/** The 20 ms judge: what sorting adds over a stop with no question. */
function addsUnder(what: string, sorted: number[], plain: number[], budget = BUDGET_MS): void {
  const added = median(sorted) - median(plain);
  const reading = `${what}: ${sorted.map((x) => x.toFixed(0)).join(', ')} ms (median ${median(sorted).toFixed(1)}); plain stops ${plain.map((x) => x.toFixed(0)).join(', ')} ms (median ${median(plain).toFixed(1)}), ${loadReading()}`;
  if (added >= budget && loaded()) throw new Inconclusive(`${AC24} sorting added ${added.toFixed(1)} ms over ${budget} ms while the machine is loaded past its cores: ${reading}`);
  must(added < budget, `${AC24} sorting a question takes under ${budget} ms: it added ${added.toFixed(1)} ms: ${reading}`);
}

afterAll(cleanup, 60_000);

describe(`${AC24} sorting a question takes under 20 ms with no model call in the common cases`, () => {
  it(`${AC24} item 95: an in-scope question, an authority offer and a question with no key each add under 20 ms to a stop that changed nothing, and no model is called`, async (ctx) => verdict(ctx, async () => {
    let reached = 0;
    const trap = createServer((_, res) => { reached += 1; res.statusCode = 503; res.end(); });
    await new Promise<void>((done) => trap.listen(0, '127.0.0.1', done));
    const { port } = trap.address() as { port: number };
    try {
      const w = makeWorld({ items: [item(95, 'Expired tokens are accepted', [EXPIRED])], drafts: [askDraft(LOOP)] });
      const url = `http://127.0.0.1:${port}`;
      const hub = await startHub(w, { hold: null, env: { ANTHROPIC_BASE_URL: url, OPENAI_BASE_URL: url } });
      const s = new Session(w);
      await startOnItem(hub, s, 95, AC24);
      await s.green();
      const green = await s.stop('checkToken rejects expired tokens and flags them.');
      must(!blocked(green), `BLOCKED: ${AC24} the stop with R1 and the unit test passing is let through: ${shown(green)}`);
      const logged = existsSync(w.calls) ? readFileSync(w.calls, 'utf8').length : 0;
      const since = await lastPos(hub);

      const times: Record<Case, number[]> = { plain: [], proceed: [], authority: [], unkeyed: [] };
      const replies: Record<Case, Ran[]> = { plain: [], proceed: [], authority: [], unkeyed: [] };
      for (let i = 0; i < ROUNDS; i++) {
        for (const kind of Object.keys(STOPS) as Case[]) {
          await s.scheduled(LOOP);
          await s.read('src/auth.js');
          const stop = await s.stop(STOPS[kind](i));
          times[kind].push(stop.ms);
          replies[kind].push(stop);
        }
      }
      const events = await settle(hub, () => true);
      const ran = runsFor(events, handles(claimsIn(events, since)));
      must(ran.length === 0, `BLOCKED: ${AC24} the turns changed nothing, so no check runs and the reading is the sorter's: ${listed(ran.map((r) => r.started))}`);
      // The reading is the sorter's only if each stop was sorted: a hub that sorts nothing adds nothing.
      must(replies.proceed.every(saysProceed), `${AC24} each in-scope question was sorted and answered "proceed", so the time read is the sorter's: ${replies.proceed.map(shown).join(' / ').slice(0, 600)}`);
      must(replies.unkeyed.every((r) => replyText(r).includes('deep_ask')), `${AC24} each question with no key was sorted and asked for deep_ask, so the time read is the sorter's: ${replies.unkeyed.map(shown).join(' / ').slice(0, 600)}`);
      must(!replies.authority.some(saysProceed), `${AC24} no authority offer was answered "proceed": ${replies.authority.map(shown).join(' / ').slice(0, 600)}`);
      for (const kind of ['proceed', 'authority', 'unkeyed'] as const) addsUnder(kind, times[kind], times.plain);

      const calls = (existsSync(w.calls) ? readFileSync(w.calls, 'utf8') : '').slice(logged).split('\n').filter((l) => /^(claude|codex) /.test(l) && !/--version|login status/.test(l));
      must(calls.length === 0, `${AC24} sorting makes no model call: ${calls.slice(0, 5).join('; ')}`);
      must(reached === 0, `${AC24} sorting makes no model call: ${reached} requests reached the model API's address`);
    } finally {
      await new Promise<void>((done) => trap.close(() => done()));
    }
  }), 600_000);

  it(`${AC24} (wrong program) the reading fails on a sorter that adds 25 ms`, async () => {
    const message = await failureOf(async () => { try { addsUnder('planted', [55, 56, 54, 57, 55], [30, 31, 29, 30, 30]); } catch (e) { if (e instanceof Inconclusive) throw Error(e.message); throw e; } });
    must(message !== null && /added 25\.0 ms|over 20 ms/.test(message), `${AC24} a sorter that adds 25 ms fails the 20 ms budget: ${message ?? 'it passed'}`);
  });
});
