// AC6 #1048.354e0af2: "A text control fed 256 bytes into a 64-byte read region is refused at check, as the sandbox
// already requires, and never reaches a step. A planted check that skips text controls passes a fixture that indexes
// past an empty name's end, and fails this criterion."
//
// The tag (programs.ts): one logic item reading the text control `name` (max_bytes 60, so a 64-byte read region,
// read here from the logic module's own layout), writing as `initial` the name's last byte, indexed at length − 1 with
// no test for an empty name. Its interface lists the text control; logic.edges names a playtest of a policy that
// commits a name every step (1 run of 60 steps; README: The surface: a policy's string on a text control is its
// commit), with 2 samples and 4 settle steps. Played at the base: a name every step runs clean; an empty name traps
// (bounds) at its step; a 256-byte commit stepped by the base's play leaves the region empty and traps too, so a check
// that stepped it would name it.
// - logic.edges fails with logic.trap naming control name and the value text of 0 bytes, the edge a check that skips
//   text controls never puts: it passes this fixture, and fails here.
// - The 256-byte edge is refused at check and never reaches a step: the result lists it under edges.refused for the
//   control name, no failure names it, and no replica play that ran a step carried a name entry past 60 bytes.
// The wrong programs: the base (no logic.edges), a check that skips text controls, one that steps a text past its
// control's max_bytes.
import { describe, expect, it } from 'vitest';
import { AC, DOC, Pool, TIMEOUT, edgesSpec, lockPlay, macOnly, openHub, putPiece, ranNoStep, runCheck, shown, show, word, type Obj } from './helpers.ts';
import { TAG, TAG_POLICY, tagPiece, tagPlay, tagProgram, tagRegion } from './programs.ts';

const EDGES = { playtest: 'REQ-1048-tag', samples: 2, settle: 4, seed: 1048 };
const input = (piece: string, play: Obj): Obj => ({ piece, play, bots: [TAG_POLICY], runs: 1, seed: 1048, span: { steps: 60 }, goals: [], piece_seed: 'own', frames: { every: 0 } });
const bytes = (v: unknown): number => (typeof v === 'string' ? Buffer.byteLength(v, 'utf8') : 0);

describe(`${AC[6]} logic.edges puts a text control's edges: an empty name reaches a step, 256 bytes never do`, () => {
  it(`${AC[6]} an empty name's trap fails logic.edges, naming the control and the value; 256 bytes into the 64-byte region are refused at check and never reach a step`, async () => {
    macOnly();
    expect(tagRegion(), 'the text control\'s read region is 64 bytes').toBe(TAG.region);
    const pool = await Pool.open(2, { entries: false, keep: [] });
    const hub = await openHub(pool);
    const play = await lockPlay(tagPlay());
    const piece = putPiece(DOC.tag, tagPiece(tagProgram()));
    const r = await runCheck(hub, edgesSpec(EDGES, input(piece, play)));
    expect(r.outcome, `logic.edges fails on the tag: ${shown(r)}`).toBe('failed');
    const f = r.failures.find((x) => x.message.startsWith('logic.trap') && word('control name').test(x.message) && x.message.includes('value text of 0 bytes'));
    expect(f, `a logic.trap failure names control name and the value text of 0 bytes: ${shown(r)}`).toBeDefined();
    expect(r.failures.filter((x) => x.message.includes('text of 256 bytes')).map((x) => x.message), 'no failure names the 256-byte value').toEqual([]);
    const refused = (r.edges?.['refused'] as Obj[] | undefined) ?? [];
    expect(refused.some((x) => x['control'] === 'name' && x['value'] === 'text of 256 bytes'), `edges.refused lists the 256-byte value for the control name: ${show(r.edges as never, 600)}`).toBe(true);
    const stepped = pool.log.filter((p) => p.piece === piece && !ranNoStep(p));
    expect(stepped.length, 'the check played the fixture').toBeGreaterThan(0);
    const past = stepped.flatMap((p) => ((p.call['track'] as Obj[] | undefined) ?? []).filter((e) => e['control'] === 'name' && bytes(e['value']) > TAG.maxBytes)).map((e) => bytes(e['value']));
    expect(past, `no play that ran a step carried a name past ${TAG.maxBytes} bytes`).toEqual([]);
    const runs = stepped.filter((p) => p.call['bot']);
    expect(runs.length > 0 && runs.every((p) => p.reply['trap'] === null), 'the playtest\'s own runs, a name every step, never trap').toBe(true);
  }, TIMEOUT);
});
