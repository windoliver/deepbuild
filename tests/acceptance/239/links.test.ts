// AC4 #239.68acd310: "#142, #143 and #222 to #229 are blocked by this issue in the live dependency links, and #99 no
// longer depends on #222"
//
// Read live with `gh api` (the issue dependencies API: `issues/<n>/dependencies/blocked_by`, and `issues/<n>/sub_issues`
// for an umbrella's parts). #142 and #222 to #229 must each list #239 among their blockers. #143 is an umbrella held
// through its parts (the owner's comment on the issue, Nov 9: "#462 is blocked by #239, and #463 by #462"): it passes
// when #239 blocks it directly or when it has an open part and every open part reaches #239 through open blockers,
// four links at most (README: Readings). #99's blockers must not hold #222. Without `gh` or the network the test reads
// BLOCKED. The judge is also run on planted link sets made here, each missing one link the criterion needs, and must
// fail each, naming the issue. Wrong programs: links that leave any of these issues free to start before #239, or #99
// still waiting on #222.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { AC, arr, blocked, failsNaming, int, none, obj, type JsonValue } from './helpers.ts';

const GATE = 239;
const DIRECT = [142, 222, 223, 224, 225, 226, 227, 228, 229];
const UMBRELLA = 143;
const MAX_LINKS = 4;

interface Ref { number: number; open: boolean }
interface Links { blockedBy(n: number): Ref[]; parts(n: number): Ref[] }

const refsOf = (v: JsonValue, what: string): Ref[] =>
  arr(v, what).map((x, i) => { const o = obj(x, `${what}[${i}]`); return { number: int(o['number'], `${what}[${i}].number`), open: o['state'] === 'open' }; });

/** The live links, each list read once. */
function live(): Links {
  const cache = new Map<string, Ref[]>();
  const get = (path: string): Ref[] => {
    const hit = cache.get(path);
    if (hit) return hit;
    const r = spawnSync('gh', ['api', '-H', 'X-GitHub-Api-Version: 2026-03-10', `repos/windoliver/deepbuild/${path}`], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) blocked(`gh can't read the live dependency links (${path}): ${r.error?.message ?? (r.stderr ?? '').trim().slice(0, 400)}`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(r.stdout) as JsonValue; } catch { return expect.fail(`gh api ${path} answered no JSON: ${r.stdout.slice(0, 400)}`); }
    const refs = refsOf(parsed, path);
    cache.set(path, refs);
    return refs;
  };
  return {
    blockedBy: (n) => get(`issues/${n}/dependencies/blocked_by?per_page=100`),
    parts: (n) => get(`issues/${n}/sub_issues?per_page=100`),
  };
}

/** A chain of open blockers from `n` to #239, at most MAX_LINKS links, or null. */
function chainTo(links: Links, n: number): number[] | null {
  let frontier: number[][] = [[n]];
  const seen = new Set([n]);
  for (let depth = 0; depth < MAX_LINKS; depth++) {
    const next: number[][] = [];
    for (const path of frontier) {
      for (const b of links.blockedBy(path[path.length - 1]!)) {
        if (b.number === GATE) return [...path, GATE];
        if (b.open && !seen.has(b.number)) { seen.add(b.number); next.push([...path, b.number]); }
      }
    }
    frontier = next;
  }
  return null;
}
const list = (refs: Ref[]): string => refs.map((r) => `#${r.number}${r.open ? '' : ' (closed)'}`).join(', ') || 'none';

/** Every way the links miss the criterion, one sentence each, naming the issue. */
function linkFailures(links: Links): string[] {
  const out: string[] = [];
  for (const n of DIRECT) {
    const b = links.blockedBy(n);
    if (!b.some((r) => r.number === GATE)) out.push(`#${n} is not blocked by #239; its blockers: ${list(b)}`);
  }
  const ub = links.blockedBy(UMBRELLA);
  if (!ub.some((r) => r.number === GATE)) {
    const open = links.parts(UMBRELLA).filter((p) => p.open);
    if (open.length === 0) out.push(`#143 is not blocked by #239 and has no open part to be held through; its blockers: ${list(ub)}`);
    for (const p of open) if (!chainTo(links, p.number)) out.push(`#143 is not held by #239: its part #${p.number} reaches #239 through no chain of open blockers (its blockers: ${list(links.blockedBy(p.number))})`);
  }
  const b99 = links.blockedBy(99);
  if (b99.some((r) => r.number === 222)) out.push(`#99 still depends on #222; its blockers: ${list(b99)}`);
  return out;
}

/** A link set written here: each issue's blockers (all open unless named closed) and the umbrella's parts. */
function planted(blockers: Record<number, number[]>, parts: Record<number, number[]>, closed: number[] = []): Links {
  const ref = (n: number): Ref => ({ number: n, open: !closed.includes(n) });
  return { blockedBy: (n) => (blockers[n] ?? []).map(ref), parts: (n) => (parts[n] ?? []).map(ref) };
}
const HELD: Record<number, number[]> = {
  ...Object.fromEntries(DIRECT.map((n) => [n, [GATE, 417]])), [UMBRELLA]: [462, 463], 462: [GATE], 463: [462], 99: [403, 404, 405, 406, 407, 408, 409],
};
const PARTS: Record<number, number[]> = { [UMBRELLA]: [462, 463] };

describe(`${AC[4]} #142, #143 and #222 to #229 are blocked by #239 in the live links, and #99 no longer depends on #222`, () => {
  it(`${AC[4]} in the live links #239 blocks #142 and #222 to #229, holds #143 through its parts, and #99's blockers hold no #222`, () => {
    const links = live();
    const failures = linkFailures(links);
    none(failures, 'the live dependency links');
    const parts = links.parts(UMBRELLA).filter((p) => p.open);
    const held = links.blockedBy(UMBRELLA).some((r) => r.number === GATE) ? ['#143 directly'] : parts.map((p) => chainTo(links, p.number)!.map((n) => `#${n}`).join(' ← '));
    console.log(`${AC[4]}: #143 held as ${held.join('; ')}; #99's blockers ${list(links.blockedBy(99))}`);
  }, 300_000);

  it(`${AC[4]} the judge fails planted link sets, each missing one link, naming the issue it leaves free`, () => {
    none(linkFailures(planted(HELD, PARTS)), 'the planted set that holds every link');
    failsNaming(linkFailures(planted({ ...HELD, 224: [417] }, PARTS)), /^#224 is not blocked by #239/, '#224 without its #239 link');
    failsNaming(linkFailures(planted({ ...HELD, 462: [417] }, PARTS)), /^#143 is not held by #239: its part #462/, "#143's part #462 free of #239");
    failsNaming(linkFailures(planted({ ...HELD, 462: [GATE] }, PARTS, [462])), /^#143 is not held by #239: its part #463/, "#143's part #463 waiting only on a closed part");
    failsNaming(linkFailures(planted(HELD, {})), /^#143 is not blocked by #239 and has no open part/, '#143 with no parts');
    failsNaming(linkFailures(planted({ ...HELD, 99: [222, 403] }, PARTS)), /^#99 still depends on #222/, '#99 still waiting on #222');
  });
});
