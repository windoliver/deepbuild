// The forge read for the receipt (#83), against GitHub's real shapes: a head with no commit status is not "checks
// running", a release names its commit through its tag, and the next issue is found past the first page with pull
// requests left out.
import { afterEach, describe, expect, it } from 'vitest';
import { Forge, isPrCreate, parsePrUrl } from '../src/forge.js';

type Route = (url: URL) => { body: unknown; next?: string } | undefined;
const realFetch = globalThis.fetch;
const asked: string[] = [];
/** Serves `routes` as the forge, counting each path asked. */
function serve(routes: Route): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    asked.push(url.pathname + url.search);
    const hit = routes(url);
    if (!hit) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    return new Response(JSON.stringify(hit.body), { status: 200, headers: hit.next ? { link: `<${hit.next}>; rel="next"` } : {} });
  }) as typeof fetch;
}
afterEach(() => { globalThis.fetch = realFetch; asked.length = 0; });

const pr = parsePrUrl('https://github.com/acme/widgets/pull/7')!;
const api = 'https://api.test';
const SHA = 'a'.repeat(40);
const MERGE = 'b'.repeat(40);

describe('Forge.pull', () => {
  it('a head whose check runs completed and that has no commit status at all is open, not checks running', async () => {
    serve((u) => {
      if (u.pathname.endsWith('/pulls/7')) return { body: { merged: false, body: 'Closes #83', head: { sha: SHA } } };
      if (u.pathname.endsWith('/check-runs')) return { body: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] } };
      if (u.pathname.endsWith('/status')) return { body: { state: 'pending', total_count: 0, statuses: [] } };
      return undefined;
    });
    expect(await new Forge(api, undefined).pull(pr)).toEqual({ state: 'open', closes: 83 });
  });
  it('a commit status still pending is checks running', async () => {
    serve((u) => {
      if (u.pathname.endsWith('/pulls/7')) return { body: { merged: false, body: '', head: { sha: SHA } } };
      if (u.pathname.endsWith('/check-runs')) return { body: { total_count: 0, check_runs: [] } };
      if (u.pathname.endsWith('/status')) return { body: { state: 'pending', total_count: 1, statuses: [{ state: 'pending', context: 'ci' }] } };
      return undefined;
    });
    expect((await new Forge(api, undefined).pull(pr))?.state).toBe('checks running');
  });
  it('a merged PR is released when a release\'s tag, an annotated one with a slash, names the merge commit, though its target is a branch; a release older than the merge is not read', async () => {
    serve((u) => {
      if (u.pathname.endsWith('/pulls/7')) return { body: { merged: true, body: '', merge_commit_sha: MERGE, merged_at: '2026-10-20T00:00:00Z' } };
      if (u.pathname.endsWith('/releases')) return { body: [{ tag_name: 'untagged-draft', draft: true, target_commitish: 'main', published_at: null }, { tag_name: 'gone', target_commitish: 'main', published_at: '2026-10-22T00:00:00Z' }, { tag_name: 'release/1.2.0', target_commitish: 'main', published_at: '2026-10-21T00:00:00Z' }, { tag_name: 'v1.1.0', target_commitish: 'main', published_at: '2026-10-01T00:00:00Z' }] };
      if (u.pathname.endsWith('/git/ref/tags/release/1.2.0')) return { body: { object: { type: 'tag', sha: 'c'.repeat(40) } } };
      if (u.pathname.endsWith(`/git/tags/${'c'.repeat(40)}`)) return { body: { object: { type: 'commit', sha: MERGE } } };
      return undefined;
    });
    expect((await new Forge(api, undefined).pull(pr))?.state).toBe('released');
    expect(asked.some((p) => p.includes('/git/ref/tags/v1.1.0') || p.includes('untagged-draft'))).toBe(false);
    expect(asked.some((p) => p.includes('/git/ref/tags/gone'))).toBe(true);
  });
  it('a merged PR no release\'s tag reaches is merged', async () => {
    serve((u) => {
      if (u.pathname.endsWith('/pulls/7')) return { body: { merged: true, body: '', merge_commit_sha: MERGE } };
      if (u.pathname.endsWith('/releases')) return { body: [{ tag_name: 'v1.1.0', target_commitish: 'main' }] };
      if (u.pathname.endsWith('/git/ref/tags/v1.1.0')) return { body: { object: { type: 'commit', sha: 'd'.repeat(40) } } };
      return undefined;
    });
    expect((await new Forge(api, undefined).pull(pr))?.state).toBe('merged');
  });
  it('a forge that answers 401 leaves the state unknown (undefined), and the token goes only as a bearer', async () => {
    let auth: string | undefined;
    globalThis.fetch = (async (_: unknown, init?: RequestInit) => { auth = (init?.headers as Record<string, string>).authorization; return new Response('{}', { status: 401 }); }) as typeof fetch;
    expect(await new Forge(api, 'tok').pull(pr)).toBeUndefined();
    expect(auth).toBe('Bearer tok');
  });
});

describe('isPrCreate', () => {
  it('is one gh pr create command, its quoted title and a heredoc body included, in a substitution or bare', () => {
    for (const c of ['gh pr create --title "x" --body "y"', `gh pr create --title "Fix: a & b | c" --body "$(cat <<'EOF'\n## Summary\n- one; two && three\n\nCloses #83\nEOF\n)"`, `gh pr create --body "$(cat <<"EOF"\nit's | done\nEOF\n)"`, `gh pr create --body "$(cat <<-EOF\n\tx;\n\tEOF\n)"`, `gh pr create --body "$( cat <<'EOF' \nnot the end: EOF )\nEOF\n )"\n`, `gh pr create --title t --body-file - <<'EOF'\n## Summary\n; echo https://github.com/acme/widgets/pull/9\nEOF`, "gh pr create --fill --body 'a; b'", 'gh pr create --title "it\'s \\"quoted\\" (and more)" --body \'say "hi"\'', 'gh pr create --fill 2>&1', 'gh pr create --fill &>/tmp/log', 'gh pr create --fill >&2']) expect(isPrCreate(c), c).toBe(true);
  });
  it('is not a second command joined to it, or another command, however the quotes or heredocs around the join mix', () => {
    for (const c of ['gh pr create --help; echo https://github.com/acme/widgets/pull/7', 'gh pr create --fill && echo done', 'gh pr create --fill & echo done', 'gh pr create --fill | cat', 'gh pr create --body "$(echo x)"', 'gh pr create --body "`echo x`"', 'gh pr create\necho x', 'echo gh pr create', 'gh pr view 7', `gh pr create --title 'a"' ; echo https://github.com/acme/widgets/pull/9 --body '"b'`, 'gh pr create --title "a\\"; echo x', 'gh pr create --title "unterminated', 'gh pr create --title t --body-file >(echo https://github.com/acme/widgets/pull/9)', 'gh pr create --body "$(cat <<EOF\n\tx\n\tEOF\n)"', `gh pr create --body "$(cat <<'EOF'\nx\nEOF\n) " ; echo "$(cat <<'EOF'\nhttps://github.com/acme/widgets/pull/9\nEOF\n)"`, `gh pr create --body-file - <<'EOF'\nx\nEOF\necho https://github.com/acme/widgets/pull/9`, `gh pr create --body "$(cat <<'EOF'\nnever ends\n)"`]) expect(isPrCreate(c), c).toBe(false);
  });
});

describe('Forge.nextIssue', () => {
  const epic = (n: number, deps: number[] = []) => ({ number: n, state: 'open', html_url: `https://github.com/acme/widgets/issues/${n}`, body: `**Epic:** #1\n\n### Depends on\n${deps.map((d) => `- #${d}`).join('\n')}\n` });
  it('finds the lowest unblocked sibling past the first page, skipping pull requests and a sibling whose dependency is still open, reading a closed dependency by number', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ number: 900 - i, state: 'open', body: '', html_url: '' }));
    serve((u) => {
      if (u.pathname.endsWith('/issues/83')) return { body: { number: 83, state: 'closed', body: '**Epic:** #1', html_url: '' } };
      if (u.pathname.endsWith('/issues/40')) return { body: { number: 40, state: 'closed', body: '', html_url: '' } };
      if (u.pathname.endsWith('/issues') && u.searchParams.get('page') === '2') {
        return { body: [{ ...epic(20), pull_request: { url: 'x' } }, epic(25, [83, 40]), epic(28, [27]), epic(27, [83]), { number: 29, state: 'open', body: '', html_url: '' }] };
      }
      if (u.pathname.endsWith('/issues')) return { body: page1, next: `${api}/repos/acme/widgets/issues?state=open&per_page=100&page=2` };
      return undefined;
    });
    expect(await new Forge(api, undefined).nextIssue(pr, 83)).toEqual({ number: 25, url: 'https://github.com/acme/widgets/issues/25' });
    expect(asked.filter((p) => p.includes('/issues/')).sort()).toEqual(['/repos/acme/widgets/issues/40', '/repos/acme/widgets/issues/83']);
  });
  it('a sibling whose dependency the forge no longer shows (404) is blocked, and the next sibling is tried', async () => {
    serve((u) => {
      if (u.pathname.endsWith('/issues/83')) return { body: { number: 83, state: 'closed', body: '**Epic:** #1', html_url: '' } };
      if (u.pathname.endsWith('/issues/40')) return undefined;
      if (u.pathname.endsWith('/issues')) return { body: [epic(25, [40]), epic(28)] };
      return undefined;
    });
    expect(await new Forge(api, undefined).nextIssue(pr, 83)).toEqual({ number: 28, url: 'https://github.com/acme/widgets/issues/28' });
  });
  it('an issue with no epic has no next issue', async () => {
    serve((u) => (u.pathname.endsWith('/issues/83') ? { body: { number: 83, state: 'closed', body: 'no epic here', html_url: '' } } : undefined));
    expect(await new Forge(api, undefined).nextIssue(pr, 83)).toBeNull();
    expect(asked).toHaveLength(1);
  });
});
