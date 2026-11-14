// Oracle lane for #507, criterion 5 (AC5 #507.44897258): "A stage with `hold: loop {from}` on a marker 2 s before it,
// held for 7 s, shows the span's frames at clock offsets 0, 2, 4 and 6 s exactly, seeking equal to playing, …"
//
// The Oracle page links one upstream test to this criterion, the pinned looping playback test of the upstream engine,
// with the use "port": its looping cases play a 10 s sequence on a loop and check, after updates to clock times that
// cross loop boundaries, the range evaluated, and 12 s on the clock reads 2 s into the sequence. The rule ported: a time
// t on a loop of length L reads t mod L into it, over a range whose end is excluded (its playback range is [0, 10 s), its
// last valid tick one before the end), so a whole number of loops reads the loop's start. The cases are its first
// looping case's forward updates, with no dissection: to 5 s, 12 s and 23 s, which read 5 s, 2 s and 3 s; as shares of
// the loop, 0.5, 1.2 and 2.3; and the whole loops 1, 2 and 3. Here L is the span the stage loops, [4 s, 6 s), so the
// clock offsets into the hold are 1.0, 2.4 and 4.6 s, reading 5.0, 4.4 and 4.6 s of the timeline, and 2, 4 and 6 s,
// reading 4 s, never the stage's own 6 s. #136's rule: the lane counts only when run on our output, so every case is
// the frame `deep-show` shows at that clock time in a present-mode session (the loop film, helpers.ts `loopFilm`),
// played and sought (`determinism`'s two sides), against the frame the timeline showed at that position on its way to
// the stage. The stage marker, the advance and the present entries are ours (the page says so), as are the session's
// numbers. Nothing of the upstream file is copied here: it is read in place, checked against its pin, and the update
// times this lane ports are looked up in it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  A, DISPLAY_A, DOC, Driver, LOOP, REPO, TIMEOUT, arr, enterPresent, fl, int, key, loopFilm, none, obj, presentEntry, secs, show, str,
  useShow, useTemp,
} from '../507/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
interface Pin { commit: string; short: string; sha256: string; bytes: number }
const PIN = JSON.parse(readFileSync(join(HERE, 'pin.json'), 'utf8')) as Pin;
/** The oracle checkout: `DEEP_ORACLES` (the folder holding `vendor/`), else a sibling worktree of the `doneright` branch. */
const ORACLES = process.env['DEEP_ORACLES'] ? resolve(process.env['DEEP_ORACLES']) : resolve(REPO, '..', 'deep-oracles', 'doneright', 'oracles');

/** The pinned file's text, found by its SHA-256 in the commit's vendored folder; else BLOCKED with the one unblock ask. */
function pinned(): string {
  const vendor = join(ORACLES, 'vendor');
  const roots = existsSync(vendor) ? readdirSync(vendor).filter((d) => d.endsWith(`-${PIN.short}`)).map((d) => join(vendor, d)) : [];
  const walk = (dir: string): string | null => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) { const hit = walk(p); if (hit !== null) return hit; continue; }
      if (st.size !== PIN.bytes) continue;
      const bytes = readFileSync(p);
      if (createHash('sha256').update(bytes).digest('hex') === PIN.sha256) return bytes.toString('utf8');
    }
    return null;
  };
  for (const root of roots) { const text = walk(root); if (text !== null) return text; }
  return expect.fail(`BLOCKED: the pinned looping playback test (commit ${PIN.commit}, sha256 ${PIN.sha256}) is not under ${vendor}/*-${PIN.short}/; this is not a pass.\nUnblock: check out branch doneright of DeepBuildAI/deepbuild as a worktree (git fetch origin doneright && git worktree add ../deep-oracles origin/doneright) or set DEEP_ORACLES to the folder that holds vendor/, then rerun.`);
}

/** The ported cases: a share of the loop, the update in the pinned test it comes from (null for a whole loop), and the share read. */
const CASES = [
  { share: 0.5, upstream: '30 * 5', reads: 0.5 },
  { share: 1.2, upstream: '30 * 12', reads: 0.2 },
  { share: 2.3, upstream: '30 * 23', reads: 0.3 },
  { share: 1, upstream: null, reads: 0 },
  { share: 2, upstream: null, reads: 0 },
  { share: 3, upstream: null, reads: 0 },
] as const;

/** The criterion's tag: `AC5 #507.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC5 #507.44897258';
const bin = useShow();
const temp = useTemp();

describe(`${ID} oracle: the pinned looping playback test's rule run on our held loop`, () => {
  it(`${ID} oracle: at clock offsets across loop boundaries the held stage shows the span's frame at the offset mod the span, sought as played`, () => {
    const upstream = pinned();
    for (const c of CASES) if (c.upstream !== null) expect(upstream.includes(c.upstream), `the pinned test updates to ${c.upstream} frames`).toBe(true);
    const L = fl(LOOP.span);
    const d = new Driver(bin(), { evidence: temp(), displays: [DISPLAY_A], doc: DOC.loop });
    enterPresent(d, DOC.loop, loopFilm(), A, 'the loop film in present mode');
    const [adv] = d.step([key(fl(1), 'ArrowRight')], 'leaving stage s1');
    const e1 = presentEntry(adv, 'advance', '→ on stage s1').t;
    const hold = e1 + fl(LOOP.stage);
    const cases = CASES.map((c) => {
      const off = Math.round(c.share * L);
      expect(off % L, `share ${c.share} reads ${c.reads} of the loop`).toBe(Math.round(c.reads * L));
      return { ...c, clock: hold + off, position: fl(LOOP.from) + (off % L) };
    });
    const positions = [...new Set(cases.map((c) => c.position))];
    const refs = positions.map((p) => e1 + p);
    const times = [...new Set([...refs, ...cases.map((c) => c.clock)])].sort((a, b) => a - b);
    const [, det] = d.step([
      key(hold + fl(7), 'ArrowRight'),
      { call: 'determinism', at: hold + fl(8), doc: DOC.loop, display_hz: LOOP.fps, at_times: times },
    ], 'the held loop compared');
    const o = obj(det, 'determinism');
    expect(o['outcome'], `determinism compares: ${show(o)}`).toBe('compared');
    const frames = arr(o['frames'], 'determinism: frames').map((f, i) => obj(f, `frames[${i}]`));
    expect(frames.map((f) => f['t']), 'one frame per time asked, in time order').toEqual(times);
    const at = new Map(frames.map((f) => [int(f['t'], 't'), f]));
    const side = (t: number, s: 'play' | 'seek'): { position: number; hash: string } => {
      const f = obj(obj(at.get(t), `the frame at ${secs(t)}`)[s], `the ${s} side at ${secs(t)}`);
      return { position: int(f['position'], `the ${s} side's position at ${secs(t)}`), hash: str(f['pixel_hash'], `the ${s} side's pixel_hash at ${secs(t)}`) };
    };
    const failures: string[] = [];
    for (const p of positions) {
      const ref = side(e1 + p, 'play');
      if (ref.position !== p) failures.push(`on its way to the stage, ${secs(p)} after the advance, the timeline is at ${secs(ref.position)}`);
    }
    for (const c of cases) {
      const ref = side(e1 + c.position, 'play').hash;
      for (const s of ['play', 'seek'] as const) {
        const got = side(c.clock, s);
        const label = `${c.share} loops (${secs(c.clock - hold)}) into the hold, ${s}ed`;
        if (got.position !== c.position) failures.push(`${label}: the timeline is at ${secs(got.position)}, not ${secs(c.position)}`);
        if (got.hash !== ref) failures.push(`${label}: the frame isn't the span's frame at ${secs(c.position)}`);
      }
    }
    none(failures, "the pinned test's loop rule on the held stage");
  }, TIMEOUT);
});
