// The forge, read for the receipt (#83): a pull request's state (open, checks running, merged, released) and the
// next unblocked issue in an epic. Read when the receipt is read, through the forge's REST API (GitHub's shape),
// with the token given; a forge that doesn't answer within the receipt's budget leaves the state unknown, never a guess.
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** How long one receipt may spend on the forge in all, in ms. */
const BUDGET_MS = 5000;

type PrState = 'open' | 'checks running' | 'merged' | 'released';
export interface Pr { owner: string; repo: string; number: number }
/** The parts of a pull request's web URL, or undefined when it isn't one. */
export function parsePrUrl(url: string): Pr | undefined {
  const m = /^https:\/\/[^/]+\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(url);
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : undefined;
}
/** The first pull request URL in a text, such as `gh pr create`'s output. */
export function prUrlIn(text: string): string | undefined {
  return /https:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/\d+/.exec(text)?.[0];
}
/**
 * Whether a shell command is one `gh pr create` invocation and nothing else: its quoted strings and a heredoc
 * body (`--body "$(cat <<'TAG' … TAG)"`, or `--body-file - <<'TAG' … TAG`) may hold anything, but outside them
 * no `;`, `&`, `|`, backtick, newline, parenthesis or `$(` joins a second command, so an echoed URL never passes
 * for the one gh printed. Read left to right as the shell does: a quote inside the other kind of quotes never
 * hides an operator, and a heredoc ends at its terminator line alone (`<<-` lets it be indented by tabs).
 */
export function isPrCreate(command: string): boolean {
  const cmd = command.trimEnd();
  if (!/^\s*gh\s+pr\s+create\b/.test(cmd)) return false;
  const HEREDOC = /^<<(-?)[ \t]*(["']?)(\w+)\2/;
  // The end of a heredoc body that starts after the newline at `from`: the index past its terminator line.
  const bodyEnd = (from: number, tag: string, dash: boolean): number | undefined => {
    for (let at = from + 1; at <= cmd.length;) {
      const nl = cmd.indexOf('\n', at);
      const line = cmd.slice(at, nl < 0 ? cmd.length : nl);
      if ((dash ? line.replace(/^\t+/, '') : line) === tag) return nl < 0 ? cmd.length : nl + 1;
      if (nl < 0) return undefined;
      at = nl + 1;
    }
    return undefined;
  };
  let quote: '"' | "'" | undefined;
  let pending: { tag: string; dash: boolean } | undefined;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (quote === "'") { if (c === "'") quote = undefined; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '`') return false;
    if (c === '$' && cmd[i + 1] === '(') {
      // Only `$(cat <<TAG … TAG)` may run inside the command: the body ends at its terminator, then `)` must follow.
      const m = /^\$\([ \t]*cat[ \t]+<<(-?)[ \t]*(["']?)(\w+)\2[ \t]*\n/.exec(cmd.slice(i));
      if (!m) return false;
      const end = bodyEnd(i + m[0].length - 1, m[3]!, m[1] === '-');
      if (end === undefined) return false;
      const close = /^[ \t]*\)/.exec(cmd.slice(end));
      if (!close) return false;
      i = end + close[0].length - 1;
      continue;
    }
    if (quote === '"') { if (c === '"') quote = undefined; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '<' && cmd[i + 1] === '<') {
      const m = HEREDOC.exec(cmd.slice(i));
      if (!m || pending) return false;
      pending = { tag: m[3]!, dash: m[1] === '-' };
      i += m[0].length - 1;
    } else if (c === '\n') {
      // A bare heredoc's body runs to its terminator, and the command ends there: a line after it is another command.
      if (!pending) return false;
      const end = bodyEnd(i, pending.tag, pending.dash);
      if (end === undefined || end < cmd.length) return false;
      pending = undefined;
      i = end - 1;
    } else if (c === '&' && (cmd[i - 1] === '>' || cmd[i - 1] === '<' || cmd[i + 1] === '>')) continue; // a redirect (`2>&1`, `&>`)
    else if (c === ';' || c === '&' || c === '|' || c === '(' || c === ')') return false;
  }
  return quote === undefined && pending === undefined;
}
/** `Closes #n` in a PR body: the issue it closes. */
const closes = (body: string): number | undefined => { const m = /\bCloses #(\d+)/i.exec(body); return m ? Number(m[1]) : undefined; };
/** An issue's epic, `**Epic:** #n` in its body. */
const epicOf = (body: string): number | undefined => { const m = /\*\*Epic:\*\*\s*#(\d+)/.exec(body); return m ? Number(m[1]) : undefined; };
/** The issues an issue depends on: the `#n` items under its `### Depends on` heading. */
function dependsOn(body: string): number[] {
  const m = /### Depends on\s*\n([\s\S]*?)(?:\n### |\n## |$)/.exec(body);
  return m ? [...m[1]!.matchAll(/^\s*[-*]\s*#(\d+)/gm)].map((x) => Number(x[1])) : [];
}
interface Issue { number: number; state: string; body: string; url: string }
const issueOf = (i: Obj): Issue => ({ number: Number(i.number), state: String(i.state), body: typeof i.body === 'string' ? i.body : '', url: typeof i.html_url === 'string' ? i.html_url : '' });

export class Forge {
  private readonly deadline = Date.now() + BUDGET_MS;
  /** `api` is the REST root (https://api.github.com); `token` goes as a bearer when set. */
  constructor(private readonly api: string, private readonly token: string | undefined) {}
  /** One page: its body and the URL of the next page when the forge names one. */
  private async page(path: string): Promise<{ body: unknown; next: string | undefined }> {
    const left = this.deadline - Date.now();
    if (left <= 0) throw Error('the receipt\'s forge budget is spent');
    const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(path.startsWith('https://') || path.startsWith('http://') ? path : `${this.api}${path}`, { headers, signal: AbortSignal.timeout(left) });
    if (!res.ok) throw Error(`the forge answered ${res.status} for ${path}`);
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
    return { body: await res.json(), next };
  }
  private async get(path: string): Promise<unknown> { return (await this.page(path)).body; }
  /** Every item of a list the forge pages, following its `Link: rel="next"`. */
  private async all(path: string): Promise<unknown[]> {
    const items: unknown[] = [];
    for (let next: string | undefined = path; next;) {
      const p = await this.page(next);
      if (!Array.isArray(p.body)) break;
      items.push(...p.body);
      next = p.next;
    }
    return items;
  }
  /** The PR's state as the forge shows it now, with its body and the issue it closes; undefined when the forge doesn't answer. */
  async pull(pr: Pr): Promise<{ state: PrState; closes: number | undefined } | undefined> {
    let p: unknown;
    try { p = await this.get(`/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`); } catch { return undefined; }
    if (!isObj(p)) return undefined;
    const closing = closes(typeof p.body === 'string' ? p.body : '');
    if (p.merged === true) {
      const mergeSha = typeof p.merge_commit_sha === 'string' ? p.merge_commit_sha : null;
      const mergedAt = typeof p.merged_at === 'string' ? Date.parse(p.merged_at) : NaN;
      const released = await this.released(pr, mergeSha, mergedAt);
      return { state: released ? 'released' : 'merged', closes: closing };
    }
    const head = isObj(p.head) && typeof p.head.sha === 'string' ? p.head.sha : undefined;
    const running = head ? await this.checksRunning(pr, head) : false;
    return { state: running ? 'checks running' : 'open', closes: closing };
  }
  /**
   * Whether a published release on the forge targets the merge commit: by its target when that is a commit, else
   * by the commit its tag names (an annotated tag read through to its commit; a tag the forge doesn't show names
   * none). Only releases made since the merge can.
   */
  private async released(pr: Pr, mergeSha: string | null, mergedAt: number): Promise<boolean> {
    if (!mergeSha) return false;
    let releases: Obj[];
    try {
      releases = (await this.get(`/repos/${pr.owner}/${pr.repo}/releases`) as unknown[]).filter(isObj)
        .filter((r) => r.draft !== true && (typeof r.published_at !== 'string' || Number.isNaN(mergedAt) || Date.parse(r.published_at) >= mergedAt));
    } catch { return false; }
    if (releases.some((r) => r.target_commitish === mergeSha)) return true;
    for (const r of releases) {
      if (typeof r.tag_name !== 'string') continue;
      try {
        // A tag's slashes stay as GitHub reads refs; the rest is escaped.
        let ref = await this.get(`/repos/${pr.owner}/${pr.repo}/git/ref/tags/${r.tag_name.split('/').map(encodeURIComponent).join('/')}`);
        let object = isObj(ref) && isObj(ref.object) ? ref.object : undefined;
        if (object?.type === 'tag' && typeof object.sha === 'string') {
          ref = await this.get(`/repos/${pr.owner}/${pr.repo}/git/tags/${object.sha}`);
          object = isObj(ref) && isObj(ref.object) ? ref.object : undefined;
        }
        if (object?.sha === mergeSha) return true;
      } catch (e) { if (!/answered 404/.test(String(e))) return false; }
    }
    return false;
  }
  /** Whether the head's check runs, or a commit status it has, are still pending: a head with no status at all is not pending. */
  private async checksRunning(pr: Pr, head: string): Promise<boolean> {
    try {
      const checks = await this.get(`/repos/${pr.owner}/${pr.repo}/commits/${head}/check-runs`);
      const runs = isObj(checks) && Array.isArray(checks.check_runs) ? checks.check_runs : [];
      if (runs.some((r) => isObj(r) && r.status !== 'completed')) return true;
      const status = await this.get(`/repos/${pr.owner}/${pr.repo}/commits/${head}/status`);
      return isObj(status) && status.state === 'pending' && Array.isArray(status.statuses) && status.statuses.length > 0;
    } catch { return false; }
  }
  /**
   * The repo's most recently closed pull requests that merged, for the readings' lifecycle numbers (#45), as far as the
   * budget reaches; undefined when the forge doesn't answer the list at all.
   */
  async merged(owner: string, repo: string): Promise<{ number: number; merged_at: number; opened_at: number; issue_opened_at: number | null; reviews: { at: number; state: string }[] }[] | undefined> {
    const root = `/repos/${owner}/${repo}`;
    let list: unknown;
    try { list = await this.get(`${root}/pulls?state=closed&sort=updated&direction=desc&per_page=30`); } catch { return undefined; }
    if (!Array.isArray(list)) return undefined;
    const out = [];
    for (const p of list.filter(isObj)) {
      if (typeof p.merged_at !== 'string' || typeof p.created_at !== 'string') continue;
      try {
        // A review by the pull request's own author isn't anyone reviewing it.
        const author = isObj(p.user) ? p.user.login : undefined;
        const reviews = (await this.get(`${root}/pulls/${String(p.number)}/reviews`) as unknown[]).filter(isObj).filter((r) => typeof r.submitted_at === 'string' && !(isObj(r.user) && r.user.login === author));
        const closing = closes(typeof p.body === 'string' ? p.body : '');
        const issue = closing === undefined ? undefined : await this.get(`${root}/issues/${closing}`);
        out.push({
          number: Number(p.number), merged_at: Date.parse(p.merged_at), opened_at: Date.parse(p.created_at),
          issue_opened_at: isObj(issue) && typeof issue.created_at === 'string' ? Date.parse(issue.created_at) : null,
          reviews: reviews.map((r) => ({ at: Date.parse(String(r.submitted_at)), state: String(r.state) })),
        });
      } catch { break; }
    }
    return out;
  }
  /**
   * The next unblocked issue in `issue`'s epic once it passed: the lowest-numbered open issue of the same epic,
   * other than `issue`, whose every dependency is closed or is `issue`; null when there is none, or the forge
   * doesn't answer. Reads the issue, every open issue (pull requests left out), and each dependency not among them.
   */
  async nextIssue(pr: Pr, issue: number): Promise<{ number: number; url: string } | null> {
    const repo = `/repos/${pr.owner}/${pr.repo}`;
    try {
      const own = await this.get(`${repo}/issues/${issue}`);
      const epic = isObj(own) ? epicOf(issueOf(own).body) : undefined;
      if (epic === undefined) return null;
      const open = (await this.all(`${repo}/issues?state=open&per_page=100`)).filter(isObj).filter((i) => !('pull_request' in i)).map(issueOf);
      const known = new Map(open.map((i) => [i.number, i]));
      // A dependency the forge doesn't show (deleted, moved) is not closed: it blocks, and the next sibling is tried.
      const stateOf = async (n: number): Promise<string> => {
        if (n === issue) return 'closed';
        const seen = known.get(n);
        if (seen) return seen.state;
        const got = await this.get(`${repo}/issues/${n}`).catch((e: unknown) => { if (!/answered 404/.test(String(e))) throw e; return undefined; });
        const i = isObj(got) ? issueOf(got) : { number: n, state: 'unknown', body: '', url: '' };
        known.set(n, i);
        return i.state;
      };
      for (const i of open.filter((o) => o.number !== issue && epicOf(o.body) === epic).sort((a, b) => a.number - b.number)) {
        let unblocked = true;
        for (const d of dependsOn(i.body)) if (await stateOf(d) !== 'closed') { unblocked = false; break; }
        if (unblocked) return { number: i.number, url: i.url };
      }
      return null;
    } catch { return null; }
  }
}
