// AC2: An agent's write to a page is refused, and its `deep_propose` lands in the inbox.
//
// The wiki writes repos/api.md from one claim; the hub runs on that home with the shipped guard entries as its
// rules.json. The agent stand-in (tests/acceptance/26's) works in the api repo with its session established through
// its hooks. Its Write of the page goes through the real deep-hook (tests/acceptance/316's build), which must deny
// it; then its deep_propose of a change to the page's claim must reach you: an open ask in `deep inbox` naming the
// change, a learn.proposed applied by no one, and the page unchanged.
import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, deep, doneYaml, events, initialize } from '../26/helpers.ts';
import { decision, hook, shown, write } from '../316/helpers.ts';
import { buildHookBinary, callTool, cleanup, handle, makeRepo, makeWorld, openWiki, REPO, seedSession, trustProject, valueOf, withHub, withRecord } from './helpers.ts';

afterAll(cleanup, 60_000);

const CLAIM = { page: 'repos/api', id: 'start-port', text: '`api` starts on port 3001' };
const MARKER = 'heliotrope';

describe('AC2 an agent\'s write to a page is refused, and its deep_propose lands in the inbox', () => {
  it('AC2 deep-hook denies the agent\'s Write of repos/api.md; its deep_propose of a change is an open ask in deep inbox, a learn.proposed applied by no one, and the page is unchanged', async () => {
    const binary = await buildHookBinary();
    const w = makeWorld();
    const api = makeRepo(join(w.tmp, 'api'), [{ Procfile: 'api: node server.js --port 3001\n', '.deepbuild/done.yaml': doneYaml() }]);
    copyFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), join(w.root, 'rules.json'));
    await withRecord(w, async (o) => {
      await trustProject(w, o, api.dir);
      await seedSession(w, o, 'api', api.dir, [{ id: 'm1', from: 'you', text: 'hello' }]);
      const wiki = await openWiki({ record: o.record, folder: w.wiki, now: w.clock.now });
      const learned = await wiki.learn([{ ...CLAIM, scope: 'repo:api', sources: [{ repo: api.dir, path: 'Procfile', commit: api.commits[0]!, quote: 'api: node server.js --port 3001' }] }]);
      expect(learned.written, 'the page\'s one claim is written').toContain(handle(CLAIM));
    });
    const page = join(w.wiki, 'repos/api.md');
    await withHub(w, {}, async (hub) => {
      const agent = Agent.start(w.home, api.dir);
      const session = agent.session(api.dir);
      await agent.establish(hub, session);
      await initialize(agent);
      const before = readFileSync(page, 'utf8');

      // The agent writes the page itself: its PreToolUse, through deep-hook as the agent's hook entry runs it.
      const s = { agent: 'claude-code' as const, ...session };
      const tried = await hook(w.home, s, 'PreToolUse', write(s, page), { binary });
      expect(decision(tried), `deep-hook denies the agent's Write of ${page}: ${shown(tried)}`).toBe('deny');
      expect(readFileSync(page, 'utf8'), 'the page is as the wiki wrote it').toBe(before);

      // The agent proposes the change instead.
      const proposed = await callTool(agent, 'deep_propose', { target: handle(CLAIM), change: `\`api\` starts on port 3002, as the ${MARKER} branch says`, evidence: null });
      valueOf(proposed, 'the agent\'s deep_propose');
      const inbox = await deep(w.home, ['inbox']);
      expect(inbox.code, `deep inbox lists your open asks: ${inbox.stderr}`).toBe(0);
      expect(inbox.stdout, `the proposal is an open ask in your inbox, naming the change: ${inbox.stdout}`).toContain(MARKER);
      const log = await events(hub);
      const proposal = log.find((e) => e.kind === 'learn.proposed' && e.data?.target === handle(CLAIM));
      expect(proposal, `a learn.proposed for ${handle(CLAIM)} is in the record`).toBeDefined();
      expect(proposal!.data.applied_by, 'the proposal is applied by no one').toBeNull();
      expect(log.filter((e) => (e.kind === 'learn.applied' || e.kind === 'learn.widened') && JSON.stringify(e.data).includes(MARKER)).map((e) => e.id), 'nothing applied the proposal').toEqual([]);
      expect(readFileSync(page, 'utf8'), 'the page is unchanged by the proposal').toBe(before);
    });
  }, 900_000);
});
