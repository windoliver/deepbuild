// npm's semver ranges, the part of them paseo's `requirements.paseo` uses (`>=0.15.0 <0.16.0`, `^0.17.6`, `0.17.x`,
// `a - b`, `||`), for stable versions only: what paseo's own check (`assertPluginCompatibility` in
// @getpaseo/protocol's plugin-requirements.ts) decides for a daemon of a stable version. Written here, in erasable
// TypeScript, so the stand-in `paseo` (fixtures/paseo.mjs) and the tests read a range the same way with no dependency.
export type Version = [number, number, number];

/** A stable `x.y.z` (a leading `v` allowed), or undefined for anything else, a prerelease included. */
export function parse(text: string): Version | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}
export function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
/** `a` is newer than `b`, both stable `x.y.z`. */
export const newer = (a: string, b: string): boolean => compare(parse(a)!, parse(b)!) > 0;

type Test = (v: Version) => boolean;
/** A partial version (`0`, `0.17`, `0.17.x`, `*`) as its parts, x and missing parts undefined. */
function partial(text: string): (number | undefined)[] {
  const parts = text.replace(/^v/, '').split('.');
  return [0, 1, 2].map((i) => (parts[i] === undefined || /^[xX*]$/.test(parts[i]!) ? undefined : Number(parts[i])));
}
const lower = (p: (number | undefined)[]): Version => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
/** The first version past a partial one: `0.17` → `0.18.0`, `0` → `1.0.0`. */
function past(p: (number | undefined)[]): Version | undefined {
  if (p[0] === undefined) return undefined;
  if (p[1] === undefined) return [p[0] + 1, 0, 0];
  if (p[2] === undefined) return [p[0], p[1] + 1, 0];
  return undefined;
}
function comparator(token: string): Test {
  const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(token)!;
  const op = m[1] ?? '';
  const p = partial(m[2]!);
  const lo = lower(p);
  if (op === '^') {
    const hi: Version = lo[0] > 0 ? [lo[0] + 1, 0, 0] : lo[1] > 0 || p[2] === undefined ? [0, lo[1] + 1, 0] : [0, 0, lo[2] + 1];
    return (v) => compare(v, lo) >= 0 && compare(v, hi) < 0;
  }
  if (op === '~') {
    const hi: Version = p[1] === undefined ? [lo[0] + 1, 0, 0] : [lo[0], lo[1] + 1, 0];
    return (v) => compare(v, lo) >= 0 && compare(v, hi) < 0;
  }
  const end = past(p);
  if (op === '>=') return (v) => compare(v, lo) >= 0;
  if (op === '<') return (v) => compare(v, lo) < 0;
  if (op === '>') return end ? (v) => compare(v, end) >= 0 : (v) => compare(v, lo) > 0;
  if (op === '<=') return end ? (v) => compare(v, end) < 0 : (v) => compare(v, lo) <= 0;
  if (p[0] === undefined) return () => true;
  return end ? (v) => compare(v, lo) >= 0 && compare(v, end) < 0 : (v) => compare(v, lo) === 0;
}
/** Whether a stable version satisfies an npm range; a range this reader can't read holds nothing. */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  if (!v || typeof range !== 'string' || !range.trim()) return false;
  return range.split('||').some((alternative) => {
    const set = alternative.trim().replace(/\s+-\s+/, ' - ');
    const hyphen = /^(\S+) - (\S+)$/.exec(set);
    const tokens = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : set.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    try {
      return tokens.every((t) => comparator(t)(v));
    } catch {
      return false;
    }
  });
}
