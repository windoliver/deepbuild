// The criteria's fixtures (README: Fixtures): the plates, each criterion's rows and what its program does at each step,
// and the answers that are written by hand (the ridge's closed form, the steps the criteria name). Nothing here runs a
// library or the reference; no vitest or Node import, so a scratch script reads it alone.

import { CLOAKED, KIND, NO_SENSOR, NO_UNIT, STRUCTURE, type Op, type Params, type Plan, type Plate, type SensorRow, type UnitRow } from './model.ts';

// The issue's strong defaults (Scope): sight cells of 8 × 8 height samples, radar cells of 4 × 4, a rebuild over 3
// steps, eye height 2 m above the unit's ground.
export const CELL = 8;
export const RADAR_CELL = 4;
export const SPREAD = 3;
export const EYE_HEIGHT = 2;
/** Fog cells a sight cell's side. */
export const Q = CELL / RADAR_CELL;

const eye = (side: number, x: number, z: number, range: number): SensorRow => ({ x, z, height: EYE_HEIGHT, range, kind: KIND.eye, side });
const radar = (side: number, x: number, z: number, range: number): SensorRow => ({ x, z, height: 0, range, kind: KIND.radar, side });
const jam = (side: number, x: number, z: number, range: number): SensorRow => ({ x, z, height: 0, range, kind: KIND.jam, side });
const detect = (side: number, x: number, z: number): SensorRow => ({ x, z, height: 0, range: 0, kind: KIND.detect, side });
const unit = (side: number, x: number, z: number, more: Partial<UnitRow> = {}): UnitRow => ({ x, z, decloak: 0, side, kind: 1, flags: 0, ...more });

/** A plate of `metres` × `metres` at 1 m spacing, centred on the origin (#2014: sample i at −size ÷ 2 + i × spacing). */
function plate(metres: number, height: (x: number, z: number) => number): Plate {
  const n = metres + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = height(i - metres / 2, j - metres / 2);
  return { cols: n, rows: n, spacing: 1, x0: -metres / 2, z0: -metres / 2, heights };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the ridge plate. 1,024 × 1,024 m (1,025 × 1,025 samples), 128 × 128 sight cells of 8 m. A ridge 40 m
// high runs across its middle from edge to edge, 16 m thick (−8 ≤ z ≤ 8: sight rows 63 and 64). Behind it stands a
// hill 120 m high, one sight row deep and four cells wide (−24 ≤ z ≤ −16, −16 ≤ x ≤ 16: row 61, columns 62 to 65).
// Everything else is flat at 0.

export const RIDGE = { height: 40, rows: [63, 64] as const, front: 64 } as const;
export const HILL = { height: 120, row: 61, columns: [62, 65] as const } as const;
export const ridgePlate = (): Plate => plate(1024, (x, z) => (z >= -8 && z <= 8 ? RIDGE.height : z >= -24 && z <= -16 && x >= -16 && x <= 16 ? HILL.height : 0));
/** The sensor: an eye 300 m in front of the ridge's line, at (4, 300): the centre of sight cell (64, 101). */
export const RIDGE_EYE = { x: 4, z: 300, cell: [64, 101] as const, range: 330 } as const;
/** Side 0 is player 1, side 1 player 2. */
export const TWO_PLAYERS = [1, 2];
export const ridgeParams = (): Params => ({ cell: CELL, radarCell: RADAR_CELL, spread: SPREAD, players: TWO_PLAYERS, seed: 959n });
/** The units of criterion 1: the sensor's own (side 0), an enemy on flat ground 12 m behind the ridge's line, inside the
 * range, and an enemy on flat ground 100 m in front of the ridge. */
export const RIDGE_UNITS = { own: 0, behind: 1, front: 2 } as const;
export function ridgePlan(): Plan {
  return {
    sensors: 1, units: 3,
    steps: [[
      { op: 'sensor', i: 0, row: eye(0, RIDGE_EYE.x, RIDGE_EYE.z, RIDGE_EYE.range) },
      { op: 'unit', i: RIDGE_UNITS.own, row: unit(0, RIDGE_EYE.x, RIDGE_EYE.z) },
      { op: 'unit', i: RIDGE_UNITS.behind, row: unit(1, 40, -12) },
      { op: 'unit', i: RIDGE_UNITS.front, row: unit(1, -20, 100) },
    ]],
  };
}
/** The steps criterion 1 bakes: one rebuild (steps 0 to 2) and the first step of the next. */
export const RIDGE_STEPS = 4;
/**
 * The ridge's answer, written by hand (README: The closed form). The eye stands 2 m over flat ground at the centre of
 * cell (64, 101), so a cell's centre lies dx = cx − 64 and dz = cz − 101 cells from it, in range when dx² + dz² ≤
 * 41.25² (330 m ÷ 8 m; no cell lies at exactly that distance). In range: every flat cell on the eye's side of the
 * ridge is seen (the line falls from 2 m to 0 over ground at 0); the ridge's front row is seen (the line rises to 40 m
 * over ground at 0), its back row isn't (the line is under 40 m over the front row); every flat cell behind the ridge
 * is unseen (the line is under 2 m where it crosses the 40 m ridge); the hill's four cells are seen (the line to its
 * 120 m top is over 110 m at the ridge).
 */
export function ridgeSeen(cx: number, cz: number): boolean {
  const dx = cx - RIDGE_EYE.cell[0];
  const dz = cz - RIDGE_EYE.cell[1];
  if (dx * dx + dz * dz > 41.25 * 41.25) return false;
  if (cz > RIDGE.front) return true;
  if (cz === RIDGE.front) return true;
  return cz === HILL.row && cx >= HILL.columns[0] && cx <= HILL.columns[1];
}

// ---------------------------------------------------------------------------------------------------
// Criteria 2 and 3: a flat plate of 128 × 128 m (129 × 129 samples): 16 × 16 sight cells, 32 × 32 fog cells of 4 m.
// Both ask a rebuild over 1 step, so a cell's state at a step is the rows' at that step (README: Readings).

export const flatPlate = (): Plate => plate(128, () => 0);

/** Criterion 2. Side 0 is player 1; side 1 is players 2 and 3 (a side's bits are its players'). */
export const JAM = {
  players: [1, 6],
  sensors: { radar: 0, jammer: 1, ownRadar: 2 },
  units: { jammed: 0, clear: 1, underOwnJammer: 2 },
  /** The jammer's last step: its row is gone from the next. */
  dies: 5,
  steps: 9,
  /** The fog cell holding the jammed unit at (6, 2), and the one holding the unit under its own side's jammer at (20, 12). */
  jammedCell: [17, 16] as const,
  ownCell: [21, 19] as const,
  /** A fog cell in the radar's range and outside the jammer's: the one holding the unit at (−30, 20). */
  clearCell: [8, 21] as const,
} as const;
export const jamParams = (): Params => ({ cell: CELL, radarCell: RADAR_CELL, spread: 1, players: [...JAM.players], seed: 959n });
export function jamPlan(): Plan {
  const steps: Op[][] = Array.from({ length: JAM.steps }, () => []);
  steps[0] = [
    { op: 'sensor', i: JAM.sensors.radar, row: radar(0, -20, 0, 40) },
    { op: 'sensor', i: JAM.sensors.jammer, row: jam(1, 10, 0, 24) },
    { op: 'sensor', i: JAM.sensors.ownRadar, row: radar(1, 20, 10, 16) },
    { op: 'unit', i: JAM.units.jammed, row: unit(1, 6, 2) },
    { op: 'unit', i: JAM.units.clear, row: unit(1, -30, 20) },
    { op: 'unit', i: JAM.units.underOwnJammer, row: unit(0, 20, 12) },
  ];
  steps[JAM.dies + 1] = [{ op: 'sensor', i: JAM.sensors.jammer, row: { ...NO_SENSOR } }];
  return { sensors: 3, units: 3, steps };
}

/** Criterion 3: the cloak in the plate's west, the ghost in its east. */
export const CLOAK = {
  sensors: { eye: 0, detector: 1 },
  units: { cloaked: 0, plain: 1 },
  /** The decloak radius, in sight cells. */
  radius: 4,
  /** The detector starts 47.5 m from the cloaked unit and comes 1 m a step nearer: 32.5 m (4.0625 cells) at step
   * 15, 31.5 m (3.9375 cells) at step 16. It stops at step 20. */
  within: 16,
  stops: 20,
} as const;
export const GHOST = {
  sensors: { eye: 2, radar: 3 },
  unit: 2,
  /** The structure's place and kind. */
  at: [36, 20] as const,
  kind: 7,
  /** Its fog cell, (36 + 64) ÷ 4 and (20 + 64) ÷ 4. */
  cell: [25, 21] as const,
  seenAt: 100,
  lostAt: 200,
  /** The structure is destroyed while out of sight: its row is empty from this step. */
  destroyedAt: 250,
  /** The watching side's radar covers the ghost's cell from this step. */
  radarAt: 300,
  seenAgainAt: 400,
  steps: 402,
} as const;
export const cloakParams = (): Params => ({ cell: CELL, radarCell: RADAR_CELL, spread: 1, players: TWO_PLAYERS, seed: 959n });
export function cloakPlan(): Plan {
  const steps: Op[][] = Array.from({ length: GHOST.steps }, () => []);
  const watcher = eye(0, 28, 28, 42);
  steps[0] = [
    { op: 'sensor', i: CLOAK.sensors.eye, row: eye(0, -40, -40, 40) },
    { op: 'sensor', i: CLOAK.sensors.detector, row: detect(0, -28, 11.5) },
    { op: 'sensor_velocity', i: CLOAK.sensors.detector, vx: 0, vz: -1 },
    { op: 'unit', i: CLOAK.units.cloaked, row: unit(1, -28, -36, { flags: CLOAKED, decloak: CLOAK.radius }) },
    { op: 'unit', i: CLOAK.units.plain, row: unit(1, -36, -28) },
    { op: 'unit', i: GHOST.unit, row: unit(1, GHOST.at[0], GHOST.at[1], { flags: STRUCTURE, kind: GHOST.kind }) },
  ];
  steps[CLOAK.stops] = [{ op: 'sensor_velocity', i: CLOAK.sensors.detector, vx: 0, vz: 0 }];
  steps[GHOST.seenAt] = [{ op: 'sensor', i: GHOST.sensors.eye, row: watcher }];
  steps[GHOST.lostAt] = [{ op: 'sensor', i: GHOST.sensors.eye, row: { ...NO_SENSOR } }];
  steps[GHOST.destroyedAt] = [{ op: 'unit', i: GHOST.unit, row: { ...NO_UNIT } }];
  steps[GHOST.radarAt] = [{ op: 'sensor', i: GHOST.sensors.radar, row: radar(0, 36, 28, 20) }];
  steps[GHOST.seenAgainAt] = [{ op: 'sensor', i: GHOST.sensors.eye, row: watcher }];
  return { sensors: 4, units: 3, steps };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: 300 units, each with an eye sensor, on the ridge plate (1,025 × 1,025 samples), two sides of 150 on a
// 25 × 12 lattice 40 m by 80 m apart, sides alternating like a chessboard; every unit drifts half a metre a step, its
// sensor with it, so the grids and the seen bits change from one hash to the next.

export const FLEET = {
  units: 300, columns: 25, rows: 12,
  /** Each eye's range, in metres (README: Criterion 4's fixture gives what it makes a library spend). */
  range: 27,
  /** The steps logic.budget judges: four rebuilds. */
  budgetSteps: 12,
  /** The match: 30 Hz, a hash every 10 match steps, 41 steps (hashes at 0, 10, 20, 30 and 40). */
  rate: 30, hashEvery: 10, matchSteps: 41,
} as const;
export const fleetParams = (spread = SPREAD): Params => ({ cell: CELL, radarCell: RADAR_CELL, spread, players: TWO_PLAYERS, seed: 959n });
/** Unit i's start, side and drift. */
export function fleetUnit(i: number): { x: number; z: number; side: number; vx: number; vz: number } {
  const col = i % FLEET.columns;
  const row = Math.floor(i / FLEET.columns);
  const drift = [[0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5]][(col + 2 * row) % 4]!;
  return { x: -480 + 40 * col, z: -440 + 80 * row, side: (col + row) % 2, vx: drift[0]!, vz: drift[1]! };
}
export function fleetPlan(range: number = FLEET.range): Plan {
  const first: Op[] = [];
  for (let i = 0; i < FLEET.units; i++) {
    const u = fleetUnit(i);
    first.push({ op: 'sensor', i, row: eye(u.side, u.x, u.z, range) }, { op: 'sensor_velocity', i, vx: u.vx, vz: u.vz });
    first.push({ op: 'unit', i, row: unit(u.side, u.x, u.z) }, { op: 'unit_velocity', i, vx: u.vx, vz: u.vz });
  }
  return { sensors: FLEET.units, units: FLEET.units, steps: [first] };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: the strategy map. 256 × 256 m (257 × 257 samples): 32 × 32 sight cells, 64 × 64 fog cells. A ridge 12 m
// high crosses its middle (|z| < 8: sight rows 15 and 16). Side 0 (player 1, whose view the pictures show) holds the
// south (+z), side 1 (player 2) the north. The defaults: a rebuild over 3 steps.

export const MAP = {
  metres: 256, ridge: 12,
  sensors: { west: 0, east: 1, radar: 2, scoutEye: 3, scoutDetector: 4 },
  units: { west: 0, east: 1, scout: 2, north: [3, 4, 5] as const, cloaked: 6, depot: 7 },
  /** The depot (a structure of side 1) and its kind. */
  depot: [100, 20] as const, depotKind: 3,
  /** The cloaked unit and its decloak radius in sight cells. */
  cloaked: [-80, 40] as const, radius: 4,
  /** The scout starts at (100, 44) and goes west 2 m a step until step 80. */
  scout: [100, 44] as const, speed: -2, stops: 80,
  steps: 90,
  /** The pictures: the ridge and the blips, the ghost once the scout has left the depot, the cloaked unit revealed. */
  shots: { ridge: 12, ghost: 40, revealed: 84 },
  /** The recording: every third step from 0 to 87. */
  clip: { from: 0, to: 87, every: 3 },
} as const;
export const mapHeight = (_x: number, z: number): number => (Math.abs(z) < 8 ? MAP.ridge : 0);
/** The same heights as the plate's field, `12 * max(sign(8 - abs(position.z)), 0)`. */
export const MAP_FIELD = `${MAP.ridge} * max(sign(8 - abs(position.z)), 0)`;
export const mapPlate = (): Plate => plate(MAP.metres, mapHeight);
export const mapParams = (): Params => ({ cell: CELL, radarCell: RADAR_CELL, spread: SPREAD, players: TWO_PLAYERS, seed: 959n });
export function mapPlan(): Plan {
  const steps: Op[][] = Array.from({ length: MAP.steps }, () => []);
  const s = MAP.sensors;
  const u = MAP.units;
  steps[0] = [
    { op: 'sensor', i: s.west, row: eye(0, -40, 60, 90) },
    { op: 'sensor', i: s.east, row: eye(0, 20, 80, 70) },
    { op: 'sensor', i: s.radar, row: radar(0, 0, 100, 170) },
    { op: 'sensor', i: s.scoutEye, row: eye(0, MAP.scout[0], MAP.scout[1], 40) },
    { op: 'sensor', i: s.scoutDetector, row: detect(0, MAP.scout[0], MAP.scout[1]) },
    { op: 'sensor_velocity', i: s.scoutEye, vx: MAP.speed, vz: 0 },
    { op: 'sensor_velocity', i: s.scoutDetector, vx: MAP.speed, vz: 0 },
    { op: 'unit', i: u.west, row: unit(0, -40, 60) },
    { op: 'unit', i: u.east, row: unit(0, 20, 80) },
    { op: 'unit', i: u.scout, row: unit(0, MAP.scout[0], MAP.scout[1]) },
    { op: 'unit_velocity', i: u.scout, vx: MAP.speed, vz: 0 },
    { op: 'unit', i: u.north[0], row: unit(1, -50, -40) },
    { op: 'unit', i: u.north[1], row: unit(1, 10, -60) },
    { op: 'unit', i: u.north[2], row: unit(1, 60, -30) },
    { op: 'unit', i: u.cloaked, row: unit(1, MAP.cloaked[0], MAP.cloaked[1], { flags: CLOAKED, decloak: MAP.radius }) },
    { op: 'unit', i: u.depot, row: unit(1, MAP.depot[0], MAP.depot[1], { flags: STRUCTURE, kind: MAP.depotKind }) },
  ];
  steps[MAP.stops] = [
    { op: 'sensor_velocity', i: s.scoutEye, vx: 0, vz: 0 }, { op: 'sensor_velocity', i: s.scoutDetector, vx: 0, vz: 0 },
    { op: 'unit_velocity', i: u.scout, vx: 0, vz: 0 },
  ];
  return { sensors: 5, units: 8, steps };
}
