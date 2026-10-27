// #20 AC1 and AC2: a transcript its agent deleted still reads back from the archive, through the record; and
// re-running the archive, in the same process or after a restart, copies nothing new.
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeForge, jobLog } from './forge.ts';
import {
  AC, allEvents, appendClaude, claudeTranscript, codexTranscript, DAY, expectArchived, HOUR, numbered, openArchiveOn, openWorld, removeTemps,
  T0, tempDir, tinyTranscript,
} from './helpers.ts';

afterAll(removeTemps);

describe(`AC1 ${AC[1]} a transcript deleted by its agent still exists in the archive`, () => {
  it("AC1 a Claude Code, a Codex and a new adapter's transcript, each archived from the folder its facts name, deleted by its agent, still read back from the archive through the record", async () => {
    const agents = tempDir('agents');
    // Claude Code and Codex in homes their variables move; the new agent in its default home under HOME.
    const w = await openWorld({ env: { CLAUDE_CONFIG_DIR: join(agents, 'claude-config'), CODEX_HOME: join(agents, 'codex-home') } });
    try {
      const claude = claudeTranscript(w.env, numbered(1, 6, 'claude'));
      const codex = codexTranscript(w.env, ['codex: fix the checkout total', 'codex: now run the tests']);
      const tiny = tinyTranscript(w.env, ['tiny: rename the cart module']);
      const archive = await openArchiveOn(w);
      await archive.pass();
      for (const t of [claude, codex, tiny]) await expectArchived(w, t, 'after the first pass');

      // Thirty days on, each agent's cleanup deletes its transcript; the archive runs again.
      w.clock.tick(30 * DAY);
      for (const t of [claude, codex, tiny]) rmSync(t.path);
      expect([claude, codex, tiny].filter((t) => existsSync(t.path)), 'the agents deleted their transcripts').toEqual([]);
      w.clock.tick(HOUR);
      await archive.pass();
      for (const t of [claude, codex, tiny]) await expectArchived(w, t, 'after its agent deleted it');
    } finally {
      await w.close();
    }
  }, 60_000);
});

describe(`AC2 ${AC[2]} re-running the archive copies nothing new`, () => {
  const copyKinds = ['transcript.archived', 'ci.archived'];
  it('AC2 a second pass, and a fresh archive on the reopened record and store (a restart), copy nothing new: no copy event and no write to the store', async () => {
    const forge = await FakeForge.start();
    const w = await openWorld();
    try {
      const claude = claudeTranscript(w.env, numbered(1, 8, 'first'));
      const other = claudeTranscript(w.env, numbered(1, 3, 'second'), { cwd: '/tmp/dh20-work/api' });
      appendClaude(claude, numbered(9, 12, 'first'));
      const codex = codexTranscript(w.env, ['codex: add the refund route']);
      forge.add({ repo: 'octo/shop', id: 9101, name: 'CI', conclusion: 'success', headSha: 'a'.repeat(40), created: T0 - HOUR, jobs: [{ id: 51, name: 'test', conclusion: 'success', log: jobLog(['npm test', '12 passing'], T0 - HOUR) }] });
      const fforge = { api: forge.api, repos: ['octo/shop'] };

      const archive = await openArchiveOn(w, { forge: fforge });
      await archive.pass();
      for (const t of [claude, other, codex]) await expectArchived(w, t, 'after the first pass');
      const first = await allEvents(w.record, copyKinds);
      expect(first.filter((e) => e.kind === 'ci.archived').length, 'the first pass copied the forge\'s run').toBe(1);
      const wrote = w.writes.count;
      expect(wrote, 'the first pass wrote its copies to the evidence store').toBeGreaterThan(0);

      w.clock.tick(HOUR);
      await archive.pass();
      expect((await allEvents(w.record, copyKinds)).map((e) => e.id), 'a second pass appends no copy event').toEqual(first.map((e) => e.id));
      expect(w.writes.count - wrote, 'a second pass writes nothing to the evidence store').toBe(0);

      // A restart: the record closed and reopened, a new store and asks core on the same folders, a new archive.
      await w.close();
      const again = await openWorld({ home: w.home, clock: w.clock, env: w.env });
      try {
        again.clock.tick(HOUR);
        const fresh = await openArchiveOn(again, { forge: fforge });
        await fresh.pass();
        expect((await allEvents(again.record, copyKinds)).map((e) => e.id), 'a fresh archive after a restart appends no copy event').toEqual(first.map((e) => e.id));
        expect(again.writes.count, 'a fresh archive after a restart writes nothing to the evidence store').toBe(0);
      } finally {
        await again.close();
      }
    } finally {
      await forge.close();
    }
  }, 60_000);
});
