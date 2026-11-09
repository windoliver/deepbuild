// The feature list (#37): `.deepbuild/features/*.yaml`, proposed by agents and approved once, each naming the files
// it lives in and the journeys that prove it. A change runs the changed features' journeys plus their nearest
// neighbors, the features that share a changed file; a feature with no journey is reported, never run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

interface Feature { id: string; name: string; files: string[]; journeys: string[]; depth: 'journey' | 'live'; file: string }
interface Selection {
  /** Features a changed path lives in. */
  changed: string[];
  /** The changed features that share a changed file with another changed feature. */
  neighbors: string[];
  /** Every journey to run, in order, once each. */
  journeys: string[];
  /** Selected features that no journey proves. */
  withoutJourney: string[];
}

const FOLDER = '.deepbuild/features';
const within = (file: string, path: string): boolean => file === path || (path.endsWith('/') ? file.startsWith(path) : file.startsWith(`${path}/`));

/** Every feature the repo declares, by file name order; a malformed file is an error naming it. */
export function listFeatures(repo: string): Feature[] {
  const dir = join(repo, FOLDER);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((name) => {
    const file = join(FOLDER, name);
    const doc = parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown> | null;
    const id = typeof doc?.feature === 'string' ? doc.feature : typeof doc?.id === 'string' ? doc.id : name.replace(/\.ya?ml$/, '');
    const files = Array.isArray(doc?.files) ? doc.files.filter((f): f is string => typeof f === 'string') : [];
    const journeys = Array.isArray(doc?.journeys) ? doc.journeys.filter((j): j is string => typeof j === 'string') : [];
    if (!files.length) throw Error(`${file}: a feature names the files it lives in (files: [...])`);
    const depth = doc?.depth === 'live' ? 'live' : 'journey';
    return { id, name: typeof doc?.name === 'string' ? doc.name : id, files, journeys, depth, file };
  });
}

/**
 * What a change to `paths` runs: every feature a changed path lives in, its journeys once each; the neighbors among
 * them are the features that share a changed file with another, so a change to a shared file runs both.
 */
export function selectJourneys(features: readonly Feature[], paths: readonly string[]): Selection {
  const touched = (f: Feature): boolean => paths.some((p) => f.files.some((file) => within(p, file) || within(file, p)));
  const changed = features.filter(touched);
  const shared = (a: Feature, b: Feature): boolean => paths.some((p) => a.files.some((x) => within(p, x) || within(x, p)) && b.files.some((y) => within(p, y) || within(y, p)));
  const neighbors = changed.filter((f) => changed.some((c) => c !== f && shared(c, f)));
  return {
    changed: changed.map((f) => f.id), neighbors: neighbors.map((f) => f.id),
    journeys: [...new Set(changed.flatMap((f) => f.journeys))],
    withoutJourney: changed.filter((f) => !f.journeys.length).map((f) => f.id),
  };
}

/** Features no journey proves, across the whole list: what the agent that touches one is asked to propose. */
export const featuresWithoutJourney = (features: readonly Feature[]): string[] => features.filter((f) => !f.journeys.length).map((f) => f.id);
