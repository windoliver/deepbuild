export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
export const TICKS = 600;

export type Rate = 60 | 120;
export type CapName = 'thermal' | 'inactive';
export const RATES: readonly Rate[] = [60, 120];
export const CAPS: readonly CapName[] = ['thermal', 'inactive'];
export const CAP_HZ: Record<CapName, number> = { thermal: 60, inactive: 30 };
export const FRAMES_OF_600_TICKS: Record<CapName, Record<Rate, number>> = { thermal: { 60: 600, 120: 300 }, inactive: { 60: 300, 120: 150 } };
export const MERGE_BASE_FRAMES_OF_600_EXACT_TICKS_UNDER_THE_THERMAL_CAP: Record<Rate, number> = { 60: 300, 120: 200 };
export const everyNth = (hz: Rate, cap: CapName): number => Math.ceil(hz / CAP_HZ[cap]);

export const JITTER_STEP = 17_640;
export const JITTER_STEPS_EITHER_WAY = 8;
export const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

export function seededOffsets(seed: number, count: number): number[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)) ^ mixed;
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };
  const span = 2 * JITTER_STEPS_EITHER_WAY + 1;
  return Array.from({ length: count }, () => ((next() % span) - JITTER_STEPS_EITHER_WAY) * JITTER_STEP);
}

export interface Tick { at: number; force_render?: boolean; require_presentation?: boolean }
export interface Play { what: string; hz: Rate; cap: CapName | null; ticks: Tick[]; presented: boolean[] }

const inMs = (flicks: number): string => (flicks / MS).toFixed(3);
export const framesOf = (play: Play): number => play.presented.filter(Boolean).length;
const presentedTicks = (play: Play): number[] => play.presented.flatMap((shown, tick) => (shown ? [tick] : []));

export function countFailures(play: Play, wanted: number): string[] {
  const frames = framesOf(play);
  return frames === wanted ? [] : [`${play.what}: presented ${frames} frames, not ${wanted}`];
}

export interface Gap { flicks: number; from: number; to: number }
export function longestGap(play: Play): Gap | null {
  let longest: Gap | null = null;
  const shown = presentedTicks(play);
  for (let i = 1; i < shown.length; i++) {
    const from = shown[i - 1]!;
    const to = shown[i]!;
    const flicks = play.ticks[to]!.at - play.ticks[from]!.at;
    if (longest === null || flicks > longest.flicks) longest = { flicks, from, to };
  }
  return longest;
}

export const gapBound = (hz: Rate, cap: CapName): number => FLICKS / CAP_HZ[cap] + FLICKS / hz;

export function gapFailures(play: Play): string[] {
  if (play.cap === null) return [`${play.what}: no cap applies, so no gap is bounded`];
  const bound = gapBound(play.hz, play.cap);
  const gap = longestGap(play);
  if (gap === null || gap.flicks <= bound) return [];
  return [`${play.what}: its longest gap between two presented frames is ${inMs(gap.flicks)} ms (${gap.flicks} flicks, from tick ${gap.from} to tick ${gap.to}), past one cap period plus one refresh, ${inMs(bound)} ms (${bound} flicks)`];
}

export interface Seeded { seed: number; play: Play }
export function seedFailures(label: string, plays: readonly Seeded[], wanted: number): string[] {
  const failures = plays.flatMap(({ play }) => countFailures(play, wanted));
  const counted = plays.map(({ seed, play }) => ({ seed, frames: framesOf(play) }));
  const fewest = counted.reduce((a, b) => (b.frames < a.frames ? b : a));
  const most = counted.reduce((a, b) => (b.frames > a.frames ? b : a));
  if (fewest.frames !== most.frames) failures.push(`${label}: the counts differ between seeds: seed ${fewest.seed} presents ${fewest.frames} frames and seed ${most.seed} presents ${most.frames}`);
  return failures;
}

export interface Difference { entry: number; model: number | null; window: number | null }
export function firstDifference(model: readonly number[], window: readonly number[]): Difference | null {
  const entries = Math.max(model.length, window.length);
  for (let entry = 0; entry < entries; entry++) {
    if (model[entry] !== window[entry]) return { entry, model: model[entry] ?? null, window: window[entry] ?? null };
  }
  return null;
}

export function sideBySideFailures(what: string, vsyncs: readonly number[], model: readonly number[], window: readonly number[]): string[] {
  const difference = firstDifference(model, window);
  if (difference === null) return [];
  const named = (vsync: number | null): string => (vsync === null ? 'nothing' : `the vsync ${vsync} (tick ${vsyncs.indexOf(vsync)})`);
  return [`${what}: the vsyncs the model opens and the ticks the window's rule presents differ first at entry ${difference.entry}: the model opens ${named(difference.model)} where the window's rule presents ${named(difference.window)}; the model opened ${model.length} vsyncs and the window presented ${window.length} ticks`];
}

export function ownTickFailures(play: Play): string[] {
  return play.ticks.flatMap((tick, at) => {
    const frame = tick.force_render ? 'forced render' : tick.require_presentation ? 'frame that requires presentation' : null;
    if (frame === null || play.presented[at]) return [];
    const next = play.presented.indexOf(true, at + 1);
    return [`${play.what}: the ${frame} at tick ${at} did not present on its own tick; ${next < 0 ? 'no later tick presented a frame' : `the next frame presented is tick ${next}'s`}`];
  });
}

export function everyTickFailures(play: Play): string[] {
  const skipped = play.presented.flatMap((shown, tick) => (shown ? [] : [tick]));
  return skipped.length === 0 ? [] : [`${play.what}: ${skipped.length} of ${play.ticks.length} ticks presented no frame, the first of them tick ${skipped[0]}`];
}

export type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE';
export interface Verdict { status: Status; reasons: string[] }
const WORST_FIRST: readonly Status[] = ['FAIL', 'BLOCKED', 'INCONCLUSIVE', 'PASS'];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const brief = (value: unknown): string => (JSON.stringify(value) ?? String(value)).slice(0, 300);

export function budgetVerdict(record: unknown, tasks: readonly string[]): Verdict {
  if (!isObject(record) || typeof record['lane'] !== 'string' || !record['lane'].startsWith('budget-window ') || !Array.isArray(record['tests'])) {
    return { status: 'BLOCKED', reasons: [`it is not a budget window's record of a commit (a lane "budget-window <commit>" with its tests): ${brief(record)}`] };
  }
  const rows = record['tests'].filter(isObject);
  const notReached = Array.isArray(record['notReached']) ? record['notReached'] : [];
  const read = tasks.map((task): Verdict => {
    const row = rows.find((candidate) => candidate['id'] === task);
    if (row === undefined) return { status: 'INCONCLUSIVE', reasons: [notReached.includes(task) ? `the window did not reach ${task} on that commit` : `the record holds no row for ${task}`] };
    const note = typeof row['note'] === 'string' ? `: ${row['note']}` : '';
    if (row['state'] === 'FAIL' || row['state'] === 'BLOCKED') return { status: row['state'], reasons: [`${task} reads ${row['state']}${note}`] };
    if (row['state'] !== 'PASS') return { status: 'INCONCLUSIVE', reasons: [`${task} reads ${typeof row['state'] === 'string' ? row['state'] : brief(row['state'])}${note}`] };
    const sides = row['sides'];
    if (!isObject(sides) || !isObject(sides['change']) || !isObject(sides['base'])) return { status: 'INCONCLUSIVE', reasons: [`${task} reads PASS with no numbers of the merge base beside the change's`] };
    return { status: 'PASS', reasons: [] };
  });
  return { status: WORST_FIRST.find((status) => read.some((verdict) => verdict.status === status)) ?? 'INCONCLUSIVE', reasons: read.flatMap((verdict) => verdict.reasons) };
}

export const CARRIED_TABLE = 'vendor/gpui-pre-apple/upstream/README.md';
export const CARRIED_TABLE_HEADING = '## Carried patches';
export const WINDOW_RULE_FILE = 'vendor/gpui-pre/src/window.rs';
export const PATCH_ISSUE = '#3441';
export const PATCH_MARK = 'DeepBuild patch (windoliver/deepbuild#3441)';

export function patchRowFailures(table: string, textOf: (path: string) => string | null): string[] {
  const lines = table.split('\n');
  const heading = lines.indexOf(CARRIED_TABLE_HEADING);
  if (heading < 0) return [`${CARRIED_TABLE} has no "${CARRIED_TABLE_HEADING}" heading`];
  const rows: string[][] = [];
  for (let at = heading + 1; at < lines.length && !lines[at]!.startsWith('#'); at++) {
    if (lines[at]!.startsWith('|')) rows.push(lines[at]!.split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  const header = rows[0] ?? [];
  const [issue, files, test, removal] = ['Issue', 'Files', 'Test', 'Removal'].map((name) => header.indexOf(name));
  if ([issue, files, test, removal].some((column) => column === undefined || column < 0)) return [`the table under "${CARRIED_TABLE_HEADING}" has no Issue, Files, Test and Removal columns: ${brief(header)}`];
  const own = rows.slice(2).filter((row) => (row[issue!] ?? '').split(/[\s,]+/).includes(PATCH_ISSUE));
  if (own.length === 0) return [`the carried-patch table holds no row whose Issue is ${PATCH_ISSUE}`];
  const listed = [...new Set(own.flatMap((row) => [...(row[files!] ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1]!)))];
  const failures: string[] = [];
  if (!listed.includes(WINDOW_RULE_FILE)) failures.push(`no row of ${PATCH_ISSUE} lists ${WINDOW_RULE_FILE}, whose request-frame callback keeps a window's caps; it lists ${brief(listed)}`);
  for (const file of listed) {
    const text = textOf(file);
    if (text === null) failures.push(`a row of ${PATCH_ISSUE} lists ${file}, which is not there`);
    else if (!text.includes(PATCH_MARK)) failures.push(`${file}, which a row of ${PATCH_ISSUE} lists, holds no hunk marked "${PATCH_MARK}"`);
  }
  for (const row of own) {
    if (!/`[^`]+ › [^`]+`/.test(row[test!] ?? '')) failures.push(`a row of ${PATCH_ISSUE} names no test by its path and its name: ${brief(row[test!] ?? '')}`);
    if ((row[removal!] ?? '') === '' || row[removal!] === '—') failures.push(`a row of ${PATCH_ISSUE} gives no removal condition`);
  }
  return failures;
}
