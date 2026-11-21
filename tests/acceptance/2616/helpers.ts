// #2616's recorded forge: GitHub's REST answers, in the forge's own shapes, for one open pull request (acme/widgets#7),
// its head's check runs paged as the forge pages them, and the head's commit status, served on 127.0.0.1. It logs
// every request it gets; one the recording doesn't name is answered 404 and marked, so a test can name it.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Forge, parsePrUrl } from '../../../packages/hub/src/forge.ts';

/** The pull request every test reads, by its web URL, as the receipt has it. */
export const PR_URL = 'https://github.com/acme/widgets/pull/7';
const OWNER = 'acme';
const REPO = 'widgets';
const NUMBER = 7;
/** The repository's ID: GitHub's Link header names a later page as `/repositories/<id>/…`, not `/repos/<owner>/<name>/…`. */
const REPO_ID = 4242;
/** Runs on a page: GitHub's page when the request names no size, as the issue gives it (30), whatever size is asked. */
const PAGE = 30;
/**
 * How long the reader may spend on the recorded forge in all. The receipt's own budget is the base's `BUDGET_MS`
 * (5 s); no criterion names a time, so the tests give a minute, and a loaded machine can't cut a read short.
 */
const BUDGET_MS = 60_000;
const sha = (seed: string): string => createHash('sha1').update(`#2616 ${seed}`).digest('hex');
const BASE_SHA = sha('base');
const MERGE_SHA = sha('test merge');
const WORKFLOW_RUN = 19_261_600_001;
const SUITE = 50_261_600_001;

export interface Run { id: number; name: string; status: 'queued' | 'in_progress' | 'completed'; conclusion: 'success' | null }
export interface Head { sha: string; runs: Run[]; unfinished: Run | undefined }

const range = (n: number, name: (i: number) => string): string[] => Array.from({ length: n }, (_, i) => name(i + 1));
/** 45 runs: lint, typecheck, build, 24 unit shards, 16 end-to-end shards, docs and package. */
const FORTY_FIVE = ['lint', 'typecheck', 'build', ...range(24, (i) => `unit (shard ${i} of 24)`), ...range(16, (i) => `e2e (shard ${i} of 16)`), 'docs', 'package'];
/** 12 runs: lint, typecheck, build, 8 unit shards and e2e. */
const TWELVE = ['lint', 'typecheck', 'build', ...range(8, (i) => `unit (shard ${i} of 8)`), 'e2e'];

function head(seed: string, names: string[], firstId: number, unfinished?: { at: number; status: 'queued' | 'in_progress' }): Head {
  const runs = names.map((name, i): Run => (unfinished?.at === i
    ? { id: firstId + i, name, status: unfinished.status, conclusion: null }
    : { id: firstId + i, name, status: 'completed', conclusion: 'success' }));
  return { sha: sha(seed), runs, unfinished: unfinished ? runs[unfinished.at] : undefined };
}
/**
 * The head of 45 check runs, 30 on page 1 and 15 on page 2: with `unfinished`, its 38th run, `e2e (shard 11 of 16)`,
 * on page 2, is in progress and every other run completed; without, every run completed.
 */
export const fortyFive = (unfinished: boolean): Head =>
  head('head of 45 check runs', FORTY_FIVE, 41_261_600_001, unfinished ? { at: 37, status: 'in_progress' } : undefined);
/** The head of 12 check runs, one page: its 8th run, `unit (shard 5 of 8)`, is queued and the other 11 completed. */
export const twelve = (): Head => head('head of 12 check runs', TWELVE, 42_261_600_001, { at: 7, status: 'queued' });

/** A run as a failure names it: its name, ID and status, and the page the recorded forge holds it on. */
export function label(h: Head, run: Run): string {
  const at = h.runs.indexOf(run);
  return `"${run.name}" (check run ${run.id}, ${run.status}), run ${at + 1} of ${h.runs.length}, on page ${Math.floor(at / PAGE) + 1} of ${Math.ceil(h.runs.length / PAGE)}`;
}

/** One request the recorded forge got: its method and target, whether the recording names it, and whether it asks for check runs. */
export interface Asked { request: string; named: boolean; checkRuns: boolean }
export interface RecordedForge { api: string; asked: Asked[]; close(): Promise<void> }

/** Every request the recorded forge got, one a line, each it didn't name marked. */
export const requests = (asked: Asked[]): string =>
  asked.map((a) => `  ${a.request}${a.named ? '' : '  (not in the recording: answered 404)'}`).join('\n') || '  nothing';

/**
 * Serves `h` as the forge, on 127.0.0.1, until `close`. The recording names:
 * - `GET /repos/acme/widgets/pulls/7`: the pull request, open, its head `h.sha`;
 * - `GET /repos/acme/widgets/commits/<head>/check-runs`, with any query but a page other than 1: page 1 of the head's
 *   runs, `total_count` the head's whole count, 30 runs a page whatever page size is asked;
 * - each later page at the URL the page before it names in its `Link` header (`rel="next"`, and `rel="last"`), in
 *   GitHub's form `<origin>/repositories/4242/commits/<head>/check-runs?page=<n>`, with that query alone; page 1 also
 *   there, as later pages name it (`rel="prev"`, `rel="first"`);
 * - `GET /repos/acme/widgets/commits/<head>/status`, any query: the combined status of a head with no status at all,
 *   as GitHub gives it (`state: pending`, `total_count: 0`, `statuses: []`).
 * Anything else is answered 404 with GitHub's Not Found body.
 */
export async function recordedForge(h: Head): Promise<RecordedForge> {
  const asked: Asked[] = [];
  const pages: Run[][] = [];
  for (let i = 0; i < h.runs.length; i += PAGE) pages.push(h.runs.slice(i, i + PAGE));
  let origin = '';
  const repo = `/repos/${OWNER}/${REPO}`;
  const later = `/repositories/${REPO_ID}/commits/${h.sha}/check-runs`;
  const pageUrl = (n: number): string => `${origin}${later}?page=${n}`;
  const links = (n: number): string | undefined => {
    const rels = [
      ...(n > 1 ? [`<${pageUrl(n - 1)}>; rel="prev"`] : []),
      ...(n < pages.length ? [`<${pageUrl(n + 1)}>; rel="next"`, `<${pageUrl(pages.length)}>; rel="last"`] : []),
      ...(n > 1 ? [`<${pageUrl(1)}>; rel="first"`] : []),
    ];
    return rels.length ? rels.join(', ') : undefined;
  };
  const run = (r: Run): Record<string, unknown> => {
    const job = `https://github.com/${OWNER}/${REPO}/actions/runs/${WORKFLOW_RUN}/job/${r.id}`;
    return {
      id: r.id, name: r.name, head_sha: h.sha, external_id: '', url: `${origin}${repo}/check-runs/${r.id}`, html_url: job, details_url: job,
      status: r.status, conclusion: r.conclusion, started_at: '2026-11-20T09:00:00Z',
      completed_at: r.status === 'completed' ? '2026-11-20T09:06:00Z' : null,
      output: { title: null, summary: null, text: null, annotations_count: 0, annotations_url: `${origin}${repo}/check-runs/${r.id}/annotations` },
      check_suite: { id: SUITE }, app: { id: 15368, slug: 'github-actions', name: 'GitHub Actions' },
      pull_requests: [{ number: NUMBER, head: { ref: 'retry-upload', sha: h.sha }, base: { ref: 'main', sha: BASE_SHA } }],
    };
  };
  /** The recording's answer to a GET, or undefined when it holds none. */
  const answer = (url: URL): { body: unknown; link: string | undefined } | undefined => {
    if (url.pathname === `${repo}/pulls/${NUMBER}`) {
      return {
        body: {
          url: `${origin}${repo}/pulls/${NUMBER}`, id: 2_616_000_007, number: NUMBER, state: 'open', locked: false,
          title: 'Retry an upload the store refused', body: 'Retries an upload the store refused once.\n\nCloses #41',
          html_url: PR_URL, draft: false, merged: false, merged_at: null, merge_commit_sha: MERGE_SHA,
          head: { label: `${OWNER}:retry-upload`, ref: 'retry-upload', sha: h.sha }, base: { label: `${OWNER}:main`, ref: 'main', sha: BASE_SHA },
        },
        link: undefined,
      };
    }
    if (url.pathname === `${repo}/commits/${h.sha}/status`) {
      return {
        body: {
          state: 'pending', statuses: [], sha: h.sha, total_count: 0, repository: { id: REPO_ID, name: REPO, full_name: `${OWNER}/${REPO}` },
          commit_url: `${origin}${repo}/commits/${h.sha}`, url: `${origin}${repo}/commits/${h.sha}/status`,
        },
        link: undefined,
      };
    }
    let n: number | undefined;
    if (url.pathname === `${repo}/commits/${h.sha}/check-runs`) {
      const page = url.searchParams.get('page');
      n = page === null || page === '1' ? 1 : undefined;
    } else if (url.pathname === later) {
      const query = [...url.searchParams];
      const page = query.length === 1 && query[0]![0] === 'page' ? query[0]![1] : undefined;
      n = pages.findIndex((_, i) => String(i + 1) === page) + 1 || undefined;
    }
    if (n === undefined) return undefined;
    return { body: { total_count: h.runs.length, check_runs: pages[n - 1]!.map(run) }, link: links(n) };
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', origin);
    const hit = req.method === 'GET' ? answer(url) : undefined;
    asked.push({ request: `${req.method ?? '?'} ${req.url ?? ''}`, named: hit !== undefined, checkRuns: url.pathname.endsWith('/check-runs') });
    res.writeHead(hit ? 200 : 404, { 'content-type': 'application/json; charset=utf-8', ...(hit?.link ? { link: hit.link } : {}) });
    res.end(JSON.stringify(hit ? hit.body : { message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    api: origin,
    asked,
    close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
  };
}

/** The pull request's state as the receipt reads it: `Forge.pull` with the recorded forge as the REST root, no token. */
export async function stateOf(forge: RecordedForge): Promise<unknown> {
  const pr = parsePrUrl(PR_URL);
  if (!pr) throw Error(`BLOCKED: parsePrUrl reads no pull request in ${PR_URL}`);
  return (await new Forge(forge.api, undefined, BUDGET_MS).pull(pr))?.state;
}
