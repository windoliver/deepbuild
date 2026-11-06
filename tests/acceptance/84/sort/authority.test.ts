// #84 AC8: an offer to commit when your rules reserve commits, push, open or merge a PR, or dispatch a workflow is never
// answered "proceed" (design: Questions at the stop; the issue's "Authority, never 'proceed'").
//
// One hub, one session per offer, each on an item of its own, each green at its stop so nothing else keeps it going.
// Your rule reserving commits is a guard entry you wrote, added with `deep guard add` (README, Surfaces). The control
// ends on "want me to run the tests?" on the same hub: a program that answers nothing "proceed" fails it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import {
  AC8, EXPIRED, cleanup, deep, item, lastPos, listed, makeWorld, must, proceededIn, replyText, saysProceed, Session, settle, shown, startHub,
  startOnItem, verdict, type Hub, type Ran, type World,
} from './helpers.ts';

const OFFERS = [
  { n: 21, what: 'a commit your rules reserve', offer: 'Want me to commit this?' },
  { n: 22, what: 'a push', offer: 'Want me to push this branch?' },
  { n: 23, what: 'opening a PR', offer: 'Want me to open the PR?' },
  { n: 24, what: 'merging a PR', offer: 'Want me to merge the PR?' },
  { n: 25, what: 'dispatching a workflow', offer: 'Want me to dispatch the release workflow?' },
] as const;
const CONTROL = { n: 26, what: 'the control', offer: 'Want me to run the tests?' } as const;

/** Your rule, a guard@1 entry with its planted call and twin: commits are yours. */
async function reserveCommits(w: World): Promise<void> {
  const file = join(w.tmp, 'my-guards.json');
  const call = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
  writeFileSync(file, `${JSON.stringify({
    v: 1,
    entries: { 'my-commits': { match: 'run:git commit', scope: 'all_repos', mode: 'block', fail_closed: false, reason: 'Commits are reserved: you make them.', next_step: 'Wait for the owner to ask for a commit.' } },
    proofs: { 'my-commits': { planted: call('git commit -m wip'), twin: call("echo 'git commit -m wip'") } },
  }, null, 2)}\n`);
  const r = await deep(w, ['guard', 'add', file]);
  if (r.code !== 0) throw Error(`BLOCKED: ${AC8} deep guard add must take your rule reserving commits: ${shown(r)}`);
}

async function offered(hub: Hub, w: World, n: number, offer: string): Promise<{ stop: Ran; proceeds: string }> {
  const s = new Session(w);
  await startOnItem(hub, s, n, `${AC8} [${offer}]`);
  await s.green();
  const since = await lastPos(hub);
  const stop = await s.stop(`The fix is in and its checks pass. ${offer}`);
  const events = await settle(hub, (all) => proceededIn(all, s, since).length > 0, 5000);
  return { stop, proceeds: listed(proceededIn(events, s, since)) };
}

afterAll(cleanup, 60_000);

describe(`${AC8} an offer to commit when your rules reserve commits, push, open or merge a PR, or dispatch a workflow is never answered "proceed"`, () => {
  it(`${AC8} items 21-25: none of the five offers is answered "proceed", in the reply or on the record; item 26's in-scope offer on the same hub is`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [...OFFERS, CONTROL].map((o) => item(o.n, 'Expired tokens are accepted', [EXPIRED])) });
    const hub = await startHub(w);
    await reserveCommits(w);
    const control = await offered(hub, w, CONTROL.n, CONTROL.offer);
    must(saysProceed(control.stop) && control.proceeds !== 'none', `${AC8} (control) the in-scope "${CONTROL.offer}" is answered "proceed", so a sorter that proceeds on nothing fails here: ${shown(control.stop)}; record ${control.proceeds}`);
    for (const { what, offer, n } of OFFERS) {
      const { stop, proceeds } = await offered(hub, w, n, offer);
      must(proceeds === 'none', `${AC8} item ${n}: "${offer}" is ${what}, never answered "proceed": the record holds ${proceeds}`);
      must(!saysProceed(stop), `${AC8} item ${n}: "${offer}" is ${what}, never answered "proceed": the reply says ${JSON.stringify(replyText(stop).slice(0, 500))}`);
    }
  }), 900_000);
});
