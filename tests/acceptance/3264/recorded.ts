import { createHash } from 'node:crypto';

type Obj = { [key: string]: any };
export type SeriesOf = (path: string, seed: number, steps: number) => readonly unknown[];
export type RecordedPlay = (piece: string, run: Obj) => Promise<Obj>;

const STEP_60 = 705_600_000 / 60;
const DEFAULT_SPAN_S = 120;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const stepsOf = (span: unknown): number => (typeof span === 'number' ? Math.round(span * 60) : span !== null && typeof span === 'object' ? Number((span as Obj)['steps']) : DEFAULT_SPAN_S * 60);
const pathsOf = (run: Obj, key: string): string[] => (Array.isArray(run[key]) ? (run[key] as string[]) : []);

function changesOf(series: readonly unknown[]): Obj[] {
  const out: Obj[] = [];
  let last: string | undefined;
  series.forEach((value, step) => {
    const now = JSON.stringify(value);
    if (now !== last) out.push({ step, value });
    last = now;
  });
  return out;
}

export function recordedReplica(seriesOf: SeriesOf): RecordedPlay {
  return async (_piece, run) => {
    const steps = stepsOf(run['span']);
    const seed = Number(run['seed']);
    const series = (path: string): readonly unknown[] => (steps > 0 ? seriesOf(path, seed, steps) : []);
    return {
      ok: true, steps, step: STEP_60, track: sha(`track ${seed}`), entries: [],
      values: Object.fromEntries(pathsOf(run, 'values').map((path) => [path, series(path)])),
      changes: Object.fromEntries(pathsOf(run, 'changes').map((path) => [path, changesOf(series(path))])),
      trap: null, bot_trap: null, step_times: [], fuel: {}, ceilings: {},
      checkpoints: [{ step: 0, hash: sha(`start ${seed}`) }], final: sha(`end ${seed}`), frames: [], memory: [],
    };
  };
}
