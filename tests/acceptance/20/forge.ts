// A fake forge: GitHub's REST API for Actions runs, served on 127.0.0.1, with a retention the test controls. The
// forge is the one boundary of #20 the project doesn't own, so it is the only thing mocked (AGENTS.md, Proof). It
// serves what GitHub documents for these routes (docs.github.com/rest/actions): the runs list, a run, its jobs, a
// job, and the logs, both a job's plain-text log and a run's zip, each through a 302 to a download URL as GitHub
// does. After `expire(run)`, the run is gone: every route that names it, its jobs or their logs answers 404, and the
// list no longer holds it. The archive may use either log route.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32 } from 'node:zlib';

export interface ForgeJob { id: number; name: string; conclusion: 'success' | 'failure' | 'cancelled' | 'skipped'; log: string }
export interface ForgeRun {
  repo: string;               // owner/name
  id: number;
  name: string;
  conclusion: 'success' | 'failure' | 'cancelled' | 'timed_out';
  headSha: string;
  created: number;            // ms since the epoch
  jobs: ForgeJob[];
}

/** A zip of stored (uncompressed) entries, as GitHub's run-log download is a zip of one text file per job. */
function zip(entries: readonly { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10); central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += local.length + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export class FakeForge {
  readonly runs = new Map<number, ForgeRun>();
  /** Every request path the forge answered, with its status: what the archive asked. */
  readonly served: { path: string; status: number }[] = [];
  private constructor(private readonly server: Server, readonly api: string) {}

  static async start(): Promise<FakeForge> {
    let forge: FakeForge | undefined;
    const server = createServer((req, res) => forge!.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    forge = new FakeForge(server, `http://127.0.0.1:${port}`);
    return forge;
  }
  add(run: ForgeRun): void { this.runs.set(run.id, run); }
  /** The forge's retention deletes the run, its jobs and their logs. */
  expire(id: number): void { this.runs.delete(id); }
  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private runJson(r: ForgeRun) {
    const base = `${this.api}/repos/${r.repo}/actions/runs/${r.id}`;
    const at = new Date(r.created).toISOString();
    return {
      id: r.id, name: r.name, display_title: r.name, run_number: r.id % 1000, run_attempt: 1, event: 'push', status: 'completed', conclusion: r.conclusion,
      head_branch: 'main', head_sha: r.headSha, created_at: at, updated_at: at, run_started_at: at,
      url: base, html_url: `https://github.com/${r.repo}/actions/runs/${r.id}`, jobs_url: `${base}/jobs`, logs_url: `${base}/logs`,
      repository: { full_name: r.repo },
    };
  }
  private jobJson(r: ForgeRun, j: ForgeJob) {
    const at = new Date(r.created).toISOString();
    return {
      id: j.id, run_id: r.id, run_attempt: 1, name: j.name, status: 'completed', conclusion: j.conclusion, started_at: at, completed_at: at,
      url: `${this.api}/repos/${r.repo}/actions/jobs/${j.id}`, html_url: `https://github.com/${r.repo}/actions/runs/${r.id}/job/${j.id}`,
      steps: [{ name: 'Run', status: 'completed', conclusion: j.conclusion, number: 1 }],
    };
  }
  private findJob(repo: string, id: number): [ForgeRun, ForgeJob] | undefined {
    for (const r of this.runs.values()) {
      if (r.repo !== repo) continue;
      const j = r.jobs.find((job) => job.id === id);
      if (j) return [r, j];
    }
    return undefined;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', this.api);
    const send = (status: number, body: unknown, type = 'application/json; charset=utf-8', headers: Record<string, string> = {}) => {
      this.served.push({ path: url.pathname + url.search, status });
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      res.writeHead(status, { 'content-type': type, 'content-length': String(bytes.length), ...headers });
      res.end(bytes);
    };
    const notFound = () => send(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' });
    if (req.method !== 'GET') return notFound();
    const p = url.pathname;
    let m: RegExpExecArray | null;
    if ((m = /^\/_download\/jobs\/(\d+)$/.exec(p))) {
      for (const r of this.runs.values()) {
        const j = r.jobs.find((job) => job.id === Number(m![1]));
        if (j) return send(200, j.log, 'text/plain; charset=utf-8');
      }
      return notFound();
    }
    if ((m = /^\/_download\/runs\/(\d+)\.zip$/.exec(p))) {
      const r = this.runs.get(Number(m[1]));
      if (!r) return notFound();
      return send(200, zip(r.jobs.map((j, i) => ({ name: `${i}_${j.name}.txt`, data: Buffer.from(j.log, 'utf8') }))), 'application/zip');
    }
    if (!(m = /^\/repos\/([^/]+\/[^/]+)\/actions\/(.*)$/.exec(p))) return notFound();
    const repo = m[1]!;
    const rest = m[2]!;
    if (rest === 'runs') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const status = url.searchParams.get('status');
      const all = [...this.runs.values()].filter((r) => r.repo === repo && (!status || status === 'completed' || status === r.conclusion)).sort((a, b) => b.created - a.created);
      return send(200, { total_count: all.length, workflow_runs: page === 1 ? all.map((r) => this.runJson(r)) : [] });
    }
    if ((m = /^runs\/(\d+)(?:\/attempts\/1)?(\/jobs|\/logs)?$/.exec(rest))) {
      const r = this.runs.get(Number(m[1]));
      if (!r || r.repo !== repo) return notFound();
      if (m[2] === '/jobs') return send(200, { total_count: r.jobs.length, jobs: r.jobs.map((j) => this.jobJson(r, j)) });
      if (m[2] === '/logs') return send(302, '', 'text/plain', { location: `${this.api}/_download/runs/${r.id}.zip` });
      return send(200, this.runJson(r));
    }
    if ((m = /^jobs\/(\d+)(\/logs)?$/.exec(rest))) {
      const found = this.findJob(repo, Number(m[1]));
      if (!found) return notFound();
      if (m[2]) return send(302, '', 'text/plain', { location: `${this.api}/_download/jobs/${found[1].id}` });
      return send(200, this.jobJson(found[0], found[1]));
    }
    return notFound();
  }
}

/** A job's log as GitHub writes one: each line stamped with its time. */
export function jobLog(lines: readonly string[], at: number): string {
  return lines.map((l, i) => `${new Date(at + i * 1000).toISOString().replace('Z', '0000Z')} ${l}\n`).join('');
}
