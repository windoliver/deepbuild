// The review passes that found bugs after a close, on a real hub (#2748; the passes are #87's). A repo's passes are
// kept in your wiki, beside the review's rubric (`<root>/wiki/review-passes.md`): each with its ID, name, prompt,
// scope and the PRs and bug sites behind it. The hub reads them there for each claim and puts them in the run's
// request, never from a file in the checkout, which the claim could change. A pass runs on a claim only when its
// scope covers a path the claim changed, and one with no scope on every claim, as a rule's scope is read (#1512).
// Each run is review.pass@1 in the record: the item it sent back, and its replay on each PR the pass found bugs in,
// which a later claim reads as carried while the pass, the PR's commits and the answering model are unchanged.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PostClosePass } from '@deepbuild/checks-review';
import type { PassRan } from './checks-port.js';
import { globMatches } from './rules.js';

const PAGE = 'review-passes.md';

/**
 * The passes a page holds: `## <id>: <name>` opens one; under it `- prompt: <text>`, `- scope: <pattern>[, <pattern>]`
 * and one `- found: PR <n>, <base>..<head>: <file>:<line>[, <file>:<line>]` per PR it found bugs in, the two commits
 * full SHAs. Other text is prose, and a pass with no prompt asks nothing, so it is left out.
 */
export function passesOf(page: string): PostClosePass[] {
  const passes: PostClosePass[] = [];
  let pass: PostClosePass | undefined;
  for (const line of page.split('\n')) {
    if (/^#{1,2}\s/.test(line)) {
      const opens = /^##\s+([A-Za-z0-9][\w.-]*):\s*(\S.*)$/.exec(line);
      pass = opens ? { id: opens[1]!, name: opens[2]!.trim(), prompt: '', found: [] } : undefined;
      if (pass) passes.push(pass);
      continue;
    }
    const [, field, text] = /^\s*[-*]\s+(prompt|scope|found):\s*(\S.*)$/.exec(line) ?? [];
    if (!pass || !field || !text) continue;
    if (field === 'prompt') pass.prompt = text.trim();
    else if (field === 'scope') pass.scope = text.split(',').map((s) => s.trim()).filter(Boolean);
    else {
      const [, pr, base, head, sites] = /^PR\s+#?(\d+),\s*([0-9a-f]{40})\.\.([0-9a-f]{40}):\s*(\S.*)$/.exec(text) ?? [];
      const bugs = (sites ?? '').split(',').flatMap((s) => { const at = /^\s*(\S.*):(\d+)\s*$/.exec(s); return at ? [{ file: at[1]!, line: Number(at[2]) }] : []; });
      if (Number(pr) > 0 && bugs.length) pass.found.push({ pr: Number(pr), base: base!, head: head!, bugs });
    }
  }
  return passes.filter((p) => p.prompt);
}

/** The paths a claim's worktree changed against its merge base, untracked files among them: what its snapshot's diff touches. */
function changedIn(cwd: string, base: string): Promise<string[]> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const git = (args: string[]): Promise<string[]> => new Promise((done, failed) =>
    execFile('git', ['-c', 'core.quotePath=false', ...args], { cwd, env, maxBuffer: 64 << 20 }, (error, out) => (error ? failed(error) : done(out.split('\0').filter(Boolean)))));
  return Promise.all([git(['diff', '--no-renames', '--name-only', '-z', base]), git(['ls-files', '--others', '--exclude-standard', '--full-name', '-z'])]).then((lists) => lists.flat());
}

/**
 * The wiki's passes for a claim made in `cwd` against `base`, read from the hub's root `root`: those whose scope covers
 * a path the claim changed, to run, and the IDs of the rest.
 */
export async function passesAt(root: string, plant: string | undefined, cwd: string, base: string): Promise<{ run: PostClosePass[]; out: string[] }> {
  // #2748's planted hubs: one that reads the passes from the claim's checkout, and one that runs every pass whatever its scope.
  const file = plant === 'passes-from-checkout' ? join(cwd, '.deepbuild', PAGE) : join(root, 'wiki', PAGE);
  let passes: PostClosePass[];
  try { passes = passesOf(readFileSync(file, 'utf8')); } catch { return { run: [], out: [] }; }
  if (plant === 'runs-every-pass' || !passes.some((p) => p.scope?.length)) return { run: passes, out: [] };
  // A diff that can't be read leaves no pass out: a pass is skipped only for a scope that covers none of its paths.
  const changed = await changedIn(cwd, base).catch(() => undefined);
  const run = passes.filter((p) => !changed || !p.scope?.length || p.scope.some((s) => s === 'all' || changed.some((path) => globMatches(s, path))));
  return { run, out: passes.filter((p) => !run.includes(p)).map((p) => p.id) };
}

interface ReviewPassesOptions {
  plant: string | undefined;
  raw(query: string, params?: readonly (string | number | null)[]): Promise<unknown[]>;
  appendCore(kind: string, data: Record<string, unknown>, extra?: { subject?: string }): Promise<void>;
}

/** What the record keeps of the passes' runs: review.pass@1, each with its replays. */
export class ReviewPasses {
  constructor(private readonly o: ReviewPassesOptions) {}

  /** How many of a PR's bugs a pass found on a replay an earlier run kept under `key`, answered by `model`; undefined when the record keeps none. */
  async kept(key: string, model: string): Promise<number | undefined> {
    // #2748's planted hub replays every PR on every claim.
    if (this.o.plant === 'replays-every-claim') return undefined;
    const [row] = (await this.o.raw(`SELECT json_extract(r.value, '$.found') AS found FROM events e, json_each(e.data, '$.replays') r
      WHERE e.kind = 'review.pass' AND json_extract(e.data, '$.model') = ? AND json_extract(r.value, '$.key') = ? ORDER BY e.log_pos DESC LIMIT 1`, [model, key])) as { found: number }[];
    return row ? Number(row.found) : undefined;
  }

  /** A pass's run on `claim` at `commit` counted: what it sent back and its replays, as later claims read them. */
  async ran(claim: string, commit: string, ran: PassRan): Promise<void> {
    await this.o.appendCore('review.pass', { claim, commit, ...ran }, { subject: claim });
  }
}
