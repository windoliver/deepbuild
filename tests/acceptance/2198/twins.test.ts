import { afterEach, describe, expect, it } from 'vitest';
import { AC5, call, claimArgs, cleanup, events, tasteArgs, world, type Line } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC5} A twin of each still passes`, () => {
  it(`${AC5} a taste ask with its deadline declared in done.yaml is raised: deep_ask returns its ask and the record holds ask.created for the session`, async () => {
    const w = await world('taste-deadline');
    const args = tasteArgs();
    const o = await call(w, 'deep_ask', args);
    expect(o.isError, `deep_ask of a taste question with its deadline declared is not refused: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(false);
    const v = o.value as Line;
    expect(String(v?.ask), `deep_ask names the ask it raised: ${JSON.stringify(v)}`).toMatch(/^ask:/);
    const created = (await events(w.hub)).filter((e) => e.kind === 'ask.created' && e.session === w.session.id && e.data?.question === args.question);
    expect(created.length, `the record holds the taste ask's ask.created under session ${w.session.id}`).toBe(1);
  }, 240_000);

  it(`${AC5} a stack with an environment block comes up: deep_env up is no error and reports ready`, async () => {
    const w = await world('environment');
    const up = await call(w, 'deep_env', { action: 'up' });
    try {
      expect(up.isError, `deep_env up with an environment block is not an error: ${JSON.stringify(up.reply).slice(0, 1500)}`).toBe(false);
      expect((up.value as Line)?.status, `deep_env up reports the stack ready: ${JSON.stringify(up.value)}`).toBe('ready');
    } finally {
      await call(w, 'deep_env', { action: 'down' }).catch(() => undefined);
    }
  }, 240_000);

  it(`${AC5} a full SHA is taken: deep_claim at the worktree's 40-character commit is filed`, async () => {
    const w = await world('taste-deadline');
    const o = await call(w, 'deep_claim', claimArgs({ commit: w.wt.commit }));
    expect(o.isError, `deep_claim at the full SHA ${w.wt.commit} is not refused: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(false);
    expect(String((o.value as Line)?.claim), `deep_claim names the claim it filed: ${JSON.stringify(o.value)}`).toMatch(/^claim:/);
  }, 240_000);
});
