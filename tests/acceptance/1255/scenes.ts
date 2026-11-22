// The fixtures (README: Fixtures): each scene's movers and minima as a piece's logic item declares them, with the
// numbers its criterion gives, and the values worked by hand that the tests hold the model to. Every expected value a
// test compares a library with comes from model.ts on these scenes, never from a run.

import { forty, type Basis, type Mover, type Row, type Scene, type Vec3 } from './model.ts';

/** The criteria's tolerances: 1e-6 m and 1e-6 s, and a delay within 0.5 s. */
export const TOL = 1e-6;
export const DELAY_TOL = 0.5;
/** The table's lateral minimum in every scene (criterion 1's 5,556 m), and its vertical one. */
export const LATERAL = 5556;
export const VERTICAL = 300;

const bands = (m: Pick<Mover, 'route'>, min: number, max: number): Mover['band'] => m.route.map((f) => ({ fix: f.fix, min, max }));

// ---------------------------------------------------------------------------------------------------
// Criterion 1: two movers on straight crossing routes (README: Fixtures: crossing).

/** The right-angle case turned by the 3-4-5 angle (cos 0.8, sin 0.6), so neither route lies along an axis; level at 3,000 m. */
const turned = (x: number, z: number): Vec3 => [x * 0.8 - z * 0.6, 3000, x * 0.6 + z * 0.8];
function crossing(): Scene {
  const east = { id: 'east', class: 'medium', route: [{ fix: 'east.in', at: turned(-20_000, 0) }, { fix: 'east.out', at: turned(20_000, 0) }], speed: [{ from_fix: 'east.in', speed: 200 }], start: 0 };
  const north = { id: 'north', class: 'medium', route: [{ fix: 'north.in', at: turned(0, -18_000) }, { fix: 'north.out', at: turned(0, 18_000) }], speed: [{ from_fix: 'north.in', speed: 150 }], start: 0 };
  return { movers: [{ ...east, band: bands(east, 150, 250) }, { ...north, band: bands(north, 100, 200) }], minima: { lateral: LATERAL, vertical: VERTICAL, by_pair: [] } };
}
/**
 * Before the turn: east flies +x from (−20,000, 0) at 200 m/s, north flies +z from (0, −18,000) at 150 m/s, both from
 * t = 0. North from east is (20,000 − 200t, 150t − 18,000); its squared length is least where
 * −400(20,000 − 200t) + 300(150t − 18,000) = 0, t = 13,400,000 ÷ 125,000 = 107.2 s, where it is (−1,440, −1,920):
 * 2,400 m (480 × 3-4-5). They close at 250 m/s, so the pair is inside 5,556 m for √(5556² − 2400²) ÷ 250 s either side.
 */
export const CROSSING = { scene: crossing(), span: [0, 200] as [number, number], closest: { dist: 2400, time: 107.2 }, half: Math.sqrt(LATERAL ** 2 - 2400 ** 2) / 250 };

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the pair under its 5,556 m minimum for 0.6 s between two whole seconds (README: Fixtures: breach).

/** How near they pass: √(5556² − 75²) m, 75 m being what 250 m/s covers in 0.3 s. */
const PASS = Math.sqrt(LATERAL ** 2 - 75 ** 2);
function breach(): Scene {
  // At 100.5 s north is `PASS` from east, at right angles to their closing velocity (−200, 150): at (0.6, 0.8) × PASS.
  const x0 = -200 * 100.5 - 0.6 * PASS, z0 = 0.8 * PASS - 150 * 100.5;
  const east = { id: 'east', class: 'medium', route: [{ fix: 'east.in', at: [x0, 3000, 0] as Vec3 }, { fix: 'east.out', at: [x0 + 200 * 200, 3000, 0] as Vec3 }], speed: [{ from_fix: 'east.in', speed: 200 }], start: 0 };
  // North starts at 10 s, where it is then, so the piece's hold finds it not yet started.
  const north = { id: 'north', class: 'medium', route: [{ fix: 'north.in', at: [0, 3000, z0 + 150 * 10] as Vec3 }, { fix: 'north.out', at: [0, 3000, z0 + 150 * 250] as Vec3 }], speed: [{ from_fix: 'north.in', speed: 150 }], start: 10 };
  return { movers: [{ ...east, band: bands(east, 150, 250) }, { ...north, band: bands(north, 100, 200) }], minima: { lateral: LATERAL, vertical: VERTICAL, by_pair: [] } };
}
/**
 * East flies +x at 200 m/s and north +z at 150 m/s, level, closing at 250 m/s and passing √(5556² − 75²) m apart at
 * 100.5 s. Their distance is √(PASS² + (250(t − 100.5))²), under 5,556 m while 250|t − 100.5| < 75: from 100.2 s to
 * 100.8 s, 0.6 s between the whole seconds 100 and 101. The piece's own fix, a hold of north by 120 s, moves north
 * 120 × 150 = 18,000 m back along its route at every time; the pass then comes at 143.7 s, 14,400 − PASS = 8,844.5 m apart.
 */
export const BREACH = { scene: breach(), span: [0, 400] as [number, number], window: { from: 100.2, to: 100.8 }, hold: { mover: 1, seconds: 120 }, passAfter: 14_400 - PASS };

// ---------------------------------------------------------------------------------------------------
// Criteria 2, 3, 4 and 6: one final approach (README: Fixtures: approach).

/** A basis of this suite's own making: the fixture's rule sheet, in this folder's README. */
export const CITED: Basis = { cited: { source: 'tests/acceptance/1255/README.md', section: 'Fixtures: approach: the rule sheet' } };
/** Criterion 2's row: a light follower behind a heavy leader, 11,112 m, measured when the leader passes the threshold. */
export const HEAVY_LIGHT = (basis?: Basis): Row => ({ leader: 'heavy', follower: 'light', min: 11_112, at: 'threshold', ...(basis ? { basis } : {}) });
/** A row that fits no pair here (no heavy mover follows a light one to the threshold), so it changes no window. */
export const LIGHT_HEAVY: Row = { leader: 'light', follower: 'heavy', min: 7408, at: 'threshold', basis: CITED };
/** The follower's band at every fix: wide enough for 60 s, or too narrow for it. The two approach pieces differ in nothing else. */
export const WIDE = { min: 60, max: 100 }, NARROW = { min: 80, max: 100 };
/**
 * A straight approach along +x, level at 600 m (no criterion gives a slope): entry (−37,040, 600, 0), final
 * (−18,520, 600, 0), threshold (0, 600, 0), two legs of 18,520 m, each flown at 92.6 m/s in 200 s. The heavy leader
 * (band 60 to 100 m/s) starts at 0 and passes the threshold at 400 s; the light follower starts at 100 s, so when the
 * leader is at the threshold it is 100 s × 92.6 m/s = 9,260 m behind. A departure, 30,000 m off to the side, starts
 * at 300 s on one leg of 9,260 m, runway to exit, at 92.6 m/s with a band of 90 to 100 m/s.
 */
export function approach(follower: { min: number; max: number }, rows: Row[]): Scene {
  const lane = (id: string, cls: string, start: number, b: { min: number; max: number }): Mover => {
    const route = [{ fix: 'entry', at: [-37_040, 600, 0] as Vec3 }, { fix: 'final', at: [-18_520, 600, 0] as Vec3 }, { fix: 'threshold', at: [0, 600, 0] as Vec3 }];
    return { id, class: cls, route, speed: [{ from_fix: 'entry', speed: 92.6 }, { from_fix: 'final', speed: 92.6 }], band: bands({ route }, b.min, b.max), start };
  };
  const out = [{ fix: 'runway', at: [0, 600, 30_000] as Vec3 }, { fix: 'exit', at: [9260, 600, 30_000] as Vec3 }];
  const departure: Mover = { id: 'departure', class: 'light', route: out, speed: [{ from_fix: 'runway', speed: 92.6 }], band: bands({ route: out }, 90, 100), start: 300 };
  return { movers: [lane('leader', 'heavy', 0, WIDE), lane('follower', 'light', 100, follower), departure], minima: { lateral: LATERAL, vertical: VERTICAL, by_pair: rows } };
}
/**
 * By hand: the leader is at the threshold at 400 s and the follower 9,260 m behind then; the follower passes it at
 * 500 s. A delay of 60 s over the leg entry to final (18,520 m in 200 s) needs 18,520 ÷ 260 = 71.2307… m/s; the
 * follower is then at final at 360 s and at the threshold at 560 s, and at 400 s it is 40 s × 92.6 = 3,704 m past
 * final: 14,816 m behind the leader.
 */
export const APPROACH = { span: [0, 700] as [number, number], leader: 0, follower: 1, departure: 2, measured: 400, behind: 9260, threshold: 500, delay: 60, needs: 18_520 / 260, behindAfter: 14_816, asked: 0, late: 250 };

// ---------------------------------------------------------------------------------------------------
// Criterion 5: forty movers over two hours (README: Fixtures: forty).

/** The forty movers, whole span first, then the first 45 minutes and the rest: three results that differ, no window cut by a span's end. */
export const FORTY = { scene: forty(), span: [0, 7200] as [number, number], sweep: [[0, 7200], [0, 2700], [2700, 7200]] as [number, number][] };
