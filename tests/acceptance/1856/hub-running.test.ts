// #1856 AC3: a real hub (`deep hub run`) on a temp HOME that setup finished in: rules.json holds the shipped default
// entries, as setup writes them, and one test entry installed through `deep guard add`. The test deletes rules.json,
// as a command's child no guard sees would, and runs one hook, `pkill -f node`, as Claude Code's entry runs it. The
// three `it`s read that one run: the denial, the file, the record (read through the hub's socket, `events.read`). Each
// is decided by its `expect`s; a setup or control that can't be made, or a hook the hub didn't answer in time, throws
// BLOCKED or INCONCLUSIVE instead (helpers.ts), which never reads as a failure at an assertion.
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AC3, allEvents, built, cleanup, decision, finishSetup, guardAdd, guardFile, hook, makeHome, newSession, readRules,
  rulesFile, said, seedDefaults, settled, shown, startHub, stopHub, type Ev, type Guard, type Hooked, type Rules,
} from './helpers.ts';

const KILL = 'pkill -f node';
const ADDED = 't-1856';
/** deep-hook's words when it decided with the hub away: the hub didn't acknowledge the hook in its 20 ms. */
const HUB_AWAY = /while the hub doesn't answer/;
const names = (e: Ev, text: string) => JSON.stringify(e).includes(text);

interface Seen { installed: Rules; denied: Hooked; after: Rules | undefined; fresh: Ev[] }
let seen: Promise<Seen> | undefined;
/** The one run every test below reads; a rejected setup fails each of them with its BLOCKED or INCONCLUSIVE words. */
function observe(): Promise<Seen> {
  seen ??= (async () => {
    const home = makeHome();
    seedDefaults(home);
    finishSetup(home);
    const s = newSession(home);
    const hub = await startHub(home);
    try {
      const guard: Guard = { match: 'run:gh pr merge', scope: 'all_repos', mode: 'block', reason: `Test entry ${ADDED} holds this call.`, next_step: `Leave ${ADDED} alone; this is a test.`, fail_closed: false };
      const added = await guardAdd(home, guardFile(ADDED, guard, 'gh pr merge 12', "echo 'gh pr merge 12'"));
      const installed = readRules(home);
      if (added.code !== 0 || !installed?.entries[ADDED] || !installed.entries['no-kill-by-name']) {
        throw Error(`BLOCKED: \`deep guard add\` must install ${ADDED} beside the defaults: ${shown(added)}; rules.json holds ${Object.keys(installed?.entries ?? {}).join(', ')}`);
      }

      // Control: with the file there, the hub answers this session's hook and the call is denied by no-kill-by-name.
      // A session's first hooks can miss the hub's 20 ms to acknowledge; they are tried until the hub answers one.
      let control: Hooked | undefined;
      for (let i = 0; i < 10 && (!control || HUB_AWAY.test(said(control))); i++) control = await hook(home, s, KILL);
      if (!control || HUB_AWAY.test(said(control))) throw Error(`INCONCLUSIVE: the running hub answered none of 10 hooks in time; run the suite again alone: ${control && shown(control)}`);
      if (decision(control) !== 'deny' || !said(control).includes('no-kill-by-name')) {
        throw Error(`BLOCKED: control: with rules.json there and the hub running, \`${KILL}\` must be denied naming no-kill-by-name: ${shown(control)}`);
      }
      const earlier = new Set((await settled(hub, (events) => events.some((e) => e.kind === 'tool.before' && e.data.call === control.call))).map((e) => e.id));

      rmSync(rulesFile(home));
      const denied = await hook(home, s, KILL);
      const after = readRules(home);
      if (HUB_AWAY.test(said(denied))) throw Error(`INCONCLUSIVE: the hub didn't answer the hook after the removal in time, so deep-hook decided alone; run the suite again alone: ${shown(denied)}`);
      // The record once the call's own event is in and nothing more arrives; then what is new since the removal.
      const record = await settled(hub, (events) => events.some((e) => e.kind === 'tool.before' && e.data.call === denied.call));
      const fresh = record.filter((e) => !earlier.has(e.id) && !(e.kind === 'tool.before' && e.data.call === denied.call));
      if ((await allEvents(hub)).length !== record.length) throw Error('INCONCLUSIVE: the record was still growing after it had settled for a second; run the suite again alone');
      return { installed, denied, after, fresh };
    } finally {
      await stopHub(hub);
    }
  })();
  return seen;
}

beforeAll(built, 120_000);
afterAll(cleanup, 60_000);

describe(`${AC3} the hub running, rules.json deleted`, () => {
  it(`${AC3} the next \`${KILL}\` is denied naming no-kill-by-name`, async () => {
    const { denied } = await observe();
    expect(decision(denied), `with the hub running, after rules.json is deleted the next \`${KILL}\` must be denied, not allowed: ${shown(denied)}`).toBe('deny');
    expect(said(denied), `the denial of \`${KILL}\` must name no-kill-by-name: ${shown(denied)}`).toContain('no-kill-by-name');
  }, 600_000);

  it(`${AC3} once that hook is answered, rules.json again holds every installed entry: each default and ${ADDED}`, async () => {
    const { installed, after } = await observe();
    expect(after, 'rules.json must be there again, with its entries, once the hub has answered the next hook').toBeDefined();
    expect(Object.keys(after!.entries).sort(), 'rules.json must again hold every installed entry, by name').toEqual(Object.keys(installed.entries).sort());
    expect(after!.entries, 'each installed entry must be back as it was installed, its mode included').toEqual(installed.entries);
  }, 600_000);

  it(`${AC3} the record holds one event naming the removal of rules.json`, async () => {
    const { fresh } = await observe();
    const naming = fresh.filter((e) => names(e, 'rules.json'));
    expect(naming.map((e) => e.kind), `the record must hold one new event naming rules.json's removal; new since the removal, past the call's own tool.before: ${JSON.stringify(fresh.map((e) => e.kind))}`).toHaveLength(1);
  }, 600_000);
});
