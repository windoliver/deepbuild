// AC7: a session stopped BLOCKED on an unblock task, whose sibling's PR then merges over its files, starts no turn;
// the notice is delivered once, at the turn after the task's check passes. A hub that wakes it fails this test,
// naming the session. Session A (Claude Code) changes src/cart.js, raises an unblock task proved by the spec's `ready`
// check and stops; its waiter waits, as Claude Code's asyncRewake Stop entry does. Session B (Codex) changes
// src/cart.js and its PR #46 merges. Then you do the task and say "I did it": `ready` runs again and passes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, it } from 'vitest';
import {
  AC7, ClaudeSession, CodexSession, MERGE_SETTLE_MS, aboutFile, allEvents, answer, asksRaised, change, cleanup, commitAll,
  lastPos, listed, makeWorld, mergePr, must, names, noticeText, noticesTo, said, settle, shown, sleep, startHub, toldMust, trust,
  worktree, type Ev, type Ran,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const SPEC = 'claims:\n  done:\n    checks: [unit, ready]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n  ready: { type: command, run: "node --test tests/ready.test.js", min_tests: 1 }\n';
const READY_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst fs = require('node:fs');\ntest('the payment sandbox is set up', () => {\n  assert.ok(fs.existsSync('vendor/sandbox-ready'), 'the payment sandbox is not set up yet');\n});\n";
const TASK = {
  kind: 'unblock', question: "Set up the payment provider's sandbox account", options: null, recommended: null,
  steps: ["Open the payment provider's dashboard", 'Create a sandbox account', 'Save the confirmation as vendor/sandbox-ready in the repo'],
  where: "the payment provider's dashboard, in your browser", why: 'The cart tests need a sandbox account to total real payments', check: 'ready', thread: null, subject: null,
};
const WAIT_MS = 30_000;

describe(`${AC7} a session BLOCKED on your task is not woken by a merge; it hears of it once, at the turn after the task's check passes`, () => {
  it(`${AC7} A, stopped on its unblock task, starts no turn when B's #46 merges over src/cart.js; after "I did it" and \`ready\` passing, A is told once, in the turn that follows`, async () => {
    const w = makeWorld({ spec: SPEC, files: { 'tests/ready.test.js': READY_TEST } });
    const wa = worktree(w, 'wa', 'a/cart');
    const wb = worktree(w, 'wb', 'b/cart');
    await trust(w, [wa, wb]);
    const hub = await startHub(w);

    const a = ClaudeSession.open(w, wa);
    await a.start();
    await a.typed('Make the cart total payments through the provider.');
    await a.edit('src/cart.js', '  // end of cart', '  pay: true,\n  // end of cart');
    const raised = await lastPos(hub);
    void a.tool('deep_ask', TASK, 120_000).catch(() => undefined);
    let events = await settle(hub, (all) => asksRaised(all, raised).some((e) => e.data.kind === 'unblock'), 60_000);
    const task = asksRaised(events, raised).find((e) => e.data.kind === 'unblock');
    must(task !== undefined, `BLOCKED: ${AC7} session ${a.id}'s deep_ask must raise its unblock task proved by \`ready\`: ${listed(asksRaised(events, raised))}`);
    const words = 'BLOCKED: waiting on you to set up the payment sandbox.';
    await a.stop(words);
    let woke: Ran | undefined;
    const waiting = a.waiter(words).then((r) => { woke = r; return r; });

    // B's change to the same file merges while A is stopped.
    const b = CodexSession.open(w, wb);
    await b.start();
    await b.typed('Make the cart skip empty lines.');
    await b.patch(['*** Begin Patch', '*** Update File: src/cart.js', '@@', '-  // end of cart', '+  skipEmpty: true,', '+  // end of cart', '*** End Patch', ''].join('\n'),
      () => change(`${wb}/src/cart.js`, '  // end of cart', '  skipEmpty: true,\n  // end of cart'));
    await b.bash('git commit -am "Skip empty lines"', { effect: () => commitAll(wb, 'Skip empty lines') });
    await b.stop('Done.');
    const merged = await lastPos(hub);
    mergePr(w, 'b/cart', 46, 'Skip empty cart lines');
    await sleep(MERGE_SETTLE_MS + WAIT_MS);
    events = await allEvents(hub);
    must(woke?.code !== 2, `${AC7} the hub woke session ${a.id}, stopped BLOCKED on your task, for #46's merge: its waiter exited 2 with ${JSON.stringify(woke?.stderr.slice(0, 400))}`);
    const early = noticesTo(events, a.id, merged);
    must(early.length === 0, `${AC7} session ${a.id} is stopped BLOCKED on your task, so no notice may be handed to it before its next turn: ${listed(early)}`);
    const turns = events.filter((e) => e.log_pos > merged && e.session === a.id && e.kind === 'user.ask');
    must(turns.length === 0, `${AC7} session ${a.id} must start no turn while it waits on your task: ${listed(turns)}`);

    // You do the task, and say so: `ready` runs again and passes.
    mkdirSync(`${wa}/vendor`, { recursive: true });
    writeFileSync(`${wa}/vendor/sandbox-ready`, 'ok\n');
    const did = await answer(w, task!, 'done');
    must(did.code === 0, `BLOCKED: ${AC7} your "I did it" must be taken: ${shown(did)}`);
    const passedRun = (all: readonly Ev[]) => all.find((e) => e.kind === 'run.finished' && e.log_pos > merged && /(^|[#:])ready$/.test(String(e.data.check)) && e.data.outcome === 'passed');
    events = await settle(hub, (all) => passedRun(all) !== undefined, 180_000);
    const passed = passedRun(events);
    must(passed !== undefined, `BLOCKED: ${AC7} \`ready\` must run again on "I did it" and pass: ${listed(events.filter((e) => e.kind.startsWith('run.') && e.log_pos > merged))}`);

    // The turn after the check passes: your answer or the check's pass wakes A through its waiter (the scripted agent's
    // first call comes once the check has passed), or, if no wake comes in 60 s, your next words start it.
    await Promise.race([waiting, sleep(60_000)]);
    const from = a.fired.length - (woke ? 1 : 0);
    if (woke?.code !== 2) await a.typed('The sandbox is set up; carry on.');
    await a.read('src/cart.js');
    await a.stop('Done.');
    const told = a.toldSince(Math.max(0, from));
    events = await settle(hub, (all) => noticesTo(all, a.id, merged).length > 0, 15_000);
    const got = noticesTo(events, a.id, merged).filter((n) => aboutFile(n, 'src/cart.js') || /#?46\b/.test(noticeText(n)));
    must(got.length === 1, `${AC7} session ${a.id} must be told of #46's merge exactly once, at the turn after \`ready\` passed: it got ${got.length} notices: ${listed(got)}`);
    must(got[0]!.log_pos > passed.log_pos, `${AC7} the notice to session ${a.id} must come after its task's check passed (${said(passed)}): ${said(got[0])}`);
    must(names(noticeText(got[0]!), b.id), `${AC7} the notice must name session ${b.id}: ${said(got[0])}`);
    toldMust(a, Math.max(0, from), told.includes(noticeText(got[0]!)), `${AC7} the notice must reach session ${a.id} in that turn, naming ${b.id}: it was told ${JSON.stringify(told.slice(0, 800))}`);

    // And never again.
    const later = a.fired.length;
    await a.typed('Anything else?');
    await a.read('package.json');
    events = await allEvents(hub);
    const again = noticesTo(events, a.id, merged).filter((n) => aboutFile(n, 'src/cart.js') || /#?46\b/.test(noticeText(n)));
    must(again.length === 1 && !a.toldSince(later).includes(noticeText(got[0]!)), `${AC7} #46's notice must go to session ${a.id} once: it has ${again.length}: ${listed(again)}`);
  }, 900_000);
});
