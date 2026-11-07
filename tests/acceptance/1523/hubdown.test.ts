// #1523 AC8: with the hub stopped, the new forms go through and are spooled as `git push` is today: deep-hook lets the
// call run and saves its request in the spool with the entries it matched, the effect entries of each class its Scope
// line gives it among them, so the hub reads them when it's back. `"$(printf jj)" git push` stays denied by the
// fail-closed `no-unreadable-push`, naming `$(printf jj)`.
//
// The hub here is one that isn't running in this HOME (README, Hub down): deep-hook finds no hub to answer, as it does
// once a hub is stopped. No hub starts, so this file runs on a loaded machine; a hook deep-hook couldn't spool within
// its budget is INCONCLUSIVE.
import { afterEach, describe, it } from 'vitest';
import {
  AC8, HELD, ISSUE_CREATE, Inconclusive, PUSH, Session, UNREADABLE_JJ, bash, cleanup, each, loadReading, makeWorld, matchOf, must, replyText, rulesIn, shown,
  sleep, spoiled, spooled, verdict, type Effect, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const RULE = 'no-unreadable-push';
/** The control first: `git push` as it's spooled today. */
const CALLS: [string, Effect[]][] = [[PUSH, ['push']], ...HELD, [ISSUE_CREATE, ['send']]];

/** The spool's request for this tool call, waiting a little for a sync deep-hook left running. */
async function spooledCall(w: World, id: string): Promise<{ matched: string[] } | undefined> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const line = spooled(w).find((l) => l.event === 'PreToolUse' && l.payload?.tool_use_id === id);
    if (line) return { matched: Array.isArray(line.matched) ? (line.matched as unknown[]).map(String) : [] };
    if (Date.now() > deadline) return undefined;
    await sleep(250);
  }
}

describe(`${AC8} with the hub stopped the new forms go through and are spooled; the unreadable jj push stays denied`, () => {
  it(`${AC8} ${CALLS.map(([c]) => c.split(' -f ')[0]).join(', ')} go through and are spooled with their effect entries; ${UNREADABLE_JJ} is denied by ${RULE}`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld();
    const s = new Session(w);
    await s.start();
    await s.typed('Fix the login bug in src/auth.js.');
    await each([...CALLS, [UNREADABLE_JJ, []] as [string, Effect[]]], async ([command, effects]) => {
      const r = await s.call(bash(command));
      if (command === UNREADABLE_JJ) {
        must(!r.allowed, `${AC8} with the hub stopped \`${UNREADABLE_JJ}\` must stay denied by ${RULE}; deep-hook allowed it: ${shown(r.before)}`);
        const text = replyText(r.before);
        must(rulesIn(text).includes(RULE) && text.includes('$(printf jj)'), `${AC8} the denial of \`${UNREADABLE_JJ}\` must name ${RULE} and $(printf jj): ${text.slice(0, 600)}`);
        return;
      }
      must(r.allowed, `${AC8} with the hub stopped \`${command}\` must go through, as \`${PUSH}\` does; deep-hook denied it: ${shown(r.before)}`);
      const line = await spooledCall(w, r.id);
      if (!line && spoiled(r.before)) throw new Inconclusive(`${AC8} deep-hook couldn't spool \`${command}\` within its budget (${r.before.stderr.trim()}), ${loadReading()}`);
      must(line !== undefined, `${AC8} with the hub stopped \`${command}\` must be spooled: no PreToolUse request in ~/.deepbuild/spool names its tool_use_id ${r.id}`);
      const classes = new Set(line.matched.map(matchOf));
      const missing = effects.filter((e) => !classes.has(`effect:${e}`));
      must(!missing.length, `${AC8} \`${command}\` must be spooled with the entries of ${effects.map((e) => `effect:${e}`).join(' and ')}, as \`${PUSH}\` is with effect:push; it was spooled matching ${line.matched.join(', ') || 'no entry'}`);
    });
  }), 600_000);
});
