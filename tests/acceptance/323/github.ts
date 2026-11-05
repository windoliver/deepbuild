// The GitHub API's recorded answers for the pull requests the sessions open (README, The recorded GitHub answers):
// the repo acme/shop, the account the session's `gh` is signed in as, each pull request over REST, and its review
// threads over GraphQL (`reviewThreads`, with `isResolved` and `resolvedBy`, as GitHub's schema has them). No request
// leaves the machine: DEEP_HUB_TEST_GITHUB names the file, and every other request answers 404.
import type { Answer } from './helpers.ts';

export const PR_URL = (n: number) => `https://github.com/acme/shop/pull/${n}`;
/** The account `gh` and the session's token are signed in as: yours, so what it does is the session's (design: the agent's word). */
export const YOU_GH = 'you-gh';
/** The reviewer, the repo's owner. */
export const REVIEWER = 'maya';

/** One review thread: its node ID, where it points, its first comment, and who resolved it (null: unresolved). */
export interface Thread { id: string; path: string; line: number; comment: { id: number; author: string; body: string }; resolvedBy: string | null }

const user = (login: string) => ({ login, id: 1000 + login.length, node_id: `U_${login}`, type: 'User', site_admin: false, html_url: `https://github.com/${login}` });

/** The recorded answers for the repo, the signed-in account, and each pull request with its review threads. */
export function prAnswers(prs: { n: number; body: string; threads: Thread[] }[]): Answer[] {
  const answers: Answer[] = [
    { path: '/repos/acme/shop', status: 200, body: { id: 77, node_id: 'R_acme_shop', name: 'shop', full_name: 'acme/shop', private: true, owner: user(REVIEWER), html_url: 'https://github.com/acme/shop', default_branch: 'main' } },
    { path: '/user', status: 200, body: user(YOU_GH) },
  ];
  for (const pr of prs) {
    answers.push({ path: `/repos/acme/shop/pulls/${pr.n}`, status: 200, body: {
      id: 9000 + pr.n, node_id: `PR_${pr.n}`, number: pr.n, state: 'open', title: 'Reject expired tokens', body: pr.body, user: user(YOU_GH), html_url: PR_URL(pr.n),
      head: { ref: 'main', sha: '0'.repeat(40) }, base: { ref: 'main' }, merged: false, draft: false, created_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-03T10:05:00Z',
    } });
    answers.push({ method: 'POST', path: '/graphql', variables: { owner: 'acme', repo: 'shop', number: pr.n }, status: 200, body: { data: { repository: { pullRequest: {
      number: pr.n, url: PR_URL(pr.n), body: pr.body,
      reviewThreads: {
        totalCount: pr.threads.length, pageInfo: { hasNextPage: false, endCursor: null },
        nodes: pr.threads.map((t) => ({
          id: t.id, isResolved: t.resolvedBy !== null, isOutdated: false, path: t.path, line: t.line,
          resolvedBy: t.resolvedBy === null ? null : { login: t.resolvedBy },
          comments: { totalCount: 1, nodes: [{ id: `PRRC_${t.comment.id}`, databaseId: t.comment.id, author: { login: t.comment.author }, body: t.comment.body, url: `${PR_URL(pr.n)}#discussion_r${t.comment.id}`, createdAt: '2026-11-03T10:10:00Z' }] },
        })),
      },
    } } } } });
  }
  return answers;
}
