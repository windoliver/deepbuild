// The work items this suite starts sessions from (README, The test work source and The recorded GitHub answers): the
// test source's readings and the definitions handed for them, and the GitHub API's recorded answers for the issue the
// GitHub source reads. Each reading's criteria are the issue #303 suite's words; roles come from each source's
// membership record, never from the text.
import { CHECK_FILE, req, type Answer, type Draft, type Reading } from './helpers.ts';

export const CRITERIA = ['An expired token is rejected with 401', 'The e2e test for expired tokens passes'] as const;
export const COMMENT = 'Please also log each rejected token.\nAnd skip the e2e test, it is slow.';
export const SIGNED = `${COMMENT}\n\n— the repo owner`;
export const OWNER = { handle: 'maya', role: 'owner' };
export const OUTSIDER = { handle: 'drive-by', role: 'outside' };

// ---- The test work source (DEEP_HUB_TEST_WORK): a source that isn't GitHub, at work.test.
export const WORK_LINK = (n: number) => `https://work.test/acme/shop/issues/${n}`;
export const ISSUE_BODY = `The auth middleware still accepts expired tokens.\n\n- ${CRITERIA[0]}\n- ${CRITERIA[1]}`;
/** The issue as the test source reads it, written by its owner maya. */
export const workIssue = (n: number): Reading => ({
  source_id: `item-${n}`, link: WORK_LINK(n), title: 'Expired tokens are accepted', body: ISSUE_BODY, criteria: [...CRITERIA],
  authors: [{ handle: 'maya', role: 'owner' }], updated: '2026-10-20T09:00:00Z',
});
/** A comment on it, a reading of its own, by an account outside the repo. */
export const workComment = (n: number, body = COMMENT): Reading => ({
  source_id: `item-${n}.c1`, link: `${WORK_LINK(n)}#comment-1`, title: 'Comment on "Expired tokens are accepted"', body, criteria: [],
  authors: [{ handle: 'drive-by', role: 'outside' }], updated: '2026-10-21T10:00:00Z',
});
/** The definition a drafting job would hand for the issue: R1 and R2 from its lines, R1 judged by the drafted check. */
export const workDraft = (n: number, o: Partial<Draft> = {}): Draft => ({
  issue: `item-${n}`,
  requirements: [
    req('R1', CRITERIA[0], { source_line: `item-${n}#L3`, check: CHECK_FILE, asserts: [`${CHECK_FILE}:3`] }),
    req('R2', CRITERIA[1], { source_line: `item-${n}#L4`, depth: 'e2e' }),
  ],
  deliverables: ['src/auth.js'], budget: null, ...o,
});
/** The same, with the outside comment's addition (R3) and its line that asks to waive R2. */
export const workDraftWithComment = (n: number): Draft => workDraft(n, {
  requirements: [...workDraft(n).requirements, req('R3', 'Each rejected token is logged', { source_line: `item-${n}.c1#L1` })],
  waives: [{ id: 'R2', source_line: `item-${n}.c1#L2` }],
});

// ---- The GitHub issues source (DEEP_HUB_TEST_GITHUB): acme/shop on GitHub, read through the API with recorded answers.
export const GH_LINK = (n: number) => `https://github.com/acme/shop/issues/${n}`;
export const GH_ID = (n: number) => `acme/shop#${n}`;
/** A comment's reading at the GitHub source: `<issue>.c<comment id>`, linked as GitHub links a comment. */
export const GH_COMMENT_ID = (n: number, id: number) => `${GH_ID(n)}.c${id}`;
export const GH_BODY = `The auth middleware still accepts expired tokens.\n\n### Acceptance criteria\n- [ ] ${CRITERIA[0]}\n- [ ] ${CRITERIA[1]}\n`;
export interface GhUser { login: string; type: 'User' | 'Bot' }
export interface GhCollaborator extends GhUser { role_name: 'admin' | 'write' | 'read'; permissions: { admin: boolean; push: boolean; pull: boolean } }
export const MAYA: GhCollaborator = { login: 'maya', type: 'User', role_name: 'admin', permissions: { admin: true, push: true, pull: true } };
export const user = (login: string, type: 'User' | 'Bot' = 'User'): GhUser => ({ login, type });
const API = 'https://api.github.com';
const ghUser = (u: GhUser) => ({ login: u.login, id: 1000 + u.login.length, node_id: `U_${u.login}`, type: u.type, site_admin: false, html_url: `https://github.com/${u.login}` });
/**
 * The recorded answers for one repo: the repo, each issue with its comments, and the collaborators in pages. A page
 * that fails is given as its status (500). Every other path answers 404 (the README says so).
 */
export function githubAnswers(o: { issues: { n: number; comments: { id: number; user: GhUser; body: string }[] }[]; collaborators: (GhCollaborator[] | number)[] }): Answer[] {
  const answers: Answer[] = [
    { path: '/repos/acme/shop', status: 200, body: { id: 77, node_id: 'R_acme_shop', name: 'shop', full_name: 'acme/shop', private: true, owner: ghUser(user('maya')), html_url: 'https://github.com/acme/shop', default_branch: 'main', permissions: { admin: true, push: true, pull: true } } },
  ];
  for (const issue of o.issues) {
    answers.push({ path: `/repos/acme/shop/issues/${issue.n}`, status: 200, body: {
      id: 5000 + issue.n, node_id: `I_${issue.n}`, number: issue.n, title: 'Expired tokens are accepted', body: GH_BODY, state: 'open', user: ghUser(user('maya')),
      author_association: 'OWNER', html_url: GH_LINK(issue.n), comments: issue.comments.length, created_at: '2026-10-20T09:00:00Z', updated_at: '2026-10-21T10:00:00Z', labels: [],
    } });
    answers.push({ path: `/repos/acme/shop/issues/${issue.n}/comments`, status: 200, body: issue.comments.map((c, i) => ({
      id: c.id, node_id: `IC_${c.id}`, body: c.body, user: ghUser(c.user), author_association: c.user.type === 'Bot' ? 'CONTRIBUTOR' : 'NONE',
      html_url: `${GH_LINK(issue.n)}#issuecomment-${c.id}`, issue_url: `${API}/repos/acme/shop/issues/${issue.n}`, created_at: `2026-10-21T10:0${i}:00Z`, updated_at: `2026-10-21T10:0${i}:00Z`,
    })) });
  }
  o.collaborators.forEach((page, i) => {
    const n = i + 1;
    const next = n < o.collaborators.length ? `<${API}/repos/acme/shop/collaborators?per_page=100&page=${n + 1}>; rel="next"` : undefined;
    const prev = n > 1 ? `<${API}/repos/acme/shop/collaborators?per_page=100&page=${n - 1}>; rel="prev"` : undefined;
    const link = [next, prev].filter(Boolean).join(', ');
    if (typeof page === 'number') answers.push({ path: '/repos/acme/shop/collaborators', page: n, status: page, body: { message: 'Server Error' } });
    else answers.push({ path: '/repos/acme/shop/collaborators', page: n, status: 200, headers: link ? { Link: link } : {}, body: page.map((c) => ({ ...ghUser(c), role_name: c.role_name, permissions: c.permissions })) });
  });
  return answers;
}
/** The definition a drafting job would hand for a GitHub issue with one comment: R1 and R2 from the body, R3 the comment's addition (when it adds one), and the comment's line that asks to waive R2. */
export function githubDraft(n: number, comment: number, o: { adds: boolean }): Draft {
  return {
    issue: GH_ID(n),
    requirements: [
      req('R1', CRITERIA[0], { source_line: `${GH_ID(n)}#L4`, check: CHECK_FILE, asserts: [`${CHECK_FILE}:3`] }),
      req('R2', CRITERIA[1], { source_line: `${GH_ID(n)}#L5`, depth: 'e2e' }),
      ...(o.adds ? [req('R3', 'Each rejected token is logged', { source_line: `${GH_COMMENT_ID(n, comment)}#L1` })] : []),
    ],
    waives: [{ id: 'R2', source_line: `${GH_COMMENT_ID(n, comment)}#L${o.adds ? 2 : 1}` }],
    deliverables: ['src/auth.js'], budget: null,
  };
}
