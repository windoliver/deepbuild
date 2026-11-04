// How each sent-back item ended (#87): fixed, by the first later commit on the claim that changes a line one of its
// sites cites, followed through every commit since; or left, decided by the commit the claim settled on.
import { diffOf, follow, git, hunks } from './diff.js';
import type { ItemOutcome, SentBack } from './types.js';

export async function itemOutcomes(checkout: string, sent: SentBack[], settled: string): Promise<ItemOutcome[]> {
  const changes = new Map<string, ReturnType<typeof hunks>>();
  const changesOf = (commit: string): ReturnType<typeof hunks> => {
    if (!changes.has(commit)) changes.set(commit, hunks(diffOf(checkout, `${commit}^`, commit, 0)));
    return changes.get(commit)!;
  };
  return sent.flatMap((round) => {
    const later = git(checkout, ['rev-list', '--reverse', '--first-parent', `${round.commit}..${settled}`]).split('\n').filter(Boolean);
    return round.items.map((item): ItemOutcome => {
      let sites = item.sites.map((s) => ({ file: s.file, line: s.line as number | null }));
      for (const commit of later) {
        const hs = changesOf(commit);
        const next = sites.map((s) => ({ file: s.file, line: s.line === null ? null : follow(s.file, s.line, hs) }));
        if (next.some((s, i) => sites[i]!.line !== null && s.line === null)) return { rule: item.rule, sites: item.sites, ended: 'fixed', commit };
        sites = next;
      }
      return { rule: item.rule, sites: item.sites, ended: 'left', commit: settled };
    });
  });
}
