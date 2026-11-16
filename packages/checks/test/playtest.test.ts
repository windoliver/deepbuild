// The playtest plug-in's kit (#184), run as the local preflight runs it: the clean maze passes on real replicas
// (deep-drive's play mode), each planted twin fails with its code, and each planted runner that drops one rule is
// caught by the kit. Plays are remembered by their call, so a planted runner replays the reference's plays.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runKit } from '@deepbuild/conformance';
import { pieces, playtestKit } from '../playtest/kit.ts';
import { outcomeOf } from '../playtest/judge.ts';
import type { Play, PlayAnswer } from '../playtest/types.ts';

const REPO = join(import.meta.dirname, '..', '..', '..');
const out = mkdtempSync(join(tmpdir(), 'deep-playtest-kit-'));
const started: { kill(): void }[] = [];
afterAll(() => {
  for (const c of started) c.kill();
  rmSync(out, { recursive: true, force: true });
});

/** One deep-drive process per plant, its plays one at a time. */
function drive(plant: string | null): (line: Record<string, unknown>) => Promise<Record<string, unknown>> {
  const env = { ...process.env, ...(plant ? { DEEP_DRIVE_PLANT: plant } : {}) };
  const child = spawn(join(REPO, 'target', 'debug', 'deep-drive'), ['--out', join(out, plant ?? 'clean')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  started.push(child);
  let buffer = '';
  const waiting: ((v: Record<string, unknown>) => void)[] = [];
  child.stdout.setEncoding('utf8').on('data', (d: string) => {
    buffer += d;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      waiting.shift()?.(JSON.parse(line) as Record<string, unknown>);
    }
  });
  let chain: Promise<unknown> = new Promise((done) => waiting.push(done));
  return (line) => {
    const next = chain.then(() => new Promise<Record<string, unknown>>((done) => {
      waiting.push(done);
      child.stdin.write(`${JSON.stringify(line)}\n`);
    }));
    chain = next;
    return next;
  };
}

describe('the playtest kit', () => {
  it('judges a run from what it recorded: the earliest failure decides, a bot\'s trap makes it invalid', () => {
    const play = (o: Partial<PlayAnswer>): PlayAnswer => ({
      steps: 10, step: 1, track: '', entries: [], values: {}, trap: null, bot_trap: null, step_times: [], fuel: {}, ceilings: {}, checkpoints: [], final: '', frames: [], ...o,
    });
    const at = (cells: number[][]) => play({ values: { pos: cells, won: cells.map(() => [0]) } });
    expect(outcomeOf(at([[0, 0], [1, 0], [1, 0], [1, 0], [1, 0], [2, 0]]), [], { measure: 'pos', by: 1, within: 3 })).toMatchObject({ kind: 'stuck', from_step: 1, step: 4 });
    expect(outcomeOf(play({ fuel: { maze: [1, 9, 9] }, ceilings: { maze: 5 }, trap: { step: 2 } }), [], undefined)).toMatchObject({ kind: 'over_budget', step: 1, fuel: 9, ceiling: 5 });
    expect(outcomeOf(play({ trap: { step: 2 }, bot_trap: { step: 5 } }), [], undefined).kind).toBe('invalid');
  });

  it('passes the clean maze, fails each twin with its code, and catches each planted runner', async () => {
    const built = spawnSync('cargo', ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants'], { cwd: REPO, stdio: 'inherit' });
    expect(built.status, 'deep-drive builds').toBe(0);
    const mazes = pieces();
    const drives = new Map<string, ReturnType<typeof drive>>();
    const seen = new Map<string, Promise<PlayAnswer>>();
    const replica = (plant: string | null): Play => async (piece, run) => {
      const maze = mazes[piece.slice(0, piece.lastIndexOf('@')) as keyof typeof mazes];
      const key = JSON.stringify([plant, piece, run]);
      if (!seen.has(key)) {
        if (!drives.has(plant ?? '')) drives.set(plant ?? '', drive(plant));
        seen.set(key, drives.get(plant ?? '')!({ call: 'play', ...maze, ...run }).then((r) => {
          if (r['ok'] !== true) throw Error(JSON.stringify(r['error']));
          return r as unknown as PlayAnswer;
        }));
      }
      return seen.get(key)!;
    };
    const kit = playtestKit(replica);
    const clean = await runKit(kit, kit.clean()[0]!, { parts: ['fixed'] });
    expect(clean.cases.filter((c) => c.outcome !== 'PASS'), 'the reference passes every case').toEqual([]);
    for (const p of kit.planted) {
      const report = await runKit(kit, p.fill, { parts: ['fixed'] });
      expect(report.verdict, `${p.name} is caught`).toBe('FAIL');
      expect(report.cases.some((c) => c.codes.some((code) => p.codes.includes(code))), `${p.name} is caught by its rule`).toBe(true);
    }
  }, 3_600_000);
});
