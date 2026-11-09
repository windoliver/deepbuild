// AC1: a /compact in a Codex session records exactly one PreCompact reading and one PostCompact reading (README).
import { afterAll, expect, test } from 'vitest';
import { AC1, cleanup, compactionReadings, recorded, replay, settled, world } from './helpers.ts';

afterAll(cleanup);

test(`${AC1} a /compact records exactly one PreCompact reading and one PostCompact reading, however often its PreCompact hook reaches DeepBuild`, async () => {
  const problems: string[] = [];
  // The /compact as Codex 0.144.0 fired it live: PreCompact once, then PostCompact.
  {
    const w = await world();
    const run = recorded(w);
    await replay(w, run);
    problems.push(...compactionReadings(await settled(w, run.session)).map((p) => `as recorded: ${p}`));
  }
  // The same /compact with its PreCompact hook reaching DeepBuild a second time before PostCompact, the order the
  // 0.160.0 record shows (PreCompact at 28 and 30, PostCompact at 31): still one compaction.
  {
    const w = await world();
    const run = recorded(w);
    const post = run.hooks.findIndex((h) => h.event === 'PostCompact');
    const pre = run.hooks.find((h) => h.event === 'PreCompact')!;
    await replay(w, run, [...run.hooks.slice(0, post), pre, ...run.hooks.slice(post)]);
    problems.push(...compactionReadings(await settled(w, run.session)).map((p) => `PreCompact fired twice: ${p}`));
  }
  expect(problems, problems.join('\n')).toEqual([]);
}, 600_000);
