// AC5 #3605.1380fa30: "The paused level's input track, replayed as a piece with no shell, gives the same arrays at every
// step and the same full-state hash. A planted shell that hands a level the value through its read region with no entry
// fails the replay, naming the first step that differs."
//
// Criterion 4's moves (SETTING_MOVES) through the `moves` journey with keys; the check passes. Level 1 (fuses), the
// level paused after its step 600 and resumed with 240, gives its own input track in the reply's `level_tracks`. That
// track is replayed here as a piece with no shell: the replica's play mode, `{call: "play", document: <level 1's
// document>, track, span: {steps: 900}, values: [...]}` on a replica of the same pool. At every step 0 to 899 its
// l1.seen, l1.done and l1.clock equal the shell run's (each step's row, as criterion 4 reads them), and its final
// full-state hash equals the shell run's level hash at the row where level 1 had run 900 steps.
// On a replica planted with DEEP_DRIVE_PLANT=setting-through-reads (the shell writes the value into the level's read
// region and enters nothing on its track), the moves from the level select into PAUSE_CHANGE: the planted run's level 1
// track, replayed here the same way, first differs from the planted run's rows at a step k computed here, and the check
// fails with a failure naming `step k`.
// The wrong programs: the base, the twin, a track that holds the value at another step than the one the level read it,
// and a check that never replays a level's track.
import { describe, expect, it } from 'vitest';
import { AC, DOC, SEED, TIMEOUT, atLevelStep, failed, hubOnce, journeysInput, macOnly, onePlay, passed, putShell, runJourneys, show, shown, stepped, word, type Hub, type Row } from './helpers.ts';
import { PAUSE_CHANGE, SETTING_MOVES, allPrograms, levelOf, programs, shellDocument, type Programs } from './shell.ts';
import type { Obj } from './helpers.ts';

const clean = hubOnce();
const planted = hubOnce({ plant: 'setting-through-reads' });
const LEVEL = 1;
const STEPS = 900;
const PATHS = ['seen', 'done', 'clock'].map((a) => `l${LEVEL}.${a}`);

/** Level 1's track replayed with no shell on one of the pool's replicas: each path's value at each step, and the final hash. */
async function replay(h: Hub, p: Programs, shell: Obj, entries: unknown[]): Promise<{ values: Record<string, number[]>; final: string }> {
  const program = p.lessons[LEVEL]!;
  const reply = await h.pool.direct({ call: 'play', document: levelOf(shell, LEVEL), assets: { [program.sha]: program.b64 }, seed: SEED, track: entries, span: { steps: STEPS }, values: PATHS });
  expect(reply['ok'], `level 1's track replays as a piece with no shell: ${show(reply, 800)}`).toBe(true);
  const first = (v: unknown): number => Number(Array.isArray(v) ? v[0] : v);
  return {
    values: Object.fromEntries(PATHS.map((path) => [path, ((reply['values']?.[path] ?? []) as unknown[]).map(first)])),
    final: String(reply['final']),
  };
}
/** The first step 0..899 at which the replay's arrays differ from the run's rows, or -1. */
function firstDiffering(rows: Row[], r: { values: Record<string, number[]> }): number {
  for (let k = 0; k < STEPS; k++) {
    const row = atLevelStep(rows, LEVEL, k);
    if (!row || PATHS.some((path) => row.values[path]?.[0] !== r.values[path]![k])) return k;
  }
  return -1;
}
async function levelTrack(h: Hub, piece: string, what: string): Promise<{ rows: Row[]; entries: unknown[] }> {
  const reply = onePlay(h.pool, piece, 'moves', 'keys', what);
  const rows = stepped(reply, what);
  const tracks = reply.level_tracks.filter((t) => t.level === LEVEL);
  expect(tracks.length, `${what}: the play gives level 1's own input track once`).toBe(1);
  return { rows, entries: tracks[0]!.entries };
}

describe(`${AC[5]} the paused level's own track replays with no shell to the same arrays and hash; a value through the read region alone fails the replay`, () => {
  it(`${AC[5]} level 1's track, replayed as a piece with no shell, gives the same arrays at every step and the same full-state hash`, async () => {
    macOnly();
    const p = programs();
    const h = await clean();
    const shell = shellDocument(p);
    const piece = putShell(DOC.shell, shell, allPrograms(p));
    passed(await runJourneys(h, journeysInput(piece, { journeys: ['moves'], moves: SETTING_MOVES })), 'criterion 4\'s moves with keys');
    const { rows, entries } = await levelTrack(h, piece, 'criterion 4\'s moves');
    const r = await replay(h, p, shell, entries);
    for (const path of PATHS) expect(r.values[path]!.length, `the replay gives ${path} at each of its ${STEPS} steps`).toBe(STEPS);
    const k = firstDiffering(rows, r);
    expect(k, `the replay's arrays first differ from the run's at step ${k}${k >= 0 ? `: run ${show(atLevelStep(rows, LEVEL, k)?.values)}, replay ${show(Object.fromEntries(PATHS.map((x) => [x, r.values[x]![k]])))}` : ''}`).toBe(-1);
    const last = atLevelStep(rows, LEVEL, STEPS - 1);
    expect(last?.level_hash, 'the run gives level 1\'s own full-state hash at its step 899').toMatch(/^[0-9a-f]{16,64}$/);
    expect(r.final, 'the replay ends on the run\'s full-state hash of level 1 at its step 899').toBe(last!.level_hash);
  }, TIMEOUT);

  it(`${AC[5]} a planted shell that hands the level the value through its read region with no entry fails the replay, naming the first step that differs`, async () => {
    macOnly();
    const p = programs();
    const h = await planted();
    const shell = shellDocument(p);
    const piece = putShell(DOC.shell, shell, allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['moves'], moves: [{ activate: 'levels_button' }, ...PAUSE_CHANGE] }));
    const { rows, entries } = await levelTrack(h, piece, 'the planted shell\'s moves');
    const k = firstDiffering(rows, await replay(h, p, shell, entries));
    expect(k, 'the planted run\'s level 1 track replays to other arrays than its run read').toBeGreaterThanOrEqual(0);
    failed(result, 'the planted shell\'s moves journey');
    expect(result.failures.some((f) => word(`step ${k}`).test(f.message)), `a failure names step ${k}, the first step whose arrays differ: ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});
